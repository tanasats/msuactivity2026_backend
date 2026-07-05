import * as model from '../models/notification.model.js';
import * as prefModel from '../models/notification-preference.model.js';
import { CATEGORIES, CHANNELS, categoryDefault } from '../notifications/catalog.js';

const MAX_LIMIT = 50;
const CHANNEL_LABELS = { in_app: 'ในเว็บ', email: 'อีเมล' };

// GET /api/me/notifications?unread_only=&limit=&before=
export async function list(req, res) {
  const unreadOnly = req.query.unread_only === 'true';
  let limit = Number.parseInt(req.query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = 20;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  // before = ISO timestamp สำหรับ cursor แบ่งหน้า (ข้ามถ้ารูปแบบผิด)
  const before =
    typeof req.query.before === 'string' && !Number.isNaN(Date.parse(req.query.before))
      ? req.query.before
      : null;

  const [items, unread] = await Promise.all([
    model.listForUser(req.user.id, { unreadOnly, limit, before }),
    model.unreadCount(req.user.id),
  ]);
  res.json({ items, unread_count: unread });
}

// POST /api/me/notifications/:id/read
export async function markRead(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ status: 'error', message: 'invalid id' });
  }
  const changed = await model.markRead(req.user.id, id);
  res.json({ status: 'ok', changed });
}

// POST /api/me/notifications/read-all
export async function markAllRead(req, res) {
  const changed = await model.markAllRead(req.user.id);
  res.json({ status: 'ok', changed });
}

// ── preferences (เมทริกซ์ หมวด × ช่องทาง) ─────────────────────────

// GET /api/me/notification-preferences
//   คืน: channels_meta (ช่องทาง+เปิดใช้ระดับระบบ), master (ต่อช่องทางของ user),
//        categories (เฉพาะที่ role นี้เห็น + ค่า effective ต่อช่องทาง)
export async function getPreferences(req, res) {
  const { role } = req.user;
  const pref = await prefModel.get(req.user.id); // { channels, prefs } | null

  const channelsMeta = [];
  for (const ch of CHANNELS) {
    channelsMeta.push({
      key: ch,
      label: CHANNEL_LABELS[ch] ?? ch,
      enabled: await prefModel.getChannelGlobalEnabled(ch), // kill-switch ระดับระบบ
    });
  }

  const master = {};
  for (const ch of CHANNELS) master[ch] = pref?.channels?.[ch] !== false; // default เปิด

  const categories = Object.entries(CATEGORIES)
    .filter(([, meta]) => meta.roles.includes(role))
    .map(([key, meta]) => {
      const values = {};
      for (const ch of CHANNELS) {
        const override = pref?.prefs?.[key]?.[ch];
        values[ch] = override === undefined ? categoryDefault(key, ch) : override !== false;
      }
      return { key, label: meta.label, values };
    });

  res.json({ channels_meta: channelsMeta, master, categories });
}

// รับเฉพาะ key ช่องทางที่รู้จัก + coerce boolean
function pickChannels(obj) {
  const out = {};
  for (const ch of CHANNELS) if (ch in obj) out[ch] = obj[ch] !== false;
  return out;
}
// รับเฉพาะ category ที่รู้จัก × ช่องทางที่รู้จัก + boolean
function pickPrefs(obj) {
  const out = {};
  for (const [cat, chans] of Object.entries(obj)) {
    if (!(cat in CATEGORIES) || !chans || typeof chans !== 'object') continue;
    const clean = pickChannels(chans);
    if (Object.keys(clean).length) out[cat] = clean;
  }
  return out;
}

// PUT /api/me/notification-preferences  body: { channels?, prefs? }
//   frontend ส่งสถานะเมทริกซ์ทั้งก้อน → แทนที่ทั้ง object (upsert COALESCE เก็บส่วนที่ไม่ส่ง)
export async function updatePreferences(req, res) {
  const body = req.body ?? {};
  const channels =
    body.channels && typeof body.channels === 'object' ? pickChannels(body.channels) : undefined;
  const prefs =
    body.prefs && typeof body.prefs === 'object' ? pickPrefs(body.prefs) : undefined;
  if (channels === undefined && prefs === undefined) {
    return res.status(400).json({ status: 'error', message: 'ต้องมี channels หรือ prefs อย่างน้อย 1 อย่าง' });
  }
  const saved = await prefModel.upsert(req.user.id, { channels, prefs });
  res.json({ status: 'ok', ...saved });
}
