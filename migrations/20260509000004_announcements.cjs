/* eslint-disable camelcase */

// Website Announcement System
//   - admin / super_admin โพสต์ประกาศที่แสดงให้ผู้ใช้เห็นทั้งหน้า public + dashboards
//   - 2 รูปแบบ: BANNER (แถบบนสุด, แสดงพร้อมกันได้หลายอัน), POPUP (modal กลางจอ, แสดงทีละอัน)
//   - 3 ระดับความสำคัญ: INFO / WARNING / DANGER (ใช้สีและไอคอนต่าง)
//   - Schedule: starts_at / ends_at (optional) + is_active toggle
//                การแสดง: is_active=true AND (starts_at IS NULL OR starts_at <= now())
//                                          AND (ends_at   IS NULL OR ends_at   >  now())
//   - Dismissal: per-page-view เท่านั้น (frontend state) — ไม่บันทึก DB

exports.up = (pgm) => {
  pgm.createType('announcement_kind', ['BANNER', 'POPUP']);
  pgm.createType('announcement_severity', ['INFO', 'WARNING', 'DANGER']);

  pgm.createTable('announcements', {
    id: 'id',
    kind: { type: 'announcement_kind', notNull: true },
    severity: { type: 'announcement_severity', notNull: true, default: 'INFO' },
    title: { type: 'text' },
    body: { type: 'text', notNull: true },
    link_url: { type: 'text' },
    link_label: { type: 'text' },
    starts_at: { type: 'timestamptz' },
    ends_at: { type: 'timestamptz' },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_by: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    updated_by: {
      type: 'integer',
      references: 'users',
      onDelete: 'SET NULL',
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // partial index — public query กรองด้วย is_active=true ก่อน window check เสมอ
  pgm.createIndex('announcements', ['is_active', 'starts_at', 'ends_at'], {
    name: 'announcements_active_window_idx',
    where: 'is_active = TRUE',
  });
  // admin list ใช้ created_at DESC
  pgm.createIndex('announcements', [{ name: 'created_at', sort: 'DESC' }], {
    name: 'announcements_created_at_desc_idx',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('announcements');
  pgm.dropType('announcement_severity');
  pgm.dropType('announcement_kind');
};
