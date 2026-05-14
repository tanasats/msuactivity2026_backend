import { pool, query } from '../db/index.js';

// ── activity code generation ─────────────────────────────────────
// Format: [org_code 4][yy_BE 2][sem 1][cat 1][run 2] รวม 10 ตัว
//   ตัวอย่าง B009682101 = org B009, ปี 2568, sem 2, cat 1, running 01
// Counter: activity_code_counters PK (org, year, sem, cat) + next_running 0-100
//   - atomic upsert: INSERT/ON CONFLICT DO UPDATE SET next_running += 1
//   - assigned = next_running - 1 หลัง update (เริ่มจาก 0)
//   - ถ้า assigned > 99 → COUNTER_FULL (max 100/combination)

// helper: assign code ภายใน transaction client + return generated code หรือ null ถ้าเต็ม
//   caller รับผิดชอบ BEGIN/COMMIT/ROLLBACK
async function assignActivityCodeTx(client, activityId) {
  const { rows: cur } = await client.query(
    `SELECT a.organization_id, a.academic_year, a.semester, a.category_id,
            o.code AS org_code, c.code AS cat_code
       FROM activities a
       JOIN organizations o        ON o.id = a.organization_id
       JOIN activity_categories c  ON c.id = a.category_id
      WHERE a.id = $1
      FOR UPDATE OF a`,
    [activityId],
  );
  if (cur.length === 0) return null;
  const r = cur[0];

  const { rows: upRows } = await client.query(
    `INSERT INTO activity_code_counters
       (organization_id, academic_year, semester, category_id, next_running)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (organization_id, academic_year, semester, category_id)
     DO UPDATE SET next_running = activity_code_counters.next_running + 1
     RETURNING (next_running - 1) AS assigned`,
    [r.organization_id, r.academic_year, r.semester, r.category_id],
  );
  const assigned = upRows[0].assigned;
  if (assigned > 99) return { full: true };

  // org_code is CHAR(4) — trim ไม่จำเป็นถ้า DB เก็บเต็ม 4; ใช้ trim กันเผื่อ
  const orgCode = String(r.org_code).trim().padEnd(4, ' ').slice(0, 4);
  const yyBE = String(r.academic_year - 2500).padStart(2, '0');
  const semStr = String(r.semester);
  const catStr = String(r.cat_code);
  const runStr = String(assigned).padStart(2, '0');
  return { code: `${orgCode}${yyBE}${semStr}${catStr}${runStr}` };
}

// Admin / super_admin scope: เห็นทุกคณะ ทุกสถานะ — ไม่มี faculty_id filter
//   - JOIN faculties เพิ่ม เพราะ admin ต้องเห็นชื่อคณะของแต่ละกิจกรรม
//   - reuse pattern columns + joins จาก faculty model แต่เพิ่ม f.name AS faculty_name

const SUMMARY_COLUMNS = `
  a.id,
  a.code,
  a.title,
  a.location,
  a.start_at,
  a.end_at,
  a.registration_open_at,
  a.registration_close_at,
  a.hours,
  a.capacity,
  a.registered_count,
  a.status,
  a.academic_year,
  a.semester,
  a.created_by,
  a.faculty_id,
  a.organization_id,
  a.category_id,
  a.loan_hours,
  a.budget_source,
  a.budget_requested,
  a.budget_actual,
  a.created_at,
  a.updated_at,
  c.code AS category_code,
  c.name AS category_name,
  o.code AS organization_code,
  o.name AS organization_name,
  u.full_name AS created_by_name,
  f.name AS faculty_name
`;

const FROM_JOIN = `
  FROM activities a
  JOIN users u                ON u.id = a.created_by
  JOIN activity_categories c  ON c.id = a.category_id
  JOIN organizations o        ON o.id = a.organization_id
  LEFT JOIN faculties f       ON f.id = a.faculty_id
`;

// allow-list ของ ORDER BY เพื่อกัน SQL injection (รับ key จาก query แล้ว map → SQL fragment)
const SORT_SQL = {
  updated_desc: 'a.updated_at DESC',
  updated_asc: 'a.updated_at ASC',
  start_asc: 'a.start_at ASC',
  start_desc: 'a.start_at DESC',
  title_asc: 'a.title ASC',
  title_desc: 'a.title DESC',
};

