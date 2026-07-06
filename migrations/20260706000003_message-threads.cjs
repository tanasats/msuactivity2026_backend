/* eslint-disable camelcase */

// ── ข้อความสองทาง faculty ↔ admin (threaded inbox) ────────────────
//   ดูดีไซน์: docs/messaging-design.md
//   - message_threads : หัวข้อบทสนทนา (OPEN/RESOLVED)
//   - thread_messages : ข้อความในบทสนทนา
//   - thread_reads    : read-state ต่อผู้ใช้ (unread badge; แบบ announcement_reads)
//   ใช้ระบบ notification เป็น alert (มีข้อความใหม่ → เด้งกระดิ่งหาอีกฝ่าย)

exports.up = (pgm) => {
  pgm.createTable('message_threads', {
    id: 'id',
    subject: { type: 'text', notNull: true },
    created_by: { type: 'integer', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    faculty_id: { type: 'integer', references: 'faculties(id)', onDelete: 'SET NULL' },
    status: { type: 'text', notNull: true, default: 'OPEN' }, // OPEN | RESOLVED
    last_message_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    resolved_by: { type: 'integer', references: 'users(id)', onDelete: 'SET NULL' },
    resolved_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // inbox admin: เรียง OPEN ก่อน + ล่าสุด
  pgm.createIndex('message_threads', ['status', { name: 'last_message_at', sort: 'DESC' }], {
    name: 'idx_threads_status_recent',
  });
  // faculty list ของตัวเอง
  pgm.createIndex('message_threads', 'created_by', { name: 'idx_threads_creator' });

  pgm.createTable('thread_messages', {
    id: 'id',
    thread_id: { type: 'integer', notNull: true, references: 'message_threads(id)', onDelete: 'CASCADE' },
    sender_id: { type: 'integer', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    body: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('thread_messages', ['thread_id', 'created_at'], { name: 'idx_thread_messages' });

  pgm.createTable('thread_reads', {
    thread_id: { type: 'integer', notNull: true, references: 'message_threads(id)', onDelete: 'CASCADE' },
    user_id: { type: 'integer', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    last_read_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('thread_reads', 'thread_reads_pkey', {
    primaryKey: ['thread_id', 'user_id'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('thread_reads');
  pgm.dropTable('thread_messages');
  pgm.dropTable('message_threads');
};
