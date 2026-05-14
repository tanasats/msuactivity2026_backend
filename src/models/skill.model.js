import { query } from '../db/index.js';

// skill มี 2 ระดับ:
//   parent (parent_id=NULL, academic_year=NULL) — รายการแม่ ใช้ข้ามปี
//   child  (parent_id NOT NULL, academic_year NOT NULL) — รายการรายปี ของปีนั้น
// activity_skills ผูกเข้ากับ child เท่านั้น (validate ที่ controller)
// รายงาน rollup ใช้ COALESCE(parent_id, id) เพื่อรวม edge case ที่ผูก parent ตรง

const COLUMNS =
  'id, code, name, parent_id, academic_year, is_active, created_at, updated_at';

// คืน parent_code / parent_name ด้วย (สำหรับ list children — display "S1: <child name>")
const COLUMNS_WITH_PARENT = `
  s.id, s.code, s.name, s.parent_id, s.academic_year, s.is_active,
  s.created_at, s.updated_at,
  p.code AS parent_code, p.name AS parent_name
`;

// listSkills:
//   - filter ระดับ: scope='parent' (parent_id IS NULL), 'child' (parent_id IS NOT NULL), 'all'
//   - filter ปี: academicYear (เฉพาะ scope=child หรือ all)
//   - filter parent: parentId (เฉพาะ scope=child หรือ all)
//   - search q: code/name ทั้ง self + parent
//   - isActive: true/false/null
export async function listSkills({
  scope = 'all',
  parentId = null,
  academicYear = null,
  isActive = null,
  q = null,
} = {}) {
  const where = [];
  const params = [];

  if (scope === 'parent') {
    where.push('s.parent_id IS NULL');
  } else if (scope === 'child') {
    where.push('s.parent_id IS NOT NULL');
  }

  if (parentId !== null) {
    params.push(parentId);
    where.push(`s.parent_id = $${params.length}`);
  }
  if (academicYear !== null) {
    params.push(academicYear);
    where.push(`s.academic_year = $${params.length}`);
  }
  if (isActive !== null) {
    params.push(isActive);
    where.push(`s.is_active = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(
      `(s.code ILIKE $${params.length} OR s.name ILIKE $${params.length}
         OR p.code ILIKE $${params.length} OR p.name ILIKE $${params.length})`,
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // sort: parent code → year DESC → child code (ให้ children เรียงในกลุ่ม parent)
  const { rows } = await query(
    `SELECT ${COLUMNS_WITH_PARENT}
       FROM skills s
       LEFT JOIN skills p ON p.id = s.parent_id
       ${whereSql}
      ORDER BY COALESCE(p.code, s.code) ASC,
               s.academic_year DESC NULLS FIRST,
               s.code ASC`,
    params,
  );
  return rows;
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT ${COLUMNS_WITH_PARENT}
       FROM skills s
       LEFT JOIN skills p ON p.id = s.parent_id
      WHERE s.id = $1`,
    [id],
  );
  return rows[0] || null;
}

// หา parent ที่ active ตาม code (ใช้ตอน seed/lookup)
export async function findParentByCode(code) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM skills
      WHERE code = $1 AND parent_id IS NULL`,
    [code],
  );
  return rows[0] || null;
}

// หา child ตาม (parent_id, academic_year, code)
export async function findChildByKey({ parentId, academicYear, code }) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM skills
      WHERE parent_id = $1 AND academic_year = $2 AND code = $3`,
    [parentId, academicYear, code],
  );
  return rows[0] || null;
}

export async function createSkill({
  code,
  name,
  parent_id = null,
  academic_year = null,
  is_active = true,
}) {
  const { rows } = await query(
    `INSERT INTO skills (code, name, parent_id, academic_year, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLUMNS}`,
    [code, name, parent_id, academic_year, is_active],
  );
  return rows[0];
}

// updateSkill: อนุญาตให้แก้ code/name/is_active เท่านั้น
//   ไม่ให้แก้ parent_id หรือ academic_year — ถ้าอยากเปลี่ยน ให้สร้างใหม่+ลบ
//   (กันกระทบ activity_skills ที่อ้างถึง)
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

// นับว่า parent ตัวนี้มี child กี่ตัว (ใช้ตอน soft-delete parent — เตือนผู้ใช้)
export async function countChildren(parentId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM skills WHERE parent_id = $1`,
    [parentId],
  );
  return rows[0]?.n ?? 0;
}

// validate ว่า skill_ids ที่ส่งเข้ามาเป็น child ของปีที่ระบุทั้งหมดหรือไม่
//   ใช้ตอน create/update activity เพื่อกัน admin ผูก parent ตรง หรือผูก child ข้ามปี
//   คืน { ok: true } หรือ { ok: false, invalid: [id...] }
export async function validateSkillIdsForYear(skillIds, academicYear) {
  if (!skillIds || skillIds.length === 0) return { ok: true };
  const { rows } = await query(
    `SELECT id, parent_id, academic_year FROM skills
      WHERE id = ANY($1::int[])`,
    [skillIds],
  );
  const found = new Map(rows.map((r) => [r.id, r]));
  const invalid = [];
  for (const id of skillIds) {
    const r = found.get(id);
    if (!r) {
      invalid.push(id);
      continue;
    }
    // ต้องเป็น child (parent_id NOT NULL) + ปีตรง
    if (r.parent_id === null || r.academic_year !== academicYear) {
      invalid.push(id);
    }
  }
  return invalid.length === 0 ? { ok: true } : { ok: false, invalid };
}
