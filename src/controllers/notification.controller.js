import * as model from '../models/notification.model.js';
import * as prefModel from '../models/notification-preference.model.js';
import * as annModel from '../models/announcement.model.js';
import { CATEGORIES, CHANNELS, categoryDefault, categoryChannels } from '../notifications/catalog.js';
import { verifyTransport, sendMail } from '../utils/mailer.js';
import { enqueueMany } from '../models/email-outbox.model.js';
import { renderEmail } from '../emails/layout.js';
import { logMessagesSent } from '../models/user-audit.model.js';
import { auditMetaFromReq } from '../models/activity-audit.model.js';

const MAX_MESSAGE_RECIPIENTS = 500; // cap กัน param-limit (ส่งกลุ่มใหญ่เป็นฟีเจอร์แยก)

const MAX_LIMIT = 50;
const CHANNEL_LABELS = { in_app: 'ในเว็บ', email: 'อีเมล' };

// ประกาศ (broadcast) แสดงในกระดิ่งไหม — เคารพ preference in-app หมวด announcement (default เปิด)
function announcementInAppEnabled(pref) {
  if (pref?.channels?.in_app === false) return false;
  const o = pref?.prefs?.announcement?.in_app;
  return o === undefined ? categoryDefault('announcement', 'in_app') : o !== false;
}

// map ประกาศ → feed item (source='announcement') ให้ shape เดียวกับ notification ส่วนตัว
function announcementToItem(a, isRead) {
  return {
    source: 'announcement',
    id: a.id,
    event_type: 'announcement',
    category: 'announcement',
    title: a.title ?? 'ประกาศ',
    body: a.body ?? null,
    link_url: a.link_url ?? null,
    related_activity_id: null,
    related_registration_id: null,
    is_read: isRead,
    read_at: null,
    created_at: a.created_at,
  };
}

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

  const userId = req.user.id;
  const [personal, personalUnread, pref] = await Promise.all([
    model.listForUser(userId, { unreadOnly, limit, before }),
    model.unreadCount(userId),
    prefModel.get(userId),
  ]);

  // ผสมประกาศ active (broadcast) — 1 แถว/ประกาศ + read-state (ไม่ fan-out)
  let annItems = [];
  let annUnread = 0;
  if (announcementInAppEnabled(pref)) {
    const visible = await annModel.listVisibleForUser(req.user.role, req.user.faculty_id);
    if (visible.length) {
      const readSet = await annModel.getReadAnnouncementIds(
        userId,
        visible.map((a) => a.id),
      );
      annUnread = visible.filter((a) => !readSet.has(a.id)).length;
      annItems = visible.map((a) => announcementToItem(a, readSet.has(a.id)));
      if (unreadOnly) annItems = annItems.filter((i) => !i.is_read);
    }
  }

  const items = [
    ...personal.map((n) => ({ ...n, source: 'personal' })),
    ...annItems,
  ]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);

  res.json({ items, unread_count: personalUnread + annUnread });
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

// DELETE /api/me/notifications/:id — ลบ notification ส่วนตัวที่ไม่ต้องการ
//   (ประกาศ broadcast ลบไม่ได้ — เป็นของกลาง; frontend ซ่อนปุ่มลบให้)
export async function deleteNotification(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ status: 'error', message: 'invalid id' });
  }
  const deleted = await model.deleteOne(req.user.id, id);
  res.json({ status: 'ok', deleted });
}

// POST /api/me/notifications/read-all — อ่านทั้ง notification ส่วนตัว + ประกาศ active
export async function markAllRead(req, res) {
  const changedPersonal = await model.markAllRead(req.user.id);
  const visible = await annModel.listVisibleForUser(req.user.role, req.user.faculty_id);
  const changedAnn = await annModel.markAnnouncementsRead(
    req.user.id,
    visible.map((a) => a.id),
  );
  res.json({ status: 'ok', changed: changedPersonal + changedAnn });
}

// POST /api/me/announcements/:id/read — อ่านประกาศ broadcast 1 รายการ
export async function markAnnouncementReadCtrl(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ status: 'error', message: 'invalid id' });
  }
  const changed = await annModel.markAnnouncementRead(req.user.id, id);
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
      const channels = categoryChannels(key); // ช่องทางที่หมวดนี้ส่งได้จริง
      const values = {};
      for (const ch of CHANNELS) {
        const override = pref?.prefs?.[key]?.[ch];
        values[ch] = override === undefined ? categoryDefault(key, ch) : override !== false;
      }
      return { key, label: meta.label, channels, values };
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

