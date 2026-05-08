import { query } from '../db/index.js';

const COLUMNS = 'id, code, name, is_active, created_at, updated_at';

export async function listSkills({ isActive = null, q = null } = {}) {
  const where = [];
  const params = [];
  if (isActive !== null) {
    params.push(isActive);
    where.push(`is_active = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM skills ${whereSql} ORDER BY code ASC`,
    params,
  );
  return rows;
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM skills WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function findByCode(code) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM skills WHERE code = $1`,
    [code],
  );
  return rows[0] || null;
}

export async function createSkill({ code, name, is_active = true }) {
  const { rows } = await query(
    `INSERT INTO skills (code, name, is_active)
     VALUES ($1, $2, $3)
     RETURNING ${COLUMNS}`,
    [code, name, is_active],
  );
  return rows[0];
}

export async function updateSkill(id, { code, name, is_active }) {
  const { rows } = await query(
    `UPDATE skills SET
       code       = COALESCE($2, code),
       name       = COALESCE($3, name),
       is_active  = COALESCE($4, is_active),
       updated_at = now()
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id, code ?? null, name ?? null, is_active ?? null],
  );
  return rows[0] || null;
}

export async function softDeleteSkill(id) {
  const { rows } = await query(
    `UPDATE skills
       SET is_active = false, updated_at = now()
     WHERE id = $1 AND is_active = true
     RETURNING ${COLUMNS}`,
    [id],
  );
  return rows[0] || null;
}
