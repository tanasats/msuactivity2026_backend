import { pool, query } from '../db/index.js';

// admin/super_admin: ตรวจสอบ/ติดตามข้อมูลการเข้าร่วมกิจกรรมของนิสิต
//   - drill-down: list students + stats → student detail → student's registrations
//   - cross-browse: list registrations ข้ามนิสิต+กิจกรรม + filter
//
// stats: นับเฉพาะ evaluation_status='PASSED' (กฎเดียวกับ student dashboard)
//   - hours_total, loan_hours_total, passed_count
//   - registrations_count: นับ row ที่ยัง active หรือ attended (ไม่นับ cancel/reject)

const STUDENT_LIST_COLS = `
  u.id,
  u.msu_id,
  u.full_name,
  u.email,
  u.faculty_id,
  u.faculty_name,
  u.picture_url,
  u.last_login_at,
  -- defensive: นับเฉพาะ row ที่ยัง ATTENDED ด้วย — กัน orphan eval data ของ row ที่ถูก cancel ไปแล้ว
  COALESCE(SUM(a.hours)      FILTER (WHERE r.evaluation_status = 'PASSED' AND r.status = 'ATTENDED'), 0) AS hours_total,
  COALESCE(SUM(a.loan_hours) FILTER (WHERE r.evaluation_status = 'PASSED' AND r.status = 'ATTENDED'), 0) AS loan_hours_total,
  COUNT(*) FILTER (WHERE r.evaluation_status = 'PASSED' AND r.status = 'ATTENDED')::int  AS passed_count,
  COUNT(*) FILTER (
    WHERE r.status IN ('PENDING_APPROVAL','REGISTERED','ATTENDED','NO_SHOW')
  )::int AS registrations_count
`;

