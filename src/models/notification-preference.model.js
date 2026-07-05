import { query } from '../db/index.js';

// ── notification_preferences model ───────────────────────────────
//   ไม่มีแถว = ใช้ default ในโค้ดทั้งหมด (ไม่ต้อง backfill ผู้ใช้เดิม)

export async function get(userId) {
  const { rows } = await query(
    `SELECT channels, prefs FROM notification_preferences WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

// ดึงหลาย user ในคำสั่งเดียว → Map<userId, {channels, prefs}> (ใช้ตอน fan-out)
export async function getMany(userIds) {
  const map = new Map();
  if (!userIds?.length) return map;
  const { rows } = await query(
    `SELECT user_id, channels, prefs FROM notification_preferences WHERE user_id = ANY($1)`,
    [userIds],
  );
  for (const r of rows) map.set(r.user_id, { channels: r.channels, prefs: r.prefs });
  return map;
}

// upsert — merge เฉพาะ field ที่ส่งมา (channels / prefs)
export async function upsert(userId, { channels, prefs }) {
  const { rows } = await query(
    `INSERT INTO notification_preferences (user_id, channels, prefs, updated_at)
       VALUES ($1, COALESCE($2, '{}'::jsonb), COALESCE($3, '{}'::jsonb), now())
     ON CONFLICT (user_id) DO UPDATE SET
       channels = COALESCE($2, notification_preferences.channels),
       prefs    = COALESCE($3, notification_preferences.prefs),
       updated_at = now()
     RETURNING channels, prefs`,
    [userId, channels ?? null, prefs ?? null],
  );
  return rows[0];
}

// global kill-switch ต่อช่องทาง (system_settings key 'notify.{channel}.enabled')
//   default true ถ้าไม่มี row (in_app), แต่ email seed ไว้ false ในเฟสนี้
export async function getChannelGlobalEnabled(channel) {
  const { rows } = await query(
    `SELECT value FROM system_settings WHERE key = $1`,
    [`notify.${channel}.enabled`],
  );
  if (!rows.length) return true;
  return rows[0].value === true || rows[0].value === 'true';
}
