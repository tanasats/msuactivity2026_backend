/* eslint-disable camelcase */

// บันทึกประวัติการเปลี่ยนแปลง users โดย super_admin — ใช้ตอน audit/ย้อนดู
//   - actor_id  = super_admin ที่กดทำ
//   - target    = user ที่ถูกเปลี่ยน
//   - action    = 'role_change' | 'faculty_change' | 'status_change'
//   - before/after = jsonb snapshot (เก็บค่าก่อน-หลังเฉพาะฟิลด์ที่เปลี่ยน)
//   - actor มี ON DELETE RESTRICT — ห้ามลบ super_admin ที่เคยทำ action ค้างไว้
//     (สอดคล้องกฎ "ไม่ลบ user จริง" ของระบบ — ใช้ status='disabled' แทน)

exports.up = (pgm) => {
  pgm.createTable('user_audit_logs', {
    id: 'id',
    actor_id: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    target_user_id: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    action: { type: 'text', notNull: true },
    before: { type: 'jsonb' },
    after: { type: 'jsonb' },
    ip: { type: 'text' },
    user_agent: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('user_audit_logs', ['target_user_id', 'created_at']);
  pgm.createIndex('user_audit_logs', 'actor_id');
};

exports.down = (pgm) => {
  pgm.dropTable('user_audit_logs');
};
