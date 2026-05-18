import { pool, query } from '../db/index.js';

// list registrations ของกิจกรรม (สำหรับ faculty_staff ดู/จัดการผู้สมัคร)
//   - JOIN users เพื่อดึงชื่อ + msu_id + faculty
//   - JOIN attendances เพื่อดู attendance_status (ของ row valid ล่าสุด)
//   - default ไม่ filter status — UI filter ฝั่ง client
export async function listByActivity(activityId) {
  const { rows } = await query(
    `SELECT r.id              AS registration_id,
            r.status          AS registration_status,
            r.participant_role,
            r.qr_token,
            r.registered_at,
            r.approved_at,
            r.approved_by,
            r.cancelled_at,
            r.cancelled_by,
            r.cancel_reason,
            r.attended_at,
            r.evaluation_status,
            r.evaluated_at,
            r.evaluated_by,
            r.evaluation_note,
            u.id              AS user_id,
            u.full_name       AS student_name,
            u.email,
            u.msu_id,
            u.faculty_id,
            u.faculty_name,
            (
              SELECT att.status
                FROM attendances att
               WHERE att.registration_id = r.id
               ORDER BY att.checked_in_at DESC
               LIMIT 1
            ) AS attendance_status
       FROM registrations r
       JOIN users u ON u.id = r.user_id
      WHERE r.activity_id = $1
      ORDER BY r.registered_at ASC`,
    [activityId],
  );
  return rows;
}

// staff manual check-in — เจ้าหน้าที่กดเช็คอินแทนนิสิต (เลือกได้ทีละคน/หลายคน)
//   - bypass window/qr — เป็น override ที่ใช้เมื่อ QR เสีย/นิสิตไม่ถนัด หรือเช็คอินรวบทีหลัง
//   - ตรวจ activity_id + status='REGISTERED' ใน WHERE → ข้าม id ที่ไม่ตรง
//   - INSERT attendance (method='MANUAL_STAFF') + UPDATE reg → ATTENDED + PENDING_EVALUATION
//   - ใช้ CTE ให้ทั้งสองคำสั่งทำในคำสั่ง SQL เดียว (atomic ระดับ statement, partial-skip ได้)
export async function staffCheckInBulk({
  activityId,
  registrationIds,
  staffId,
}) {
  if (registrationIds.length === 0) return { checkedIn: [], skipped: [] };
  const { rows } = await query(
    `WITH eligible AS (
       UPDATE registrations
          SET status            = 'ATTENDED',
              attended_at       = now(),
              evaluation_status = 'PENDING_EVALUATION',
              updated_at        = now()
        WHERE id = ANY($1::int[])
          AND activity_id = $2
          AND status = 'REGISTERED'
       RETURNING id
     )
     INSERT INTO attendances (registration_id, method, status, checked_in_by)
     SELECT id, 'MANUAL_STAFF', 'VALID', $3 FROM eligible
     RETURNING registration_id`,
    [registrationIds, activityId, staffId],
  );
  const checkedIn = rows.map((r) => r.registration_id);
  const set = new Set(checkedIn);
  const skipped = registrationIds.filter((id) => !set.has(id));
  return { checkedIn, skipped };
}

