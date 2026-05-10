import * as settings from '../models/system-setting.model.js';

function err(res, status, message) {
  return res.status(status).json({ status: 'error', message });
}

// allow-list ของ key ที่ super_admin แก้ผ่าน API ได้ + validator + side effect
//   integer: ใช้ min/max
//   onSave: ฟังก์ชัน async ที่จะเรียกหลัง save สำเร็จ (เช่น reload cache)
const SETTING_SCHEMA = {
  'check_in.default_window_before_minutes': {
    type: 'integer',
    min: 0,
    max: 240,
  },
  'check_in.default_window_after_minutes': {
    type: 'integer',
    min: 0,
    max: 240,
  },
};

function validateValue(schema, value) {
  if (schema.type === 'integer') {
    const n = Number(value);
    if (!Number.isInteger(n)) return { ok: false, message: 'ต้องเป็นจำนวนเต็ม' };
    if (n < schema.min || n > schema.max) {
      return {
        ok: false,
        message: `ต้องอยู่ระหว่าง ${schema.min}–${schema.max}`,
      };
    }
    return { ok: true, value: n };
  }
  return { ok: false, message: 'ไม่รองรับ type นี้' };
}

// GET /api/admin/settings
//   query: ?prefix=academic_year.   (optional)
//   คืนเฉพาะ key ที่อยู่ใน SETTING_SCHEMA (กัน leak settings อื่น)
export async function list(req, res) {
  const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : null;
  const all = await settings.listSettings(prefix);
  const allowedKeys = new Set(Object.keys(SETTING_SCHEMA));
  const items = all
    .filter((s) => allowedKeys.has(s.key))
    .map((s) => ({
      key: s.key,
      value: s.value,
      updated_by: s.updated_by,
      updated_at: s.updated_at,
      schema: {
        type: SETTING_SCHEMA[s.key].type,
        min: SETTING_SCHEMA[s.key].min,
        max: SETTING_SCHEMA[s.key].max,
      },
    }));
  res.json({ items });
}

// PUT /api/admin/settings/:key  body: { value }
export async function update(req, res) {
  const key = req.params.key;
  const schema = SETTING_SCHEMA[key];
  if (!schema) return err(res, 400, `ไม่อนุญาตให้แก้ setting "${key}"`);

  const v = validateValue(schema, req.body?.value);
  if (!v.ok) return err(res, 400, `value ${v.message}`);

  const saved = await settings.upsertSetting(key, v.value, req.user.id);

  // side effect — เช่น reload academic-year cache หลังเปลี่ยนค่า
  if (typeof schema.onSave === 'function') {
    try {
      await schema.onSave();
    } catch (e) {
      // log แต่ไม่ fail request — ข้อมูล save แล้ว
      console.warn(`[setting ${key}] onSave failed:`, e.message);
    }
  }

  res.json({
    status: 'ok',
    setting: {
      key: saved.key,
      value: saved.value,
      updated_by: saved.updated_by,
      updated_at: saved.updated_at,
    },
  });
}
