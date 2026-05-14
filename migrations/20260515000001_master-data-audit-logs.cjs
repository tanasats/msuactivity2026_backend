/* eslint-disable camelcase */

// ── master_data_audit_logs ───────────────────────────────────────
//   เก็บ history ของการเปลี่ยน master data + config (cross-faculty / cross-cutting)
//   ใช้ polymorphic pattern เดียวกับ activity_audit_logs/user_audit_logs:
//     - target_type = 'organization' | 'category' | 'skill' | 'faculty' | 'system_setting' | 'announcement'
//     - target_id   = id ของแถว (NULL ได้สำหรับ system_setting ที่ใช้ key เป็น primary)
//     - target_key  = key เสริม (system_setting.key, skill code) — denormalized, อ่านง่าย
//     - action      = 'create' | 'update' | 'soft_delete' | 'restore' | 'delete' (hard)
//     - before/after = jsonb (เก็บเฉพาะ field ที่เปลี่ยน — diff)
//
//   ไม่มี FK ไปยัง target row เพราะตารางเป้าหมายต่างกันไป
//   - ถ้า target row ถูกลบ (เช่น announcement DELETE) audit จะคงอยู่
//   - actor_id FK ไปยัง users(id) ON DELETE RESTRICT — กันลบ admin ที่มีกิจกรรม audit

exports.up = (pgm) => {
  pgm.createTable('master_data_audit_logs', {
    id: 'id',
    actor_id: {
      type: 'integer',
      notNull: true,
      references: 'users(id)',
      onDelete: 'RESTRICT',
    },
    target_type: { type: 'text', notNull: true },
    target_id: { type: 'integer' }, // nullable — system_setting ใช้ key แทน
    target_key: { type: 'text' },   // denormalized identifier (system_setting.key หรือ skill.code)
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

  // query หลัก: ดู history ของ target — order by created_at DESC
  pgm.createIndex('master_data_audit_logs', ['target_type', 'target_id', 'created_at'], {
    name: 'idx_master_audit_target',
  });

  // query รอง: ดูการเปลี่ยนแปลงที่ admin คนนั้นทำทั้งหมด
  pgm.createIndex('master_data_audit_logs', ['actor_id', 'created_at'], {
    name: 'idx_master_audit_actor',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('master_data_audit_logs');
};