// list ทุกกิจกรรมข้ามคณะ — รองรับ filter หลายเงื่อนไข + pagination + sort
//   filters: status, facultyId, academicYear, search (title/code substring, ci)
//   sort: key ของ SORT_SQL — invalid → fallback updated_desc
export async function listAll({
  status = null,
  facultyId = null,
  academicYear = null,
  search = null,
  sort = 'updated_desc',
  limit = 50,
  offset = 0,
} = {}) {
  const where = ['1=1'];
  const params = [];

  if (status) {
    params.push(status);
    where.push(`a.status = $${params.length}`);
  }
  if (facultyId !== null) {
    params.push(facultyId);
    where.push(`a.faculty_id = $${params.length}`);
  }
  if (academicYear !== null) {
    params.push(academicYear);
    where.push(`a.academic_year = $${params.length}`);
  }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where.push(
      `(LOWER(a.title) LIKE $${params.length} OR LOWER(COALESCE(a.code, '')) LIKE $${params.length})`,
    );
  }

  const orderBy = SORT_SQL[sort] || SORT_SQL.updated_desc;

  // นับ total ก่อน slice — ใช้ทำ pagination metadata ฝั่ง client
  const countRes = await query(
    `SELECT COUNT(*)::int AS total ${FROM_JOIN} WHERE ${where.join(' AND ')}`,
    params,
  );
  const total = countRes.rows[0].total;

  params.push(limit, offset);
  const { rows } = await query(
    `SELECT ${SUMMARY_COLUMNS}
       ${FROM_JOIN}
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}, a.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows, total };
}

// detail: full row + skills + eligible_faculties + poster + documents
//   admin เห็นทุกฟิลด์ (รวม rejection_reason / approved_at / approved_by)
export async function findById(id) {
  const { rows } = await query(
    `SELECT ${SUMMARY_COLUMNS},
            a.description,
            a.approval_mode,
            a.check_in_opens_at,
            a.check_in_closes_at,
            a.rejection_reason,
            a.approved_at,
            a.approved_by,
            a.published_at,
            apr.full_name AS approved_by_name
       ${FROM_JOIN}
       LEFT JOIN users apr ON apr.id = a.approved_by
      WHERE a.id = $1`,
    [id],
  );
  const activity = rows[0];
  if (!activity) return null;

  const [skillsRes, facultiesRes, posterRes, docsRes] = await Promise.all([
    query(
      `SELECT s.id, s.code, s.name,
              s.parent_id,
              p.code AS parent_code, p.name AS parent_name
         FROM activity_skills aks
         JOIN skills s      ON s.id = aks.skill_id
         LEFT JOIN skills p ON p.id = s.parent_id
        WHERE aks.activity_id = $1
        ORDER BY COALESCE(p.code, s.code), s.code`,
      [id],
    ),
    query(
      `SELECT f.id, f.code, f.name
         FROM activity_eligible_faculties ef
         JOIN faculties f ON f.id = ef.faculty_id
        WHERE ef.activity_id = $1
        ORDER BY f.code`,
      [id],
    ),
    query(
      `SELECT id, filename, mime_type, size_bytes, storage_key, uploaded_at
         FROM activity_files
        WHERE activity_id = $1 AND kind = 'POSTER'
        LIMIT 1`,
      [id],
    ),
    query(
      `SELECT id, filename, display_name, mime_type, size_bytes, storage_key,
              is_public, uploaded_at
         FROM activity_files
        WHERE activity_id = $1 AND kind = 'DOCUMENT'
        ORDER BY display_order ASC, uploaded_at ASC`,
      [id],
    ),
  ]);

  return {
    ...activity,
    skills: skillsRes.rows,
    eligible_faculties: facultiesRes.rows,
    poster: posterRes.rows[0] || null,
    documents: docsRes.rows,
  };
}

// นับกิจกรรมทุกคณะแยกตาม status
//   academicYear (BE) optional
export async function countAllByStatus(academicYear = null) {
  const params = [];
  let yearFilter = '';
  if (academicYear !== null) {
    params.push(academicYear);
    yearFilter = `WHERE academic_year = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT status, COUNT(*)::int AS count
       FROM activities
       ${yearFilter}
      GROUP BY status`,
    params,
  );
  const counts = {
    DRAFT: 0,
    PENDING_APPROVAL: 0,
    WORK: 0,
    COMPLETED: 0,
  };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

// ปีการศึกษาทั้งหมดที่มี activity (admin เห็นข้ามคณะ)
export async function listAllAcademicYears() {
  const { rows } = await query(
    `SELECT DISTINCT academic_year
       FROM activities
      ORDER BY academic_year DESC`,
  );
  return rows.map((r) => r.academic_year);
}

// approve: PENDING_APPROVAL → WORK + บันทึก approver/timestamp + generate final code
//   - ★ ถ้า activity มี code อยู่แล้ว (เคยถูก approve มาก่อน แล้วถูก super_admin override
//     กลับเป็น DRAFT/PENDING) → ใช้ code เดิม ไม่ regenerate
//     ป้องกัน unique-constraint violation ถ้า counter ตามไม่ทันหรือ activity อื่นใน
//     กลุ่มเดียวกันใช้ suffix นั้นไปแล้ว
//   - generate code (counter upsert) ภายใน transaction เดียวกัน เฉพาะกรณี code = NULL
//   - เคลียร์ rejection_reason เผื่อกิจกรรมเคยโดน reject แล้ว resubmit
//   คืน:
//     row updated (มี code) | null ถ้า status ไม่ตรง precondition
//     { full: true } ถ้า counter combination เต็ม (running > 99)
export async function approveActivity(id, approverId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: cur } = await client.query(
      `SELECT status, code FROM activities WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (cur.length === 0 || cur[0].status !== 'PENDING_APPROVAL') {
      await client.query('ROLLBACK');
      return null;
    }

    let code = cur[0].code;
    if (!code) {
      const codeRes = await assignActivityCodeTx(client, id);
      if (!codeRes) {
        await client.query('ROLLBACK');
        return null;
      }
      if (codeRes.full) {
        await client.query('ROLLBACK');
        return { full: true };
      }
      code = codeRes.code;
    }

    const { rows } = await client.query(
      `UPDATE activities
          SET status           = 'WORK',
              code             = $2,
              approved_at      = now(),
              approved_by      = $3,
              rejection_reason = NULL,
              published_at     = COALESCE(published_at, now()),
              updated_at       = now()
        WHERE id = $1
          AND status = 'PENDING_APPROVAL'
        RETURNING id, status, code, approved_at, approved_by`,
      [id, code, approverId],
    );

    await client.query('COMMIT');
    return rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// reject: PENDING_APPROVAL → DRAFT + บันทึก rejection_reason
//   - คณะดูเหตุผลแล้วแก้ + resubmit (submit จะ clear rejection_reason ตอน flip กลับเป็น PENDING)
//   - approved_at/by ไม่เซ็ต (ยังไม่เคยถูกอนุมัติ)
export async function rejectActivity(id, reason) {
  const { rows } = await query(
    `UPDATE activities
        SET status           = 'DRAFT',
            rejection_reason = $2,
            updated_at       = now()
      WHERE id = $1
        AND status = 'PENDING_APPROVAL'
      RETURNING id, status, rejection_reason`,
    [id, reason],
  );
  return rows[0] || null;
}

// bulk approve: รับ array ของ id → loop transaction-per-row
//   ใช้ transaction-per-row เพราะแต่ละ approve ต้อง upsert counter ตาม (org,year,sem,cat) ของตัวเอง
//   ถ้าตัวใดตัวหนึ่ง counter เต็ม (running > 99) หรือ status ไม่ใช่ PENDING → ใส่ skipped + ทำต่อ
//   คืน { approved: id[], skipped: id[] }
export async function bulkApproveActivities(ids, approverId) {
  if (ids.length === 0) return { approved: [], skipped: [] };
  const approved = [];
  const skipped = [];
  for (const id of ids) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: cur } = await client.query(
        `SELECT status, code FROM activities WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (cur.length === 0 || cur[0].status !== 'PENDING_APPROVAL') {
        await client.query('ROLLBACK');
        skipped.push(id);
        continue;
      }
      // ★ reuse code เดิมถ้ามี — เหตุผลเดียวกับ approveActivity (กัน unique violation)
      let code = cur[0].code;
      if (!code) {
        const codeRes = await assignActivityCodeTx(client, id);
        if (!codeRes || codeRes.full) {
          await client.query('ROLLBACK');
          skipped.push(id);
          continue;
        }
        code = codeRes.code;
      }
      await client.query(
        `UPDATE activities
            SET status           = 'WORK',
                code             = $2,
                approved_at      = now(),
                approved_by      = $3,
                rejection_reason = NULL,
                published_at     = COALESCE(published_at, now()),
                updated_at       = now()
          WHERE id = $1
            AND status = 'PENDING_APPROVAL'`,
        [id, code, approverId],
      );
      await client.query('COMMIT');
      approved.push(id);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[bulk-approve] failed for id=${id}:`, err);
      skipped.push(id);
    } finally {
      client.release();
    }
  }
  return { approved, skipped };
}

