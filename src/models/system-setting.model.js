import { query } from '../db/index.js';

// ตาราง system_settings เป็น key-value config (jsonb value) ที่ super_admin ปรับได้
//   key = ชื่อ setting (string)
//   value = jsonb (number/string/object/array)
//
// ปัจจุบันใช้:
//   - check_in.default_window_before_minutes / _after_minutes
//   - academic_year.start_month / start_day

export async function listSettings(prefix = null) {
  const where = prefix ? `WHERE key LIKE $1` : '';
  const params = prefix ? [`${prefix}%`] : [];
  const { rows } = await query(
    `SELECT key, value, updated_by, updated_at
       FROM system_settings
       ${where}
       ORDER BY key`,
    params,
  );
  return rows;
}

export async function getSetting(key) {
  const { rows } = await query(
    `SELECT key, value, updated_by, updated_at
       FROM system_settings
      WHERE key = $1`,
    [key],
  );
  return rows[0] || null;
}

// upsert (insert ใหม่ถ้ายังไม่มี / update ถ้ามี)
//   value ส่งเป็น JS value แล้ว stringify → jsonb
export async function upsertSetting(key, value, updatedBy) {
  const { rows } = await query(
    `INSERT INTO system_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (key)
     DO UPDATE SET
       value      = EXCLUDED.value,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING key, value, updated_by, updated_at`,
    [key, JSON.stringify(value), updatedBy],
  );
  return rows[0];
}
