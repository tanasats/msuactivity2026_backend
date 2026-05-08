import { query } from '../db/index.js';

// คอลัมน์ที่ส่งกลับใน list — ครอบคลุม identity + role + ERP profile โดยไม่ดึง google_sub
const SELECT_COLUMNS = `
  u.id,
  u.email,
  u.full_name,
  u.role,
  u.status,
  u.msu_id,
  u.faculty_id,
  u.faculty_name,
  u.picture_url,
  u.staff_id,
  u.position_th,
  u.phone,
  u.erp_faculty_name,
  u.erp_department_name,
  u.erp_program_name,
  u.last_login_at,
  u.created_at,
  u.updated_at
`;

const VALID_ROLES = Object.freeze([
  'student',
  'staff',
  'faculty_staff',
  'executive',
  'admin',
  'super_admin',
]);

const VALID_STATUSES = Object.freeze(['active', 'disabled']);

export function isValidRole(role) {
  return VALID_ROLES.includes(role);
}

export function isValidStatus(status) {
  return VALID_STATUSES.includes(status);
}

export async function listUsers({
  q = null,
  role = null,
  facultyId = null, // 'null' string = filter เฉพาะที่ยังไม่มี faculty_id
  status = null,
  limit = 50,
  offset = 0,
} = {}) {
  const where = [];
  const params = [];

  if (q) {
    params.push(`%${q}%`);
    where.push(
      `(u.email ILIKE $${params.length} OR u.full_name ILIKE $${params.length} OR u.msu_id ILIKE $${params.length})`,
    );
  }
  if (role) {
    params.push(role);
    where.push(`u.role = $${params.length}`);
  }
  if (facultyId !== null) {
    if (facultyId === 'null') {
      where.push('u.faculty_id IS NULL');
    } else {
      params.push(facultyId);
      where.push(`u.faculty_id = $${params.length}`);
    }
  }
  if (status) {
    params.push(status);
    where.push(`u.status = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // นับ total ก่อน — ใช้ params ชุดเดียวกัน (ก่อน push limit/offset)
  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM users u ${whereSql}`,
    params,
  );
  const total = countResult.rows[0]?.total ?? 0;

  params.push(limit);
  params.push(offset);
  const { rows } = await query(
    `SELECT ${SELECT_COLUMNS}
       FROM users u
       ${whereSql}
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { items: rows, total };
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT ${SELECT_COLUMNS} FROM users u WHERE u.id = $1`,
    [id],
  );
  return rows[0] || null;
}

// นับ super_admin ที่ยัง active — ใช้ guard กฎ "ห้ามลบ super_admin คนสุดท้าย"
export async function countActiveSuperAdmins() {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n
       FROM users
      WHERE role = 'super_admin' AND status = 'active'`,
  );
  return rows[0]?.n ?? 0;
}

export async function updateRole(id, role) {
  const { rows } = await query(
    `UPDATE users
        SET role = $2, updated_at = now()
      WHERE id = $1
      RETURNING ${SELECT_COLUMNS.replaceAll('u.', '')}`,
    [id, role],
  );
  return rows[0] || null;
}

// faculty_id = null อนุญาต (ล้างคณะออก) — sync faculty_name อัตโนมัติด้วย subquery
export async function updateFacultyId(id, facultyId) {
  const { rows } = await query(
    `UPDATE users
        SET faculty_id   = $2,
            faculty_name = (SELECT name FROM faculties WHERE id = $2),
            updated_at   = now()
      WHERE id = $1
      RETURNING ${SELECT_COLUMNS.replaceAll('u.', '')}`,
    [id, facultyId],
  );
  return rows[0] || null;
}

export async function updateStatus(id, status) {
  const { rows } = await query(
    `UPDATE users
        SET status = $2, updated_at = now()
      WHERE id = $1
      RETURNING ${SELECT_COLUMNS.replaceAll('u.', '')}`,
    [id, status],
  );
  return rows[0] || null;
}
