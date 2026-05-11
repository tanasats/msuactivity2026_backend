/* eslint-disable camelcase */

// บันทึกประวัติการเปลี่ยนแปลงสำคัญของกิจกรรม — ใครทำอะไร เมื่อไหร่
//   action enum: 'submit' | 'approve' | 'reject' | 'set_status' | 'set_creator'
//                'complete' | 'cancel_registration' | 'edit_admin' | 'bulk_approve' | 'bulk_reject'
//   before / after: jsonb snapshot ของฟิลด์ที่เปลี่ยน
//
// pattern เดียวกับ user_audit_logs:
//   actor      ON DELETE RESTRICT (ห้ามลบ user ที่เคยทำ action ค้างไว้)
//   activity   ON DELETE CASCADE  (ลบกิจกรรม = log ลบตาม)

exports.up = (pgm) => {
  pgm.createTable('activity_audit_logs', {
    id: 'id',
    actor_id: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    activity_id: {
      type: 'integer',
      notNull: true,
      references: 'activities',
      onDelete: 'CASCADE',
    },
    action: { type: 'text', notNull: true },
    before: { type: 'jsonb' },
    after: { type: 'jsonb' },
    note: { type: 'text' },     // เก็บข้อความเช่น rejection reason / cancel reason
    ip: { type: 'text' },
    user_agent: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('activity_audit_logs', ['activity_id', 'created_at']);
  pgm.createIndex('activity_audit_logs', 'actor_id');
};

exports.down = (pgm) => {
  pgm.dropTable('activity_audit_logs');
};
