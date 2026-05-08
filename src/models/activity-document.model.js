import { query } from '../db/index.js';

// activity_files (kind='DOCUMENT') — เอกสารประกอบของกิจกรรม
//   - หลายไฟล์ต่อกิจกรรม
//   - display_name (nullable) ตั้งโดยผู้สร้าง — null = ใช้ filename เดิม
//   - is_public — true = แสดงใน public detail page

const COLUMNS = `
  id, activity_id, kind, filename, display_name, mime_type, size_bytes,
  storage_key, is_public, display_order, uploaded_by, uploaded_at
`;

// list documents ของกิจกรรม (เฉพาะ kind=DOCUMENT)
//   onlyPublic = true → filter is_public เท่านั้น (ใช้กับ public detail)
export async function listDocuments(activityId, { onlyPublic = false } = {}) {
  const where = ['activity_id = $1', "kind = 'DOCUMENT'"];
  if (onlyPublic) where.push('is_public = true');
  const { rows } = await query(
    `SELECT ${COLUMNS}
       FROM activity_files
      WHERE ${where.join(' AND ')}
      ORDER BY display_order ASC, uploaded_at ASC`,
    [activityId],
  );
  return rows;
}

export async function findDocumentById(activityId, fileId) {
  const { rows } = await query(
    `SELECT ${COLUMNS}
       FROM activity_files
      WHERE id = $1 AND activity_id = $2 AND kind = 'DOCUMENT'`,
    [fileId, activityId],
  );
  return rows[0] || null;
}

export async function createDocument({
  activity_id,
  filename,
  display_name,
  mime_type,
  size_bytes,
  storage_key,
  is_public,
  uploaded_by,
}) {
  const { rows } = await query(
    `INSERT INTO activity_files
       (activity_id, kind, filename, display_name, mime_type, size_bytes,
        storage_key, is_public, uploaded_by)
     VALUES ($1, 'DOCUMENT', $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${COLUMNS}`,
    [
      activity_id,
      filename,
      display_name ?? null,
      mime_type,
      size_bytes,
      storage_key,
      is_public,
      uploaded_by,
    ],
  );
  return rows[0];
}

// patch: เปลี่ยน display_name + is_public — ไม่แตะ file content
export async function updateDocument(fileId, { display_name, is_public }) {
  const { rows } = await query(
    `UPDATE activity_files SET
       display_name = CASE WHEN $2::boolean THEN $3 ELSE display_name END,
       is_public    = COALESCE($4, is_public)
      WHERE id = $1 AND kind = 'DOCUMENT'
      RETURNING ${COLUMNS}`,
    [
      fileId,
      display_name !== undefined,    // flag: ตั้งใจเปลี่ยน
      display_name ?? null,           // ค่าใหม่ (รวม null = ลบชื่อ → fallback filename)
      is_public ?? null,
    ],
  );
  return rows[0] || null;
}

export async function deleteDocument(fileId) {
  const { rows } = await query(
    `DELETE FROM activity_files
      WHERE id = $1 AND kind = 'DOCUMENT'
      RETURNING storage_key`,
    [fileId],
  );
  return rows[0] || null;
}
