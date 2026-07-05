// แกนกลางระบบแจ้งเตือน — business logic เรียก emit() ตัวเดียว (ดู docs/notifications-design.md)
//   1) resolve ผู้รับจาก catalog  2) เช็ค preference (หมวด × ช่องทาง)  3) fan-out ไป channel
//
// เฟส 0–3: มีแค่ in-app channel; email (เฟส 4) เพิ่ม adapter ใน CHANNEL_ADAPTERS ได้เลย

import { EVENTS, CHANNELS, categoryDefault } from '../notifications/catalog.js';
import * as prefModel from '../models/notification-preference.model.js';
import { getEmailsByIds } from '../models/notification.model.js';
import { inAppChannel } from './channels/in-app.channel.js';
import { emailChannel } from './channels/email.channel.js';

const CHANNEL_ADAPTERS = {
  in_app: inAppChannel,
  email: emailChannel,
};

// email channel ต้องมี .email ต่อผู้รับ — resolver บางตัวส่งมาแค่ { id } → เติมให้
async function withEmails(recipients) {
  const missing = recipients.filter((r) => !r.email).map((r) => r.id);
  if (!missing.length) return recipients;
  const map = await getEmailsByIds(missing);
  return recipients
    .map((r) => (r.email ? r : { ...r, email: map.get(r.id) }))
    .filter((r) => r.email);
}

// user รับ (category, channel) นี้ไหม
//   master ช่องทางปิด → ไม่รับ; ไม่งั้นใช้ override รายหมวด หรือ default ในโค้ด
function isEnabled(pref, category, channel) {
  if (pref?.channels?.[channel] === false) return false;
  const override = pref?.prefs?.[category]?.[channel];
  if (override === undefined) return categoryDefault(category, channel);
  return override !== false;
}

// ประกาศ event — best-effort, ห้าม throw ออกไปทำให้ flow หลัก fail
//   ควรเรียก "หลัง commit" ของ transaction หลัก
export async function emit(eventType, ctx = {}) {
  try {
    const entry = EVENTS[eventType];
    if (!entry) {
      console.warn(`[notify] unknown event type: ${eventType}`);
      return;
    }

    const recipients = (await entry.resolveRecipients(ctx)).filter((r) => r?.id);
    if (!recipients.length) return;

    const rendered = entry.render(ctx);
    const { category } = entry;
    const prefMap = await prefModel.getMany(recipients.map((r) => r.id));

    for (const channel of CHANNELS) {
      const adapter = CHANNEL_ADAPTERS[channel];
      if (!adapter) continue; // ช่องทางยังไม่เปิดใช้ (เช่น email ในเฟสนี้)

      if (!(await prefModel.getChannelGlobalEnabled(channel))) continue; // kill-switch

      let allowed = recipients.filter((r) =>
        isEnabled(prefMap.get(r.id), category, channel),
      );
      if (!allowed.length) continue;
      if (channel === 'email') allowed = await withEmails(allowed); // เติม email
      if (!allowed.length) continue;

      await adapter.deliver(allowed, { eventType, category, rendered });
    }
  } catch (err) {
    console.error(`[notify] emit(${eventType}) failed:`, err?.message ?? err);
  }
}
