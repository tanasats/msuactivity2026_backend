import { insertMany } from '../../models/notification.model.js';

// in-app channel — "ส่ง" = insert แถวลง notifications (อ่านผ่าน API กระดิ่ง)
//   recipients = ผู้รับที่ผ่าน preference แล้ว
//   dedupe ต่อผู้รับ: base dedupe_key + ":{userId}" → unique ต่อคน กันเด้งซ้ำ
export const inAppChannel = {
  name: 'in_app',
  async deliver(recipients, { eventType, category, rendered }) {
    const rows = recipients.map((r) => ({
      userId: r.id,
      eventType,
      category,
      title: rendered.title,
      body: rendered.body,
      linkUrl: rendered.link_url,
      relatedActivityId: rendered.related_activity_id,
      relatedRegistrationId: rendered.related_registration_id,
      dedupeKey: rendered.dedupe_key ? `${rendered.dedupe_key}:${r.id}` : null,
    }));
    return insertMany(rows);
  },
};
