import { query } from '../db/index.js';

const COLUMNS = 'id, code, name, category, is_active, created_at, updated_at';

// CRUD ใช้โดย super_admin (read = ACTIVE_ROLES — สำหรับ dropdown ทั่วไป)
//   category: nullable text. ปัจจุบันใช้ค่า 'A' = "มีนิสิตสังกัด" (และอาจขยายในอนาคต)
//   FK constraints (activities, users, activity_eligible_faculties) → ON DELETE RESTRICT
//   จึงไม่มี hard delete; super_admin ใช้ soft delete (is_active=false) เพื่อซ่อนจาก dropdown

// อ่าน list ของ faculties สำหรับ dropdown — เฉพาะ active เป็น default
//   filter:
//     - isActive: true/false/null
//     - q: ค้นด้วย code หรือ name (ILIKE)
//     - category: 'A' = มีนิสิตสังกัด (อ่านจาก faculties.category)
export async function listFaculties({ isActive = null, q = null, category = null } = {}) {
  const where = [];
  const params = [];
  if (isActive !== null) {
    params.push(isActive);
    where.push(`is_active = $${params.length}`);
  }
  if (category) {
    params.push(category);
    where.push(`category = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM faculties ${whereSql} ORDER BY code ASC`,
    params,
  );
  return rows;
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM faculties WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function findByCode(code) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM faculties WHERE code = $1`,
    [code],
  );
  return rows[0] || null;
}

export async function createFaculty({ code, name, category = null, is_active = true }) {
  const { rows } = await query(
    `INSERT INTO faculties (code, name, category, is_active)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNS}`,
    [code, name, category, is_active],
  );
  return rows[0];
}

// patch fields ที่ส่งมา (skip undefined) — แต่ category ส่ง null ได้ (clear)
export async function updateFaculty(id, patch) {
  const sets = [];
  const params = [id];
  if (patch.code !== undefined) {
    params.push(patch.code);
    sets.push(`code = $${params.length}`);
  }
  if (patch.name !== undefined) {
    params.push(patch.name);
    sets.push(`name = $${params.length}`);
  }
  if (patch.category !== undefined) {
    params.push(patch.category);
    sets.push(`category = $${params.length}`);
  }
  if (patch.is_active !== undefined) {
    params.push(patch.is_active);
    sets.push(`is_active = $${params.length}`);
  }
  if (sets.length === 0) return findById(id);
  const { rows } = await query(
    `UPDATE faculties
        SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    params,
  );
  return rows[0] || null;
}

// soft delete: is_active=true → false (ถ้าอยู่ false แล้วคืน null ให้ controller ตอบ 409)
export async function softDeleteFaculty(id) {
  const { rows } = await query(
    `UPDATE faculties
        SET is_active = false, updated_at = now()
      WHERE id = $1 AND is_active = true
      RETURNING ${COLUMNS}`,
    [id],
  );
  return rows[0] || null;
}