// admin/super_admin override: แก้ field สำคัญของกิจกรรมได้ "ทุกคณะ, ทุก status"
//   (ข้ามการตรวจ ownership + status ที่ /faculty มีอยู่)
//   field ที่ยอมให้แก้: title, description, location, capacity, hours, loan_hours,
//                       start_at, end_at, registration_open_at, registration_close_at
//   ไม่อนุญาตแก้: status, code, organization_id, category_id, faculty_id, created_by
//                 (เปลี่ยน status ใช้ setActivityStatus / เปลี่ยนเจ้าของใช้ setActivityCreator)
const ADMIN_EDITABLE_FIELDS = [
  'title',
  'description',
  'location',
  'capacity',
  'hours',
  'loan_hours',
  'start_at',
  'end_at',
  'registration_open_at',
  'registration_close_at',
  // check-in window: nullable — null = ใช้ default จาก system_settings
  'check_in_opens_at',
  'check_in_closes_at',
];

export const ADMIN_EDIT_FIELDS = Object.freeze(ADMIN_EDITABLE_FIELDS.slice());

export async function adminEditActivity(id, payload) {
  const sets = [];
  const values = [id];
  for (const f of ADMIN_EDITABLE_FIELDS) {
    if (payload[f] === undefined) continue;
    values.push(payload[f]);
    sets.push(`${f} = $${values.length}`);
  }
  if (sets.length === 0) {
    // no fields = no-op; คืน row ปัจจุบัน
    return findById(id);
  }
  const { rows } = await query(
    `UPDATE activities
        SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1
      RETURNING id`,
    values,
  );
  return rows[0] ? findById(id) : null;
}

