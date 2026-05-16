/* eslint-disable camelcase */

// ── registration_audit_logs ──────────────────────────────────────
//
// Per-registration mutation log — บันทึกทุก state transition ของ registration
// (เกิดจาก student เอง / faculty / admin)
//
// แยกจาก activity_audit_logs (per-activity) เพื่อให้ query "ประวัติของ registration X"
// ทำได้ตรง ๆ โดยไม่ต้อง filter JSONB
//
// Bulk ops จะ insert หลาย row (1 ต่อ registration) + เก็บ summary row ใน
// activity_audit_logs ตามเดิม
//
// schema เหมือน activity_audit_logs (actor + before/after JSONB + ip + ua + ts)
// FK ไป registrations(id) ON DELETE CASCADE — ลบ registration → audit log ตาม
//   (rare เพราะปกติไม่ลบ registration จริง แค่เปลี่ยน status)

exports.up = (pgm) => {
  pgm.createTable('registration_audit_logs', {
    id: 'id',
    actor_id: {
      type: 'integer',
      notNull: true,
      references: 'users(id)',
      onDelete: 'RESTRICT',
    },
    registration_id: {
      type: 'integer',
      notNull: true,
      references: 'registrations(id)',
      onDelete: 'CASCADE',
    },
    action: { type: 'text', notNull: true },
    before: { type: 'jsonb' },
    after: { type: 'jsonb' },
    note: { type: 'text' },
    ip: { type: 'text' },
    user_agent: { type: 'text' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // หลัก: query timeline ของ registration เฉพาะตัว
  pgm.createIndex(
    'registration_audit_logs',
    ['registration_id', 'created_at'],
    {
      name: 'idx_reg_audit_registration',
    },
  );

  // รอง: ดูการกระทำของ actor (เช่น "admin คนนี้แก้อะไรไปบ้าง")
  pgm.createIndex('registration_audit_logs', ['actor_id', 'created_at'], {
    name: 'idx_reg_audit_actor',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('registration_audit_logs');
};
