import { query } from '../db/index.js';

// activity_files (kind='GALLERY') — รูปประกอบกิจกรรม (เพิ่มหลังกิจกรรมเริ่ม)
//   - หลายรูปต่อกิจกรรม (max ตรวจใน controller)
//   - public ทั้งหมด (ไม่มี is_public flag เหมือน document)
//   - เปิดให้แก้ "ระหว่าง WORK" เท่านั้น (ตรวจใน controller)

const COLUMNS = `
  id, activity_id, kind, filename, mime_type, size_bytes,
  storage_key, display_order, uploaded_by, uploaded_at
`;

export async function listGallery(activityId) {
  const { rows } = await query(
    `SELECT ${COLUMNS}
       FROM activity_files
      WHERE activity_id = $1 AND kind = 'GALLERY'
      ORDER BY display_order ASC, uploaded_at ASC, id ASC`,
    [activityId],
  );
  return rows;
}

export async function findGalleryById(activityId, fileId) {
  const { rows } = await query(
    `SELECT ${COLUMNS}
       FROM activity_files
      WHERE id = $1 AND activity_id = $2 AND kind = 'GALLERY'`,
    [fileId, activityId],
  );
  return rows[0] || null;
}

// นับรูปใน gallery — ใช้บังคับ limit ก่อน insert
export async function countGallery(activityId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n
       FROM activity_files
      WHERE activity_id = $1 AND kind = 'GALLERY'`,
    [activityId],
  );
  return rows[0]?.n ?? 0;
}

export async function createGallery({
  activity_id,
  filename,
  mime_type,
  size_bytes,
  storage_key,
  uploaded_by,
}) {
  const { rows } = await query(
    `INSERT INTO activity_files
       (activity_id, kind, filename, mime_type, size_bytes,
        storage_key, uploaded_by)
     VALUES ($1, 'GALLERY', $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [activity_id, filename, mime_type, size_bytes, storage_key, uploaded_by],
  );
  return rows[0];
}

export async function deleteGallery(fileId) {
  const { rows } = await query(
    `DELETE FROM activity_files
      WHERE id = $1 AND kind = 'GALLERY'
      RETURNING storage_key`,
    [fileId],
  );
  return rows[0] || null;
}
