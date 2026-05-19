import { pool, query } from '../db/index.js';

// list registrations ของนิสิต — รวม PENDING/REGISTERED (active) + ATTENDED/NO_SHOW (history)
// (CANCELLED/REJECTED ไม่ต้องโชว์ใน student dashboard)
//   academicYear (BE) optional → filter เฉพาะปีนั้น (default: ทุกปี)
export async function listMyRegistrations(userId, academicYear = null) {
  const params = [userId];
  let yearFilter = '';
  if (academicYear !== null) {
    params.push(academicYear);
    yearFilter = ` AND a.academic_year = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT r.id           AS registration_id,
            r.status       AS registration_status,
            r.participant_role,
            r.qr_token,
            r.attended_at,
            r.evaluation_status,
            r.evaluated_at,
            r.evaluation_note,
            a.id           AS activity_id,
            a.title,
            a.location,
            a.start_at,
            a.end_at,
            a.hours,
            a.loan_hours,
            a.capacity,
            a.registered_count,
            a.status       AS activity_status,
            a.check_in_opens_at,
            a.check_in_closes_at,
            c.code         AS category_code,
            c.name         AS category_name,
            o.code         AS organization_code,
            o.name         AS organization_name,
            (
              SELECT att.status
                FROM attendances att
               WHERE att.registration_id = r.id
               ORDER BY att.checked_in_at DESC
               LIMIT 1
            ) AS attendance_status
       FROM registrations r
       JOIN activities a            ON a.id = r.activity_id
       JOIN activity_categories c   ON c.id = a.category_id
       JOIN organizations o         ON o.id = a.organization_id
      WHERE r.user_id = $1
        AND r.status IN ('PENDING_APPROVAL', 'REGISTERED', 'ATTENDED', 'NO_SHOW')
        AND a.status != 'DELETED'${yearFilter}
      ORDER BY a.start_at ASC`,
    params,
  );
  return rows;
}

// stats: ชั่วโมง + จำนวนกิจกรรมที่ได้รับการประเมินผ่าน (PASSED)
//   - check-in อย่างเดียวยังไม่นับ — ต้องผ่านการประเมินจากเจ้าหน้าที่คณะก่อน
//   - FAILED ไม่นับชั่วโมง (ถือเป็นเข้าร่วมแต่ไม่ผ่านเกณฑ์)
//   academicYear (BE) optional → filter เฉพาะปีนั้น (default: ทุกปี)
export async function getStudentStats(userId, academicYear = null) {
  const params = [userId];
  let yearFilter = '';
  if (academicYear !== null) {
    params.push(academicYear);
    yearFilter = ` AND a.academic_year = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(a.hours), 0)        AS hours_total,
       COALESCE(SUM(a.loan_hours), 0)   AS loan_hours_total,
       COUNT(DISTINCT r.activity_id)    AS activities_count
     FROM registrations r
     JOIN activities a ON a.id = r.activity_id
     WHERE r.user_id = $1
       AND r.status = 'ATTENDED'
       AND r.evaluation_status = 'PASSED'
       AND a.status != 'DELETED'${yearFilter}`,
    params,
  );
  // pg numeric parser แปลง decimal → number; count return เป็น string ของ bigint → cast
  const r = rows[0];
  return {
    hours_total: Number(r.hours_total),
    loan_hours_total: Number(r.loan_hours_total),
    activities_count: Number(r.activities_count),
  };
}

// คืนปีการศึกษาทั้งหมดที่นิสิตเคยมี registration (ไม่รวมที่ cancel)
//   ใช้ populate dropdown ปีในหน้า student dashboard
export async function listMyAcademicYears(userId) {
  const { rows } = await query(
    `SELECT DISTINCT a.academic_year
       FROM registrations r
       JOIN activities a ON a.id = r.activity_id
      WHERE r.user_id = $1
        AND r.status IN ('PENDING_APPROVAL', 'REGISTERED', 'ATTENDED', 'NO_SHOW')
        AND a.status != 'DELETED'
      ORDER BY a.academic_year DESC`,
    [userId],
  );
  return rows.map((r) => r.academic_year);
}