// list นิสิต + summary stats
//   filters: q (msu_id/name/email), faculty_id
//   sort: name_asc | name_desc | hours_desc | hours_asc | last_login_desc
export async function listStudents({
  q = null,
  facultyId = null,
  sort = 'name_asc',
  limit = 50,
  offset = 0,
} = {}) {
  const where = ["u.role = 'student'", "u.status = 'active'"];
  const params = [];

  if (q) {
    params.push(`%${q}%`);
    where.push(
      `(u.email ILIKE $${params.length} OR u.full_name ILIKE $${params.length} OR u.msu_id ILIKE $${params.length})`,
    );
  }
  if (facultyId !== null) {
    params.push(facultyId);
    where.push(`u.faculty_id = $${params.length}`);
  }

  const orderBy =
    sort === 'name_desc'      ? 'u.full_name DESC'  :
    sort === 'hours_desc'     ? 'hours_total DESC, u.full_name ASC'  :
    sort === 'hours_asc'      ? 'hours_total ASC,  u.full_name ASC'  :
    sort === 'last_login_desc' ? 'u.last_login_at DESC NULLS LAST'    :
    /* default */               'u.full_name ASC';

  // count total (ใช้ subquery กัน group)
  const countRes = await query(
    `SELECT COUNT(*)::int AS total
       FROM users u
      WHERE ${where.join(' AND ')}`,
    params,
  );
  const total = countRes.rows[0].total;

  params.push(limit);
  params.push(offset);
  const { rows } = await query(
    `SELECT ${STUDENT_LIST_COLS}
       FROM users u
       LEFT JOIN registrations r ON r.user_id = u.id
       LEFT JOIN activities    a ON a.id = r.activity_id
      WHERE ${where.join(' AND ')}
      GROUP BY u.id
      ORDER BY ${orderBy}, u.id ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows, total };
}

// stats per academic_year + per category (สำหรับ drill-down detail)
//   ดูภาพรวม + ดูแยกปี + ดูแยกหมวด
export async function getStudentAggregateStats(userId, { includeDeleted = true } = {}) {
  // exclude soft-deleted activities ทุกที่ที่ JOIN activities a
  //   (student view: includeDeleted=false; admin view: true — เห็นความจริง)
  const actDel = includeDeleted ? '' : ` AND a.status != 'DELETED'`;
  // by_skill: JOIN activities a มาทาง activity_skills + ตรวจ deleted ใน JOIN เอง
  //   (ไม่ใช้ WHERE เพราะมันเป็น LEFT JOIN — ต้องอยู่ใน ON ไม่งั้นจะตัด root ที่ count=0)
  const actDelOnSkill = includeDeleted ? '' : ` AND a.status != 'DELETED'`;
  const [overall, byYear, byCategory, bySkill] = await Promise.all([
    query(
      `SELECT
         -- defensive: filter status='ATTENDED' กัน orphan eval ของ cancelled rows
         COALESCE(SUM(a.hours)      FILTER (WHERE r.evaluation_status='PASSED' AND r.status='ATTENDED'), 0) AS hours_total,
         COALESCE(SUM(a.loan_hours) FILTER (WHERE r.evaluation_status='PASSED' AND r.status='ATTENDED'), 0) AS loan_hours_total,
         COUNT(*) FILTER (WHERE r.evaluation_status='PASSED' AND r.status='ATTENDED')::int AS passed_count,
         COUNT(*) FILTER (WHERE r.evaluation_status='FAILED' AND r.status='ATTENDED')::int AS failed_count,
         COUNT(*) FILTER (WHERE r.evaluation_status='PENDING_EVALUATION' AND r.status='ATTENDED')::int AS pending_eval_count,
         COUNT(*) FILTER (WHERE r.status IN ('PENDING_APPROVAL','REGISTERED','ATTENDED','NO_SHOW'))::int AS active_count
       FROM registrations r
       JOIN activities a ON a.id = r.activity_id
       WHERE r.user_id = $1${actDel}`,
      [userId],
    ),
    query(
      `SELECT
         a.academic_year,
         COALESCE(SUM(a.hours)      FILTER (WHERE r.evaluation_status='PASSED' AND r.status='ATTENDED'), 0) AS hours,
         COALESCE(SUM(a.loan_hours) FILTER (WHERE r.evaluation_status='PASSED' AND r.status='ATTENDED'), 0) AS loan_hours,
         COUNT(*) FILTER (WHERE r.evaluation_status='PASSED' AND r.status='ATTENDED')::int AS passed_count
       FROM registrations r
       JOIN activities a ON a.id = r.activity_id
       WHERE r.user_id = $1${actDel}
       GROUP BY a.academic_year
       ORDER BY a.academic_year DESC`,
      [userId],
    ),
    query(
      `SELECT
         c.id   AS category_id,
         c.code AS category_code,
         c.name AS category_name,
         COALESCE(SUM(a.hours) FILTER (WHERE r.evaluation_status='PASSED' AND r.status='ATTENDED'), 0) AS hours,
         COUNT(*) FILTER (WHERE r.evaluation_status='PASSED' AND r.status='ATTENDED')::int AS passed_count
       FROM activity_categories c
       LEFT JOIN activities a ON a.category_id = c.id${actDel}
       LEFT JOIN registrations r ON r.activity_id = a.id AND r.user_id = $1
       GROUP BY c.id, c.code, c.name
       ORDER BY c.code ASC`,
      [userId],
    ),
    // by_skill: ทักษะที่นิสิตได้รับสะสมข้ามปี (rollup ระดับ parent)
    //   - LEFT JOIN จาก skills root → เห็นทุกทักษะแม้ count=0 (นิสิตยังไม่เคยได้รับ)
    //   - COALESCE(s.parent_id, s.id) = root id — รองรับทั้ง legacy (ผูก parent ตรง) + new (ผูก child)
    //   - filter ATTENDED + PASSED (สอดคล้องกับ hours_total) + user คนนี้
    query(
      `SELECT
         root.id   AS skill_id,
         root.code AS skill_code,
         root.name AS skill_name,
         -- count + hours เฉพาะกรณีที่ user ลงทะเบียน + ATTENDED + PASSED จริง (FILTER)
         COUNT(DISTINCT a.id) FILTER (WHERE r.id IS NOT NULL)::int AS count,
         COALESCE(SUM(a.hours) FILTER (WHERE r.id IS NOT NULL), 0) AS hours
       FROM skills root
       LEFT JOIN skills s ON COALESCE(s.parent_id, s.id) = root.id
       LEFT JOIN activity_skills aks ON aks.skill_id = s.id
       LEFT JOIN activities a ON a.id = aks.activity_id${actDelOnSkill}
       LEFT JOIN registrations r ON r.activity_id = a.id
        AND r.user_id = $1
        AND r.status = 'ATTENDED'
        AND r.evaluation_status = 'PASSED'
       WHERE root.parent_id IS NULL
         AND root.is_active = true
       GROUP BY root.id, root.code, root.name
       ORDER BY root.code ASC`,
      [userId],
    ),
  ]);
  return {
    overall: overall.rows[0],
    by_year: byYear.rows,
    by_category: byCategory.rows,
    by_skill: bySkill.rows,
  };
}

// registrations ของนิสิตคนหนึ่ง — ใช้ทั้งหน้า detail (admin), CSV export, และ student self-export
//   includeDeleted=true (default): admin เห็น registrations ทั้งหมด รวมที่ activity ถูกลบ (มี badge)
//   includeDeleted=false:           student export ของตัวเอง — ตัดกิจกรรมที่ถูกลบออก
//   academicYear (BE) optional:     filter เฉพาะปีนั้น
export async function listStudentRegistrations(
  userId,
  { includeDeleted = true, academicYear = null } = {},
) {
  const where = ['r.user_id = $1'];
  const params = [userId];
  if (!includeDeleted) where.push(`a.status != 'DELETED'`);
  if (academicYear !== null) {
    params.push(academicYear);
    where.push(`a.academic_year = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT
       r.id                 AS registration_id,
       r.status             AS registration_status,
       r.participant_role,
       r.evaluation_status,
       r.evaluation_note,
       r.registered_at,
       r.attended_at,
       a.id                 AS activity_id,
       a.code               AS activity_code,
       a.title              AS activity_title,
       a.academic_year,
       a.semester,
       a.hours,
       a.loan_hours,
       a.status             AS activity_status,
       a.start_at,
       a.end_at,
       c.name               AS category_name,
       o.name               AS organization_name,
       f.name               AS activity_faculty_name
     FROM registrations r
     JOIN activities a            ON a.id = r.activity_id
     JOIN activity_categories c   ON c.id = a.category_id
     JOIN organizations o         ON o.id = a.organization_id
     LEFT JOIN faculties f        ON f.id = a.faculty_id
    WHERE ${where.join(' AND ')}
    ORDER BY r.registered_at DESC, r.id DESC`,
    params,
  );
  return rows;
}

// admin/super_admin ยกเลิกการลงทะเบียนได้ — bypass scope ของ faculty
//   - เปลี่ยน status → CANCELLED_BY_STAFF, บันทึก cancelled_at/by + cancel_reason
//   - คืน slot ใน activities.registered_count (ลด 1, GREATEST(...,0) กัน negative)
//   - cancelable เฉพาะ status ที่ "ไม่มี side effects" คือ PENDING_APPROVAL + REGISTERED
//   - ATTENDED ต้องผ่าน chain action ก่อน (revert-evaluation → cancel-check-in → cancel)
//     เพื่อกัน orphan data (eval row ค้างอยู่หลัง cancel → stats นับชั่วโมงผิด)
//   คืน { ok, activity_id } | { ok: false, reason: 'NOT_FOUND' | 'STATUS_MISMATCH' }
const ADMIN_CANCELABLE = new Set([
  'PENDING_APPROVAL',
  'REGISTERED',
]);

export async function adminCancelRegistration(registrationId, actorId, reason) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cur } = await client.query(
      `SELECT id, status, activity_id, user_id FROM registrations
        WHERE id = $1 FOR UPDATE`,
      [registrationId],
    );
    if (cur.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'NOT_FOUND' };
    }
    if (!ADMIN_CANCELABLE.has(cur[0].status)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'STATUS_MISMATCH', currentStatus: cur[0].status };
    }
    const before = cur[0];
    await client.query(
      `UPDATE registrations
          SET status        = 'CANCELLED_BY_STAFF',
              cancelled_at  = now(),
              cancelled_by  = $2,
              cancel_reason = $3,
              updated_at    = now()
        WHERE id = $1`,
      [registrationId, actorId, reason],
    );
    // คืน slot
    await client.query(
      `UPDATE activities
          SET registered_count = GREATEST(registered_count - 1, 0)
        WHERE id = $1`,
      [before.activity_id],
    );
    await client.query('COMMIT');
    return {
      ok: true,
      activity_id: before.activity_id,
      user_id: before.user_id,
      previous_status: before.status,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// cross-browse: list registrations ทุกคน + filters (ใช้ทั้ง browse และ CSV)
//   filters: q (msu_id/name/email/activity title/code),
//            student_faculty_id, activity_faculty_id,
//            status (registration status), evaluation_status,
//            academic_year, activity_id
//   - return { items, total }
const REGISTRATION_BROWSE_COLS = `
  r.id                AS registration_id,
  r.status            AS registration_status,
  r.participant_role,
  r.evaluation_status,
  r.registered_at,
  r.attended_at,
  u.id                AS user_id,
  u.msu_id,
  u.full_name         AS student_name,
  u.email             AS student_email,
  u.faculty_name      AS student_faculty_name,
  a.id                AS activity_id,
  a.code              AS activity_code,
  a.title             AS activity_title,
  a.academic_year,
  a.semester,
  a.hours,
  a.loan_hours,
  a.status            AS activity_status,
  a.start_at,
  f.name              AS activity_faculty_name,
  c.name              AS category_name
`;

export async function listRegistrations({
  q = null,
  studentFacultyId = null,
  activityFacultyId = null,
  registrationStatus = null,
  evaluationStatus = null,
  academicYear = null,
  activityId = null,
  limit = 50,
  offset = 0,
} = {}) {
  const where = [];
  const params = [];

  if (q) {
    params.push(`%${q}%`);
    where.push(
      `(u.msu_id ILIKE $${params.length}
        OR u.full_name ILIKE $${params.length}
        OR u.email ILIKE $${params.length}
        OR a.title ILIKE $${params.length}
        OR a.code::text ILIKE $${params.length})`,
    );
  }
  if (studentFacultyId !== null) {
    params.push(studentFacultyId);
    where.push(`u.faculty_id = $${params.length}`);
  }
  if (activityFacultyId !== null) {
    params.push(activityFacultyId);
    where.push(`a.faculty_id = $${params.length}`);
  }
  if (registrationStatus) {
    params.push(registrationStatus);
    where.push(`r.status = $${params.length}`);
  }
  if (evaluationStatus) {
    params.push(evaluationStatus);
    where.push(`r.evaluation_status = $${params.length}`);
  }
  if (academicYear !== null) {
    params.push(academicYear);
    where.push(`a.academic_year = $${params.length}`);
  }
  if (activityId !== null) {
    params.push(activityId);
    where.push(`a.id = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countRes = await query(
    `SELECT COUNT(*)::int AS total
       FROM registrations r
       JOIN users u      ON u.id = r.user_id
       JOIN activities a ON a.id = r.activity_id
       ${whereSql}`,
    params,
  );
  const total = countRes.rows[0].total;

  params.push(limit);
  params.push(offset);
  const { rows } = await query(
    `SELECT ${REGISTRATION_BROWSE_COLS}
       FROM registrations r
       JOIN users u                ON u.id = r.user_id
       JOIN activities a           ON a.id = r.activity_id
       JOIN activity_categories c  ON c.id = a.category_id
       LEFT JOIN faculties f       ON f.id = a.faculty_id
       ${whereSql}
       ORDER BY r.registered_at DESC, r.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows, total };
}