// ── admin ส่งข้อความแจ้งเตือนถึงผู้ใช้รายบุคคล (in-app เสมอ + email ถ้าเลือก) ─
// POST /api/admin/notifications/message
//   body: { user_ids: number[], title, body, link_url?, send_email?: bool }
//   in-app: ส่งถึงเสมอ (bypass preference) · email: ถ้า send_email + kill-switch เปิด (ไม่เช็ค pref รายคน)
export async function sendAdminMessage(req, res) {
  const b = req.body ?? {};

  const ids = Array.isArray(b.user_ids)
    ? [...new Set(b.user_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : [];
  if (!ids.length) {
    return res.status(400).json({ status: 'error', message: 'ต้องเลือกผู้รับอย่างน้อย 1 คน' });
  }
  if (ids.length > MAX_MESSAGE_RECIPIENTS) {
    return res.status(400).json({
      status: 'error',
      message: `ผู้รับต้องไม่เกิน ${MAX_MESSAGE_RECIPIENTS} คนต่อข้อความ`,
    });
  }

  const title = (typeof b.title === 'string' ? b.title.trim() : '').slice(0, 200);
  const body = (typeof b.body === 'string' ? b.body.trim() : '').slice(0, 2000);
  if (!title) return res.status(400).json({ status: 'error', message: 'ต้องระบุหัวข้อ' });
  if (!body) return res.status(400).json({ status: 'error', message: 'ต้องระบุข้อความ' });
  const linkUrl =
    typeof b.link_url === 'string' && b.link_url.trim()
      ? b.link_url.trim().slice(0, 500)
      : null;
  const sendEmail = b.send_email === true;

  // in-app — ส่งถึงเสมอ (ไม่เช็ค preference)
  const inApp = await model.insertMany(
    ids.map((uid) => ({
      userId: uid,
      eventType: 'admin.message',
      category: 'admin_message',
      title,
      body,
      linkUrl,
      dedupeKey: null,
    })),
  );

  // email — เฉพาะเมื่อ admin เลือก + kill-switch ระบบเปิด (ไม่เช็ค pref รายคน)
  let emailQueued = 0;
  let emailSkipped = null;
  if (sendEmail) {
    if (await prefModel.getChannelGlobalEnabled('email')) {
      const emailMap = await model.getEmailsByIds(ids);
      const { subject, html, text } = renderEmail({ title, body, link_url: linkUrl });
      emailQueued = await enqueueMany(
        ids
          .map((uid) => ({
            eventType: 'admin.message',
            toUserId: uid,
            toEmail: emailMap.get(uid),
            subject,
            bodyHtml: html,
            bodyText: text,
            dedupeKey: null,
          }))
          .filter((r) => r.toEmail),
      );
    } else {
      emailSkipped = 'ระบบปิดการส่งอีเมลอยู่ (super_admin kill-switch)';
    }
  }

  // audit — 1 แถว/ผู้รับ (ใครส่ง/ถึงใคร/อะไร)
  await logMessagesSent(
    req.user.id,
    ids,
    { title, channels: sendEmail ? ['in_app', 'email'] : ['in_app'] },
    auditMetaFromReq(req),
  );

  res.json({
    status: 'ok',
    recipients: ids.length,
    in_app: inApp,
    email_queued: emailQueued,
    email_skipped: emailSkipped,
  });
}

// ── D3: ส่งเมลทดสอบ (admin) — ตรวจการเชื่อมต่อ SMTP + ส่งจริง 1 ฉบับ ─
// POST /api/admin/email/test  body: { to?: string }  (ไม่ระบุ → อีเมลของ admin ที่เรียก)
export async function sendTestEmail(req, res) {
  let to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
  if (!to) {
    const map = await model.getEmailsByIds([req.user.id]);
    to = map.get(req.user.id) ?? '';
  }
  if (!to) {
    return res.status(400).json({ status: 'error', message: 'ไม่พบอีเมลผู้รับ' });
  }
  try {
    await verifyTransport(); // login SMTP ผ่านไหม
    const info = await sendMail({
      to,
      subject: '[MSU Activity] ทดสอบระบบส่งอีเมล',
      text: 'อีเมลทดสอบจากระบบกิจกรรมนิสิต มมส. — ถ้าได้รับแสดงว่า SMTP ใช้งานได้',
      html: '<p>อีเมลทดสอบจาก <b>ระบบกิจกรรมนิสิต มมส.</b></p><p>ถ้าคุณได้รับ แสดงว่าการตั้งค่า SMTP ใช้งานได้ ✅</p>',
    });
    // ถ้า dev เปิด redirect อยู่ แจ้งให้ frontend รู้ว่าเมลไปที่อื่น (กันงง)
    const redirected = process.env.EMAIL_REDIRECT_ALL?.trim() || null;
    res.json({ status: 'ok', to, redirected_to: redirected, message_id: info.messageId });
  } catch (err) {
    res.status(502).json({ status: 'error', message: `ส่งไม่สำเร็จ: ${err.message}` });
  }
}
