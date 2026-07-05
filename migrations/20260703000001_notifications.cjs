/* eslint-disable camelcase */

// ── ระบบแจ้งเตือน (Notifications) — เฟส 0 (in-app) ─────────────────
//
// ดูดีไซน์เต็ม: docs/notifications-design.md
//   - แกนเดียว หลายช่องทาง; เฟส 0–3 ทำ in-app ก่อน, email (email_outbox) เลื่อนเป็นเฟส 4
//
// 2 ตาราง:
//   1. notifications            — กล่องแจ้งเตือน in-app ต่อผู้ใช้ (อ่าน/ยังไม่อ่าน)
//   2. notification_preferences — เมทริกซ์ หมวด × ช่องทาง (jsonb) + master ต่อช่องทาง
//                                 ไม่มีแถว = ใช้ default ในโค้ด (ไม่ต้อง backfill ผู้ใช้เดิม)
//
// + seed system_settings kill-switch ต่อช่องทาง (email seed ไว้ล่วงหน้าแม้ยังไม่เปิดใช้)

exports.up = (pgm) => {
  // 1. notifications — in-app inbox
  pgm.createTable('notifications', {
    id: 'id',
    user_id: {
      type: 'integer',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
    event_type: { type: 'text', notNull: true }, // เช่น 'registration.approved'
    category: { type: 'text', notNull: true }, // เช่น 'registration' (จับคู่ preference)
    title: { type: 'text', notNull: true },
    body: { type: 'text' },
    link_url: { type: 'text' }, // คลิกแล้วไปหน้าเกี่ยวข้อง เช่น /activities/123
    related_activity_id: {
      type: 'integer',
      references: 'activities(id)',
      onDelete: 'SET NULL',
    },
    related_registration_id: {
      type: 'integer',
      references: 'registrations(id)',
      onDelete: 'SET NULL',
    },
    is_read: { type: 'boolean', notNull: true, default: false },
    read_at: { type: 'timestamptz' },
    dedupe_key: { type: 'text', unique: true }, // กันเด้งซ้ำ (nullable = ไม่กัน)
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // feed + นับ unread เร็ว (ล่าสุดก่อน)
  pgm.createIndex('notifications', [{ name: 'user_id' }, { name: 'created_at', sort: 'DESC' }], {
    name: 'idx_notifications_user_created',
  });
  // partial index สำหรับนับ/ดึงเฉพาะที่ยังไม่อ่าน (เบากว่านับทั้งตาราง)
  pgm.createIndex('notifications', 'user_id', {
    name: 'idx_notifications_unread',
    where: 'is_read = false',
  });

  // 2. notification_preferences — เมทริกซ์ หมวด × ช่องทาง
  pgm.createTable('notification_preferences', {
    user_id: {
      type: 'integer',
      primaryKey: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
    // master ต่อช่องทาง เช่น {"in_app": true, "email": false}
    channels: { type: 'jsonb', notNull: true, default: '{}' },
    // override ราย (หมวด, ช่องทาง) เช่น {"registration": {"email": false}}
    prefs: { type: 'jsonb', notNull: true, default: '{}' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // 3. seed kill-switch ต่อช่องทาง (super_admin ปิดทั้งระบบได้)
  pgm.sql(`
    INSERT INTO system_settings (key, value) VALUES
      ('notify.in_app.enabled', 'true'),
      ('notify.email.enabled',  'false')
    ON CONFLICT (key) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM system_settings WHERE key IN ('notify.in_app.enabled', 'notify.email.enabled');`);
  pgm.dropTable('notification_preferences');
  pgm.dropTable('notifications');
};
