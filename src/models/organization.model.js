import { query } from '../db/index.js';

// คอลัมน์ที่ส่งกลับ + นับจำนวน activity ที่อ้างอิง (ใช้ตอน DELETE / แสดงผล)
const SELECT_COLUMNS = `
  o.id,
  o.code,
  o.name,
  o.parent_id,
  o.is_active,
  o.created_at,
  o.updated_at
`;

export async function listOrganizations({ isActive = null, parentId = null, q = null } = {}) {
  const where = [];
  const params = [];

  if (isActive !== null) {
    params.push(isActive);
    where.push(`o.is_active = $${params.length}`);
  }
  if (parentId !== null) {
    if (parentId === 'null') {
      where.push('o.parent_id IS NULL');
    } else {
      params.push(parentId);
      where.push(`o.parent_id = $${params.length}`);
    }
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(o.code ILIKE $${params.length} OR o.name ILIKE $${params.length})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT ${SELECT_COLUMNS}
       FROM organizations o
       ${whereSql}
       ORDER BY o.code ASC`,
    params,
  );
  return rows;
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT ${SELECT_COLUMNS} FROM organizations o WHERE o.id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function findByCode(code) {
  const { rows } = await query(
    `SELECT ${SELECT_COLUMNS} FROM organizations o WHERE o.code = $1`,
    [code],
  );
  return rows[0] || null;
}

export async function createOrganization({ code, name, parent_id = null, is_active = true }) {
  const { rows } = await query(
    `INSERT INTO organizations (code, name, parent_id, is_active)
     VALUES ($1, $2, $3, $4)
     RETURNING ${SELECT_COLUMNS.replaceAll('o.', '')}`,
    [code, name, parent_id, is_active],
  );
  return rows[0];
}

export async function updateOrganization(id, { code, name, parent_id, is_active }) {
  const { rows } = await query(
    `UPDATE organizations SET
       code       = COALESCE($2, code),
       name       = COALESCE($3, name),
       parent_id  = CASE WHEN $5::boolean THEN $4 ELSE parent_id END,
       is_active  = COALESCE($6, is_active),
       updated_at = now()
     WHERE id = $1
     RETURNING ${SELECT_COLUMNS.replaceAll('o.', '')}`,
    [
      id,
      code ?? null,
      name ?? null,
      parent_id ?? null,
      parent_id !== undefined,   // flag — ให้ตั้ง parent_id เป็น NULL ตามใจได้
      is_active ?? null,
    ],
  );
  return rows[0] || null;
}

// soft-delete: set is_active = false (ตาม memory: ห้ามลบจริงเพราะ FK reference จาก activities)
export async function softDeleteOrganization(id) {
  const { rows } = await query(
    `UPDATE organizations
       SET is_active = false, updated_at = now()
     WHERE id = $1 AND is_active = true
     RETURNING ${SELECT_COLUMNS.replaceAll('o.', '')}`,
    [id],
  );
  return rows[0] || null;
}

// ตรวจ cycle ของ parent_id (กัน A→B→A เมื่อ update)
// คืน true ถ้าการตั้ง parent_id=newParent ให้ org id=self จะสร้าง cycle
export async function wouldCreateCycle(self, newParent) {
  if (newParent === null || newParent === undefined) return false;
  if (Number(newParent) === Number(self)) return true;

  const { rows } = await query(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_id FROM organizations WHERE id = $1
       UNION ALL
       SELECT o.id, o.parent_id FROM organizations o
         JOIN chain c ON o.id = c.parent_id
     )
     SELECT 1 FROM chain WHERE id = $2 LIMIT 1`,
    [newParent, self],
  );
  return rows.length > 0;
}