// ── ยกเลิกการเช็คอิน ────────────────────────────────────────────
//   precondition:
//     - registration_status = 'ATTENDED'
//     - evaluation_status IS NULL หรือ 'PENDING_EVALUATION' (ถ้า evaluate แล้วบล็อก)
//   tx:
//     1. UPDATE registrations: status → REGISTERED, attended_at = NULL, evaluation_status = NULL
//     2. UPDATE attendances: status → INVALID (soft-delete หลักฐาน — เก็บ row ไว้เป็น history)
//   คืน { ok: true, before: {...} } หรือ { ok: false, reason: 'NOT_FOUND' | 'STATUS_MISMATCH' | 'ALREADY_EVALUATED' }
export async function cancelStaffCheckIn(registrationId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. ตรวจสถานะปัจจุบัน (lock row) — ใช้ FOR UPDATE กัน race
    const cur = await client.query(
      `SELECT id, activity_id, user_id, status, evaluation_status
         FROM registrations
        WHERE id = $1
        FOR UPDATE`,
      [registrationId],
    );
    if (cur.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'NOT_FOUND' };
    }
    const reg = cur.rows[0];
    if (reg.status !== 'ATTENDED') {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'STATUS_MISMATCH', currentStatus: reg.status };
    }
    if (
      reg.evaluation_status !== null &&
      reg.evaluation_status !== 'PENDING_EVALUATION'
    ) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        reason: 'ALREADY_EVALUATED',
        evaluationStatus: reg.evaluation_status,
      };
    }

    // 2. revert registration → REGISTERED + ล้าง attendance metadata
    await client.query(
      `UPDATE registrations
          SET status            = 'REGISTERED',
              attended_at       = NULL,
              evaluation_status = NULL,
              evaluated_at      = NULL,
              evaluated_by      = NULL,
              evaluation_note   = NULL,
              updated_at        = now()
        WHERE id = $1`,
      [registrationId],
    );

    // 3. soft-delete attendance: VALID → INVALID (เก็บ row history)
    //    1 reg = 1 valid attendance (unique partial index บังคับอยู่แล้ว)
    await client.query(
      `UPDATE attendances
          SET status = 'INVALID'
        WHERE registration_id = $1 AND status = 'VALID'`,
      [registrationId],
    );

    await client.query('COMMIT');
    return {
      ok: true,
      before: {
        activity_id: reg.activity_id,
        user_id: reg.user_id,
        status: reg.status,
        evaluation_status: reg.evaluation_status,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── ยกเลิกผลประเมิน (PASSED/FAILED → PENDING_EVALUATION) ───────
//   precondition:
//     - registration_status = 'ATTENDED'
//     - evaluation_status   = 'PASSED' หรือ 'FAILED' (revert ของที่ประเมินแล้วเท่านั้น)
//   clear: evaluated_at, evaluated_by, evaluation_note
//   set: evaluation_status = 'PENDING_EVALUATION' (เหมือนเพิ่งเช็คอินใหม่ ๆ)
//   คืน updated row หรือ null ถ้า precondition ไม่ตรง
export async function revertEvaluation(registrationId) {
  // ใช้ CTE เพื่อ atomic + คืน previousEval (RETURNING ของ UPDATE คืนค่าหลัง update เท่านั้น)
  const { rows } = await query(
    `WITH before AS (
       SELECT id, evaluation_status AS prev_eval
         FROM registrations
        WHERE id = $1
     ), upd AS (
       UPDATE registrations
          SET evaluation_status = 'PENDING_EVALUATION',
              evaluation_note   = NULL,
              evaluated_at      = NULL,
              evaluated_by      = NULL,
              updated_at        = now()
        WHERE id = $1
          AND status = 'ATTENDED'
          AND evaluation_status IN ('PASSED', 'FAILED')
        RETURNING id, status, evaluation_status, activity_id, user_id
     )
     SELECT upd.id, upd.status, upd.evaluation_status,
            upd.activity_id, upd.user_id, before.prev_eval AS previous_evaluation
       FROM upd JOIN before ON before.id = upd.id`,
    [registrationId],
  );
  return rows[0] ?? null;
}

// บันทึกผลประเมินหลายคนพร้อมกัน — single UPDATE กับ ANY(ids)
//   - บังคับ activity_id ใน WHERE → กันสับ id ข้ามกิจกรรม (ใช้ scope ระดับ DB)
//   - บังคับ status='ATTENDED' → reg ที่ยังไม่เช็คอินจะถูกข้าม (ไม่ throw)
//   - คืน { updated: number[], skipped: number[] } เพื่อให้ controller รายงานผลได้ครบ
export async function bulkEvaluateRegistrations({
  activityId,
  registrationIds,
  evaluatorId,
  result,
  note,
}) {
  if (registrationIds.length === 0) return { updated: [], skipped: [] };
  const { rows } = await query(
    `UPDATE registrations
        SET evaluation_status = $2,
            evaluation_note   = $3,
            evaluated_at      = now(),
            evaluated_by      = $4,
            updated_at        = now()
      WHERE id = ANY($1::int[])
        AND activity_id = $5
        AND status = 'ATTENDED'
      RETURNING id`,
    [registrationIds, result, note ?? null, evaluatorId, activityId],
  );
  const updated = rows.map((r) => r.id);
  const updatedSet = new Set(updated);
  const skipped = registrationIds.filter((id) => !updatedSet.has(id));
  return { updated, skipped };
}

// บันทึกผลประเมินการเข้าร่วม (PASSED / FAILED) — เจ้าหน้าที่คณะให้หลังนิสิตเช็คอิน
//   - ตรวจ status = 'ATTENDED' (ต้องเช็คอินก่อน) + อนุญาตเปลี่ยนผลซ้ำ (เช่น แก้ไขจาก FAILED → PASSED)
//   - คืน updated row หรือ null ถ้า precondition ไม่ตรง
export async function evaluateRegistration(
  registrationId,
  evaluatorId,
  result,
  note,
) {
  const { rows } = await query(
    `UPDATE registrations
        SET evaluation_status = $2,
            evaluation_note   = $3,
            evaluated_at      = now(),
            evaluated_by      = $4,
            updated_at        = now()
      WHERE id = $1
        AND status = 'ATTENDED'
      RETURNING id,
                status,
                evaluation_status,
                evaluation_note,
                evaluated_at,
                evaluated_by`,
    [registrationId, result, note ?? null, evaluatorId],
  );
  return rows[0] || null;
}

const VALID_PARTICIPANT_ROLES = Object.freeze([
  'PARTICIPANT',
  'ORGANIZER',
  'LEADER',
]);
export function isValidParticipantRole(r) {
  return VALID_PARTICIPANT_ROLES.includes(r);
}

// bulk update participant_role — set role ให้หลาย registration ในกิจกรรมเดียวกัน
//   - filter activity_id กัน cross-activity smear
//   - active statuses เท่านั้น (ไม่เปลี่ยนของที่ถูก cancel/reject แล้ว)
//   - คืน { updated: id[], skipped: id[] }
export async function bulkUpdateParticipantRole({
  activityId,
  registrationIds,
  role,
}) {
  if (registrationIds.length === 0) return { updated: [], skipped: [] };
  const { rows } = await query(
    `UPDATE registrations
        SET participant_role = $3::participant_role,
            updated_at       = now()
      WHERE id = ANY($2::int[])
        AND activity_id = $1
        AND status IN ('PENDING_APPROVAL','REGISTERED','ATTENDED','NO_SHOW')
      RETURNING id`,
    [activityId, registrationIds, role],
  );
  const updated = rows.map((r) => r.id);
  const updatedSet = new Set(updated);
  const skipped = registrationIds.filter((id) => !updatedSet.has(id));
  return { updated, skipped };
}

// bulk approve: หลาย registration ในกิจกรรมเดียวกัน (atomic ต่อ row)
//   - filter เฉพาะ PENDING_APPROVAL ใน activity ที่ระบุ — ป้องกัน cross-activity smear
//   - คืน { approved: [{registration_id, qr_token}], skipped: [registration_id] }
export async function bulkApproveRegistrations({
  activityId,
  registrationIds,
  approverId,
}) {
  if (registrationIds.length === 0) {
    return { approved: [], skipped: [] };
  }
  const { rows } = await query(
    `UPDATE registrations
        SET status      = 'REGISTERED',
            qr_token    = COALESCE(qr_token, gen_random_uuid()),
            approved_at = now(),
            approved_by = $3,
            updated_at  = now()
      WHERE id = ANY($2::int[])
        AND activity_id = $1
        AND status = 'PENDING_APPROVAL'
      RETURNING id AS registration_id, qr_token`,
    [activityId, registrationIds, approverId],
  );
  const approvedIds = new Set(rows.map((r) => r.registration_id));
  const skipped = registrationIds.filter((id) => !approvedIds.has(id));
  return { approved: rows, skipped };
}

// resolve msu_ids → registration_ids ของ activity นี้ + status ที่อยู่ใน allowed
//   - คืน { resolved: [{msu_id, registration_id}], errors: [{msu_id, reason}] }
//   - reason: 'NOT_FOUND' | 'NOT_REGISTERED' | 'STATUS_MISMATCH'
//   - duplicate msu_id → dedupe + map id เดียว
export async function resolveMsuIdsToRegistrationIds(
  activityId,
  msuIds,
  allowedStatuses,
) {
  if (msuIds.length === 0) return { resolved: [], errors: [] };

  const { rows } = await query(
    `SELECT u.msu_id, r.id AS registration_id, r.status
       FROM users u
       LEFT JOIN registrations r
         ON r.user_id = u.id AND r.activity_id = $1
      WHERE u.msu_id = ANY($2::text[])`,
    [activityId, msuIds],
  );

  const allowed = new Set(allowedStatuses);
  const byMsuId = new Map(rows.map((r) => [r.msu_id, r]));
  const resolved = [];
  const errors = [];
  for (const msuId of msuIds) {
    const r = byMsuId.get(msuId);
    if (!r) {
      errors.push({ msu_id: msuId, reason: 'NOT_FOUND' });
    } else if (!r.registration_id) {
      errors.push({ msu_id: msuId, reason: 'NOT_REGISTERED' });
    } else if (!allowed.has(r.status)) {
      errors.push({ msu_id: msuId, reason: 'STATUS_MISMATCH', current_status: r.status });
    } else {
      resolved.push({ msu_id: msuId, registration_id: r.registration_id });
    }
  }
  return { resolved, errors };
}

// approve: PENDING_APPROVAL → REGISTERED + gen qr_token + บันทึก approver
//   counter ไม่เปลี่ยน เพราะ register ตอนแรกได้ +1 แล้ว
//   (status ทั้งสองเป็น active ใน partial unique index)
export async function approveRegistration(registrationId, approverId) {
  const { rows } = await query(
    `UPDATE registrations
        SET status      = 'REGISTERED',
            qr_token    = COALESCE(qr_token, gen_random_uuid()),
            approved_at = now(),
            approved_by = $2,
            updated_at  = now()
      WHERE id = $1
        AND status = 'PENDING_APPROVAL'
      RETURNING id, status, qr_token, activity_id`,
    [registrationId, approverId],
  );
  return rows[0] || null;
}

// cancel โดย staff (จาก PENDING_APPROVAL หรือ REGISTERED)
//   → CANCELLED_BY_STAFF + คืน slot (-1 counter) ใน transaction
export async function cancelByStaff(registrationId, staffId, reason) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE registrations
          SET status        = 'CANCELLED_BY_STAFF',
              cancelled_at  = now(),
              cancelled_by  = $2,
              cancel_reason = $3,
              updated_at    = now()
        WHERE id = $1
          AND status IN ('PENDING_APPROVAL', 'REGISTERED')
        RETURNING id, status, activity_id`,
      [registrationId, staffId, reason ?? null],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(
      `UPDATE activities
          SET registered_count = GREATEST(registered_count - 1, 0)
        WHERE id = $1`,
      [rows[0].activity_id],
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// bulk add: เจ้าหน้าที่คณะเพิ่มรายชื่อนิสิตเข้ากิจกรรมจาก msu_id หลายคน
//   - ข้าม window check + eligible_faculties (staff override)
//   - คงไว้: status=WORK, capacity, ไม่ซ้ำ active registration
//   - REGISTERED ทันที + gen qr_token (staff add = pre-approved)
//
//   คืน { added: [{msu_id, user_id, registration_id}], errors: [{msu_id, reason}] }
//   reason: 'NOT_FOUND' | 'NOT_STUDENT' | 'ALREADY_REGISTERED' | 'FULL' | 'NOT_OPEN'
export async function bulkAddByMsuIds(activityId, msuIds, staffId) {
  const added = [];
  const errors = [];

  for (const rawMsuId of msuIds) {
    const msuId = String(rawMsuId).trim();
    if (!msuId) continue;

    // 1. หา user
    const userRes = await query(
      `SELECT id, role FROM users WHERE msu_id = $1 LIMIT 1`,
      [msuId],
    );
    const u = userRes.rows[0];
    if (!u) {
      errors.push({ msu_id: msuId, reason: 'NOT_FOUND' });
      continue;
    }
    if (u.role !== 'student') {
      errors.push({ msu_id: msuId, reason: 'NOT_STUDENT' });
      continue;
    }

    // 2. atomic insert ใน transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // counter +1 — ตรวจ WORK + capacity (skip window)
      const upd = await client.query(
        `UPDATE activities
            SET registered_count = registered_count + 1
          WHERE id = $1
            AND status = 'WORK'
            AND registered_count < capacity
         RETURNING id`,
        [activityId],
      );
      if (upd.rows.length === 0) {
        await client.query('ROLLBACK');
        // หาเหตุผล — query stat
        const a = await query(
          `SELECT status, registered_count, capacity FROM activities WHERE id = $1`,
          [activityId],
        );
        const reason =
          !a.rows[0] || a.rows[0].status !== 'WORK'
            ? 'NOT_OPEN'
            : a.rows[0].registered_count >= a.rows[0].capacity
              ? 'FULL'
              : 'NOT_OPEN';
        errors.push({ msu_id: msuId, reason });
        continue;
      }

      // INSERT registration — staff add = REGISTERED + qr_token ทันที
      const ins = await client.query(
        `INSERT INTO registrations
           (user_id, activity_id, status, qr_token, approved_at, approved_by)
         VALUES ($1, $2, 'REGISTERED', gen_random_uuid(), now(), $3)
         RETURNING id`,
        [u.id, activityId, staffId],
      );

      await client.query('COMMIT');
      added.push({
        msu_id: msuId,
        user_id: u.id,
        registration_id: ins.rows[0].id,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err?.code === '23505') {
        errors.push({ msu_id: msuId, reason: 'ALREADY_REGISTERED' });
      } else {
        // unexpected — บันทึกแล้วไปต่อ (ไม่ throw เพื่อให้ batch ทำงานครบ)
        console.error('[bulkAdd] unexpected error', err);
        errors.push({ msu_id: msuId, reason: 'ERROR' });
      }
    } finally {
      client.release();
    }
  }

  return { added, errors };
}

// helper: ดึง registration row + activity context (ใช้ใน controller scope check)
export async function findRegistrationWithActivity(registrationId) {
  const { rows } = await query(
    `SELECT r.id              AS registration_id,
            r.status,
            r.activity_id,
            a.created_by       AS activity_created_by,
            a.faculty_id       AS activity_faculty_id
       FROM registrations r
       JOIN activities a ON a.id = r.activity_id
      WHERE r.id = $1`,
    [registrationId],
  );
  return rows[0] || null;
}
