/* eslint-disable camelcase */

// ── announcement_reads — read-state ของประกาศ (broadcast pattern) ──
//   ประกาศเก็บ "1 แถว/ประกาศ" ใน announcements (ไม่ fan-out ต่อผู้ใช้ 39k)
//   ตารางนี้เก็บเฉพาะ "ใครอ่านประกาศไหนแล้ว" — ไม่มีแถว = ยังไม่อ่าน
//   → กระดิ่งผสมประกาศ active กับ notification ส่วนตัว, unread = visible ที่ยังไม่มีใน reads

exports.up = (pgm) => {
  pgm.createTable('announcement_reads', {
    user_id: {
      type: 'integer',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
    announcement_id: {
      type: 'integer',
      notNull: true,
      references: 'announcements(id)',
      onDelete: 'CASCADE',
    },
    read_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // PK (user_id, announcement_id) — lookup "user อ่านอะไรแล้ว" ใช้ prefix นี้
  pgm.addConstraint('announcement_reads', 'announcement_reads_pkey', {
    primaryKey: ['user_id', 'announcement_id'],
  });
  // index สำหรับ cascade delete ตอนลบประกาศ
  pgm.createIndex('announcement_reads', 'announcement_id', {
    name: 'idx_announcement_reads_announcement',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('announcement_reads');
};
