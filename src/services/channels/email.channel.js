import { renderEmail } from '../../emails/layout.js';
import { enqueueMany } from '../../models/email-outbox.model.js';

// email channel — "ส่ง" = enqueue ลง email_outbox (worker ส่งจริงทีหลังด้วย mailer.js)
//   recipients = ผู้รับที่ผ่าน preference แล้ว + ต้องมี .email (service enrich มาให้)
//   dedupe ต่อผู้รับ: base + ":{userId}:email" (แยก namespace จาก in-app)
export const emailChannel = {
  name: 'email',
  async deliver(recipients, { eventType, rendered }) {
    const { subject, html, text } = renderEmail(rendered);
    const rows = recipients
      .filter((r) => r.email)
      .map((r) => ({
        eventType,
        toUserId: r.id,
        toEmail: r.email,
        subject,
        bodyHtml: html,
        bodyText: text,
        relatedActivityId: rendered.related_activity_id,
        relatedRegistrationId: rendered.related_registration_id,
        dedupeKey: rendered.dedupe_key ? `${rendered.dedupe_key}:${r.id}:email` : null,
      }));
    return enqueueMany(rows);
  },
};