// cancel: เฉพาะ status PENDING_APPROVAL + เป็นของ user เอง → CANCELLED_BY_USER
// + ลด registered_count -1 (เพื่อ consistent กับ +1 ตอน register)
// คืน updated row หรือ null ถ้า precondition ไม่ตรง
export async function cancelMyRegistration(registrationId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE registrations
          SET status       = 'CANCELLED_BY_USER',
              cancelled_at = now(),
              cancelled_by = $2,
              updated_at   = now()
        WHERE id = $1
          AND user_id = $2
          AND status = 'PENDING_APPROVAL'
        RETURNING id, status, activity_id`,
      [registrationId, userId],
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    // คืน slot
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

// register: นิสิตสมัครเข้ากิจกรรม
// flow:
//   1. atomic UPDATE activities SET registered_count +1 WHERE WORK + window + ที่นั่งว่าง
//   2. ถ้า activity มี eligible_faculties — ตรวจ user.faculty_id ตรง list ไหม
//   3. INSERT registration (status: AUTO→REGISTERED+qr_token, MANUAL→PENDING_APPROVAL)
//   4. หาก unique-violation (สมัครซ้ำ) → ROLLBACK
//
// คืน { ok: true, registration } หรือ { ok: false, reason: 'NOT_OPEN'|'NOT_YET_OPEN'|'CLOSED'|'FULL'|'NOT_ELIGIBLE'|'ALREADY_REGISTERED' }
export async function createRegistration({ userId, activityId, userFacultyId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. atomic counter + ตรวจเงื่อนไข
    const upd = await client.query(
      `UPDATE activities
          SET registered_count = registered_count + 1
        WHERE id = $1
          AND status = 'WORK'
          AND now() BETWEEN registration_open_at AND registration_close_at
          AND registered_count < capacity
       RETURNING approval_mode`,
      [activityId],
    );
    if (upd.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: await diagnoseRegisterFailure(activityId) };
    }
    const approvalMode = upd.rows[0].approval_mode;

    // 2. eligibility — ถ้ามี restriction ใน activity_eligible_faculties
    const elig = await client.query(
      `SELECT 1 FROM activity_eligible_faculties WHERE activity_id = $1 LIMIT 1`,
      [activityId],
    );
    if (elig.rows.length > 0) {
      const match = await client.query(
        `SELECT 1 FROM activity_eligible_faculties
          WHERE activity_id = $1 AND faculty_id = $2`,
        [activityId, userFacultyId],
      );
      if (match.rows.length === 0) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'NOT_ELIGIBLE' };
      }
    }

    // 3. INSERT registration — qr_token gen เฉพาะ AUTO (REGISTERED ตั้งแต่ต้น)
    const status = approvalMode === 'AUTO' ? 'REGISTERED' : 'PENDING_APPROVAL';
    const ins = await client.query(
      `INSERT INTO registrations (user_id, activity_id, status, qr_token)
       VALUES ($1, $2, $3,
         CASE WHEN $3::registration_status = 'REGISTERED' THEN gen_random_uuid() ELSE NULL END)
       RETURNING id, status, qr_token, registered_at`,
      [userId, activityId, status],
    );

    await client.query('COMMIT');
    return { ok: true, registration: ins.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err?.code === '23505') {
      // unique partial index บน (user_id, activity_id) WHERE status IN active list
      return { ok: false, reason: 'ALREADY_REGISTERED' };
    }
    throw err;
  } finally {
    client.release();
  }
}

// helper: หา reason ของ failure เมื่อ atomic update returning 0
async function diagnoseRegisterFailure(activityId) {
  const { rows } = await query(
    `SELECT status, registered_count, capacity,
            registration_open_at, registration_close_at
       FROM activities WHERE id = $1`,
    [activityId],
  );
  const a = rows[0];
  if (!a) return 'NOT_OPEN';
  if (a.status !== 'WORK') return 'NOT_OPEN';
  const now = new Date();
  if (now < new Date(a.registration_open_at)) return 'NOT_YET_OPEN';
  if (now > new Date(a.registration_close_at)) return 'CLOSED';
  if (a.registered_count >= a.capacity) return 'FULL';
  return 'NOT_OPEN';
}
