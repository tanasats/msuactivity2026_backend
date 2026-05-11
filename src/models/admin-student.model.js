import { query } from '../db/index.js';

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
  COALESCE(SUM(a.hours)      FILTER (WHERE r.evaluation_status = 'PASSED'), 0) AS hours_total,
  COALESCE(SUM(a.loan_hours) FILTER (WHERE r.evaluation_status = 'PASSED'), 0) AS loan_hours_total,
  COUNT(*) FILTER (WHERE r.evaluation_status = 'PASSED')::int  AS passed_count,
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
export async function getStudentAggregateStats(userId) {
  const [overall, byYear, byCategory] = await Promise.all([
    query(
      `SELECT
         COALESCE(SUM(a.hours)      FILTER (WHERE r.evaluation_status='PASSED'), 0) AS hours_total,
         COALESCE(SUM(a.loan_hours) FILTER (WHERE r.evaluation_status='PASSED'), 0) AS loan_hours_total,
         COUNT(*) FILTER (WHERE r.evaluation_status='PASSED')::int AS passed_count,
         COUNT(*) FILTER (WHERE r.evaluation_status='FAILED')::int AS failed_count,
         COUNT(*) FILTER (WHERE r.evaluation_status='PENDING_EVALUATION')::int AS pending_eval_count,
         COUNT(*) FILTER (WHERE r.status IN ('PENDING_APPROVAL','REGISTERED','ATTENDED','NO_SHOW'))::int AS active_count
       FROM registrations r
       JOIN activities a ON a.id = r.activity_id
       WHERE r.user_id = $1`,
      [userId],
    ),
    query(
      `SELECT
         a.academic_year,
         COALESCE(SUM(a.hours)      FILTER (WHERE r.evaluation_status='PASSED'), 0) AS hours,
         COALESCE(SUM(a.loan_hours) FILTER (WHERE r.evaluation_status='PASSED'), 0) AS loan_hours,
         COUNT(*) FILTER (WHERE r.evaluation_status='PASSED')::int AS passed_count
       FROM registrations r
       JOIN activities a ON a.id = r.activity_id
       WHERE r.user_id = $1
       GROUP BY a.academic_year
       ORDER BY a.academic_year DESC`,
      [userId],
    ),
    query(
      `SELECT
         c.id   AS category_id,
         c.code AS category_code,
         c.name AS category_name,
         COALESCE(SUM(a.hours) FILTER (WHERE r.evaluation_status='PASSED'), 0) AS hours,
         COUNT(*) FILTER (WHERE r.evaluation_status='PASSED')::int AS passed_count
       FROM activity_categories c
       LEFT JOIN activities a ON a.category_id = c.id
       LEFT JOIN registrations r ON r.activity_id = a.id AND r.user_id = $1
       GROUP BY c.id, c.code, c.name
       ORDER BY c.code ASC`,
      [userId],
    ),
  ]);
  return {
    overall: overall.rows[0],
    by_year: byYear.rows,
    by_category: byCategory.rows,
  };
}

// registrations ของนิสิตคนหนึ่ง — ใช้ทั้งหน้า detail และ CSV export
export async function listStudentRegistrations(userId) {
  const { rows } = await query(
    `SELECT
       r.id                 AS registration_id,
       r.status             AS registration_status,
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
    WHERE r.user_id = $1
    ORDER BY r.registered_at DESC, r.id DESC`,
    [userId],
  );
  return rows;
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