// super_admin override: บังคับเปลี่ยน status ไปค่าใดก็ได้ (ข้าม state machine)
//   ใช้กรณี recovery / แก้ผิดที่ flow ปกติทำไม่ได้ เช่น WORK → DRAFT, COMPLETED → WORK
//   side effects ที่เก็บข้อมูลให้สอดคล้อง:
//     - newStatus เป็น WORK หรือ COMPLETED + ยังไม่มี code → assign code (counter upsert)
//     - newStatus เป็น WORK + ยังไม่มี approved_at → set approved_at/by ตอนนี้
//     - newStatus เป็น WORK + ยังไม่มี published_at → set published_at ตอนนี้
//     - newStatus ไม่ใช่ DRAFT → clear rejection_reason (ไม่เกี่ยวข้องอีกต่อไป)
//   คืนค่า:
//     null                              ถ้าไม่พบ activity
//     { full: true }                   ถ้าต้อง assign code แต่ counter เต็ม
//     { activity, codeAssigned: bool } เคสปกติ
const STATUSES_NEEDING_CODE = new Set(['WORK', 'COMPLETED']);

export async function setActivityStatus(id, newStatus, actorId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: cur } = await client.query(
      `SELECT id, status, code, approved_at FROM activities WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (cur.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const before = cur[0];

    let codeAssigned = false;
    let codeOverride = null; // ส่ง null ถ้าไม่ assign ใหม่ (UPDATE ใช้ COALESCE)
    if (STATUSES_NEEDING_CODE.has(newStatus) && !before.code) {
      const codeRes = await assignActivityCodeTx(client, id);
      if (!codeRes) {
        await client.query('ROLLBACK');
        return null;
      }
      if (codeRes.full) {
        await client.query('ROLLBACK');
        return { full: true };
      }
      codeOverride = codeRes.code;
      codeAssigned = true;
    }

    // ★ ต้อง cast $2 ทุกที่อย่างชัดเจน ไม่งั้น Postgres deduce type ขัดกันเอง:
    //     - status = $2                  → expect activity_status
    //     - $2 = 'WORK'                  → expect text
    //   ผลลัพธ์: error "inconsistent types deduced for parameter $2"
    //   ใช้ $2::text ทุกที่แล้ว cast ที่ column ตอน assignment
    const { rows } = await client.query(
      `UPDATE activities
          SET status        = $2::activity_status,
              code          = COALESCE($3::text, code),
              approved_at   = CASE WHEN $2::text = 'WORK' AND approved_at IS NULL
                                   THEN now() ELSE approved_at END,
              approved_by   = CASE WHEN $2::text = 'WORK' AND approved_by IS NULL
                                   THEN $4::int ELSE approved_by END,
              published_at  = CASE WHEN $2::text = 'WORK' AND published_at IS NULL
                                   THEN now() ELSE published_at END,
              rejection_reason = CASE WHEN $2::text = 'DRAFT'
                                      THEN rejection_reason ELSE NULL END,
              updated_at    = now()
        WHERE id = $1
        RETURNING id, status, code, approved_at, approved_by, published_at, updated_at`,
      [id, newStatus, codeOverride, actorId],
    );

    await client.query('COMMIT');
    return { activity: rows[0], codeAssigned };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// super_admin override: เปลี่ยน owner ของกิจกรรม (created_by)
//   ใช้กรณี: เจ้าของเดิมลาออก/ย้ายคณะ ต้องโอนความเป็นเจ้าของให้คนใหม่
//   constraint: ผู้รับโอนต้องเป็น role ที่ "สร้างกิจกรรมได้จริง" — faculty_staff / admin / super_admin
//   ไม่อนุญาต student (ไม่มีสิทธิ์สร้าง), staff (ยังไม่ provision), executive (read-only)
//   คืน:
//     null                                ถ้าไม่พบ activity
//     { ok: false, reason: 'USER_NOT_FOUND' | 'INVALID_ROLE' | 'USER_DISABLED' }
//     { ok: true, activity }
const ALLOWED_CREATOR_ROLES = new Set(['faculty_staff', 'admin', 'super_admin']);

export async function setActivityCreator(id, newCreatorId) {
  // validate target user
  const { rows: userRows } = await query(
    `SELECT id, full_name, email, role, status FROM users WHERE id = $1`,
    [newCreatorId],
  );
  if (userRows.length === 0) return { ok: false, reason: 'USER_NOT_FOUND' };
  const u = userRows[0];
  if (u.status !== 'active') return { ok: false, reason: 'USER_DISABLED' };
  if (!ALLOWED_CREATOR_ROLES.has(u.role)) {
    return { ok: false, reason: 'INVALID_ROLE' };
  }

  // ตรวจ activity มีอยู่จริงก่อนอัปเดต — แยก query เพื่อ error message ชัด
  const { rows: actRows } = await query(
    `SELECT id, created_by FROM activities WHERE id = $1`,
    [id],
  );
  if (actRows.length === 0) return null;

  // no-op ถ้า creator คนเดิม
  if (actRows[0].created_by === newCreatorId) {
    return { ok: true, activity: { id, created_by: newCreatorId, created_by_name: u.full_name } };
  }

  const { rows } = await query(
    `UPDATE activities
        SET created_by = $2,
            updated_at = now()
      WHERE id = $1
      RETURNING id, created_by, updated_at`,
    [id, newCreatorId],
  );
  return {
    ok: true,
    activity: { ...rows[0], created_by_name: u.full_name, created_by_email: u.email },
  };
}

// bulk reject: ทุกตัวใช้ reason เดียวกัน → กลับเป็น DRAFT
export async function bulkRejectActivities(ids, reason) {
  if (ids.length === 0) return { rejected: [], skipped: [] };
  const { rows } = await query(
    `UPDATE activities
        SET status           = 'DRAFT',
            rejection_reason = $2,
            updated_at       = now()
      WHERE id = ANY($1::int[])
        AND status = 'PENDING_APPROVAL'
      RETURNING id`,
    [ids, reason],
  );
  const rejected = rows.map((r) => r.id);
  const set = new Set(rejected);
  const skipped = ids.filter((id) => !set.has(id));
  return { rejected, skipped };
}
