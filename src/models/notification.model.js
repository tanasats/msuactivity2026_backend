import { query } from '../db/index.js';

// ── notifications (in-app) model ─────────────────────────────────

// ผู้ใช้ active ตาม role (ใช้ตอน resolve ผู้รับแบบกลุ่ม เช่น admin queue / ประกาศ)
export async function getActiveUsersByRole(roles) {
  if (!roles?.length) return [];
  const { rows } = await query(
    `SELECT id, email FROM users WHERE role = ANY($1) AND status = 'active'`,
    [roles],
  );
  return rows;
}

// email ของ user ids (ใช้ตอน email channel enrich ผู้รับที่ resolver ไม่ได้แนบ email มา)
export async function getEmailsByIds(ids) {
  const map = new Map();
  if (!ids?.length) return map;
  const { rows } = await query(`SELECT id, email FROM users WHERE id = ANY($1)`, [ids]);
  for (const r of rows) map.set(r.id, r.email);
  return map;
}

// batch insert แจ้งเตือน in-app — กันซ้ำด้วย dedupe_key (unique) → ON CONFLICT DO NOTHING
//   rows: [{ userId, eventType, category, title, body, linkUrl,
//            relatedActivityId, relatedRegistrationId, dedupeKey }]
//   คืนจำนวนที่ insert จริง (ที่ไม่ชน dedupe)
// chunk ขนาดปลอดภัยต่อ 1 คำสั่ง: 1000 แถว × 9 คอลัมน์ = 9000 params < 65535 (Postgres bind limit)
//   fan-out ใหญ่ (เช่น แจ้งผู้สมัครทุกคน) แบ่งเป็นหลายคำสั่ง กัน "too many parameters"
const INSERT_CHUNK = 1000;

export async function insertMany(rows) {
  if (!rows?.length) return 0;
  const cols = [
    'user_id',
    'event_type',
    'category',
    'title',
    'body',
    'link_url',
    'related_activity_id',
    'related_registration_id',
    'dedupe_key',
  ];
  let total = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    const chunk = rows.slice(start, start + INSERT_CHUNK);
    const values = [];
    const params = [];
    chunk.forEach((r, i) => {
      const base = i * cols.length;
      values.push(`(${cols.map((_, j) => `$${base + j + 1}`).join(', ')})`);
      params.push(
        r.userId,
        r.eventType,
        r.category,
        r.title,
        r.body ?? null,
        r.linkUrl ?? null,
        r.relatedActivityId ?? null,
        r.relatedRegistrationId ?? null,
        r.dedupeKey ?? null,
      );
    });
    const { rowCount } = await query(
      `INSERT INTO notifications (${cols.join(', ')})
       VALUES ${values.join(', ')}
       ON CONFLICT (dedupe_key) DO NOTHING`,
      params,
    );
    total += rowCount;
  }
  return total;
}

const FEED_COLUMNS = `
  id, event_type, category, title, body, link_url,
  related_activity_id, related_registration_id,
  is_read, read_at, created_at
`;

// feed ของผู้ใช้ — cursor แบบ before (created_at) เพื่อแบ่งหน้า
export async function listForUser(userId, { unreadOnly = false, limit = 20, before = null } = {}) {
  const where = ['user_id = $1'];
  const params = [userId];
  if (unreadOnly) where.push('is_read = false');
  if (before) {
    params.push(before);
    where.push(`created_at < $${params.length}`);
  }
  params.push(limit);
  const { rows } = await query(
    `SELECT ${FEED_COLUMNS}
       FROM notifications
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export async function unreadCount(userId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND is_read = false`,
    [userId],
  );
  return rows[0].n;
}

// ทำเครื่องหมายอ่าน 1 รายการ (เฉพาะของ user นั้น) — คืน true ถ้ามีการเปลี่ยน
export async function markRead(userId, id) {
  const { rowCount } = await query(
    `UPDATE notifications SET is_read = true, read_at = now()
      WHERE id = $1 AND user_id = $2 AND is_read = false`,
    [id, userId],
  );
  return rowCount > 0;
}

// ทำเครื่องหมายอ่านทั้งหมด — คืนจำนวนที่เปลี่ยน
export async function markAllRead(userId) {
  const { rowCount } = await query(
    `UPDATE notifications SET is_read = true, read_at = now()
      WHERE user_id = $1 AND is_read = false`,
    [userId],
  );
  return rowCount;
}

// ลบ notification 1 รายการ (เฉพาะของ user นั้น) — คืน true ถ้าลบจริง
export async function deleteOne(userId, id) {
  const { rowCount } = await query(
    `DELETE FROM notifications WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return rowCount > 0;
}

// retention — ลบ notification ที่ "อ่านแล้ว" และเก่ากว่า N วัน (กันตารางโต)
export async function pruneReadOlderThan(days = 90) {
  const { rowCount } = await query(
    `DELETE FROM notifications
      WHERE is_read = true AND created_at < now() - ($1 || ' days')::interval`,
    [String(days)],
  );
  return rowCount;
}
