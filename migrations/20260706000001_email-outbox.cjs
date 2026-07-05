/* eslint-disable camelcase */

// ── email_outbox — คิวเมลของระบบแจ้งเตือน (เฟส 4) ─────────────────
//   ดูดีไซน์: docs/notifications-design.md §3 / docs/email-notifications-design.md §3.1
//   email channel enqueue ที่นี่ (หลังผ่าน preference) → email-worker poll ส่งด้วย mailer.js
//   - retry/backoff: attempts++ + next_attempt_at เลื่อน จนครบ max_attempts → FAILED
//   - dedupe_key unique กันส่งซ้ำ (แยก namespace จาก notifications.dedupe_key)
//   - เก็บ snapshot subject/html → resend/debug ได้โดยไม่ต้อง render ใหม่

exports.up = (pgm) => {
  pgm.createType('email_status', ['PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED']);

  pgm.createTable('email_outbox', {
    id: 'id',
    event_type: { type: 'text', notNull: true },
    to_user_id: { type: 'integer', references: 'users(id)', onDelete: 'SET NULL' },
    to_email: { type: 'text', notNull: true }, // snapshot ตอน enqueue
    subject: { type: 'text', notNull: true },
    body_html: { type: 'text', notNull: true },
    body_text: { type: 'text' },
    status: { type: 'email_status', notNull: true, default: 'PENDING' },
    attempts: { type: 'smallint', notNull: true, default: 0 },
    max_attempts: { type: 'smallint', notNull: true, default: 5 },
    next_attempt_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_error: { type: 'text' },
    dedupe_key: { type: 'text', unique: true },
    related_activity_id: { type: 'integer', references: 'activities(id)', onDelete: 'SET NULL' },
    related_registration_id: { type: 'integer', references: 'registrations(id)', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    sent_at: { type: 'timestamptz' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // worker ดึงงานที่ถึงเวลาส่ง (PENDING + next_attempt_at <= now)
  pgm.createIndex('email_outbox', ['status', 'next_attempt_at'], {
    name: 'idx_email_outbox_due',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('email_outbox');
  pgm.dropType('email_status');
};
