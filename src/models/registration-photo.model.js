import { query } from '../db/index.js';

// ดึง registration พร้อม context ที่ใช้ตรวจสิทธิ์อัปโหลด/ลบรูป
//   - ตรวจ user_id เพื่อ enforce ownership
//   - ตรวจ evaluation_status='PASSED' (เงื่อนไขเปิดให้ใส่รูปหลักฐาน)
export async function findRegistrationContext(registrationId) {
  const { rows } = await query(
    `SELECT r.id              AS registration_id,
            r.user_id,
            r.activity_id,
            r.status          AS registration_status,
            r.evaluation_status,
            a.faculty_id      AS activity_faculty_id,
            a.status          AS activity_status
       FROM registrations r
       JOIN activities a ON a.id = r.activity_id
      WHERE r.id = $1`,
    [registrationId],
  );
  return rows[0] || null;
}

// list รูปทั้งหมดของ registration — ลำดับเก่าไปใหม่
export async function listByRegistration(registrationId) {
  const { rows } = await query(
    `SELECT id, registration_id, storage_key, filename, mime_type, size_bytes, uploaded_at
       FROM registration_photos
      WHERE registration_id = $1
      ORDER BY uploaded_at ASC, id ASC`,
    [registrationId],
  );
  return rows;
}

// list รูปของหลาย registration พร้อมกัน (ใช้ใน student dashboard ที่โหลดประวัติทั้งหมด)
//   คืน Map<registration_id, photo[]>
export async function listByRegistrations(registrationIds) {
  if (registrationIds.length === 0) return new Map();
  const { rows } = await query(
    `SELECT id, registration_id, storage_key, filename, mime_type, size_bytes, uploaded_at
       FROM registration_photos
      WHERE registration_id = ANY($1::int[])
      ORDER BY uploaded_at ASC, id ASC`,
    [registrationIds],
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.registration_id)) map.set(r.registration_id, []);
    map.get(r.registration_id).push(r);
  }
  return map;
}

// นับรูปของ registration (ใช้ตรวจ limit ≤ 5 ก่อน insert)
export async function countByRegistration(registrationId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count FROM registration_photos WHERE registration_id = $1`,
    [registrationId],
  );
  return rows[0].count;
}

// insert รูปใหม่
export async function insertPhoto({
  registrationId,
  storageKey,
  filename,
  mimeType,
  sizeBytes,
}) {
  const { rows } = await query(
    `INSERT INTO registration_photos
       (registration_id, storage_key, filename, mime_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, registration_id, storage_key, filename, mime_type, size_bytes, uploaded_at`,
    [registrationId, storageKey, filename, mimeType, sizeBytes],
  );
  return rows[0];
}

// หา photo + registration_id (ใช้ตรวจ ownership ก่อนลบ)
export async function findPhoto(photoId) {
  const { rows } = await query(
    `SELECT p.id, p.registration_id, p.storage_key, r.user_id
       FROM registration_photos p
       JOIN registrations r ON r.id = p.registration_id
      WHERE p.id = $1`,
    [photoId],
  );
  return rows[0] || null;
}

// ลบ photo จาก DB — คืน storage_key เพื่อให้ controller ลบใน S3 ต่อ
export async function deletePhoto(photoId) {
  const { rows } = await query(
    `DELETE FROM registration_photos WHERE id = $1 RETURNING storage_key`,
    [photoId],
  );
  return rows[0]?.storage_key ?? null;
}
