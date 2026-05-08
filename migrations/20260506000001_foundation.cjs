/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.createType('user_role', [
    'student',
    'faculty_staff',
    'executive',
    'admin',
    'super_admin',
  ]);

  pgm.createTable('faculties', {
    id: 'id',
    code: { type: 'text', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('organizations', {
    id: 'id',
    code: { type: 'char(4)', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    parent_id: {
      type: 'integer',
      references: '"organizations"',
      onDelete: 'RESTRICT',
    },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('organizations', 'parent_id');

  pgm.createTable('users', {
    id: 'id',
    msu_id: { type: 'text', unique: true },
    email: { type: 'text', notNull: true, unique: true },
    full_name: { type: 'text', notNull: true },
    role: { type: 'user_role', notNull: true, default: 'student' },
    faculty_id: {
      type: 'integer',
      references: 'faculties',
      onDelete: 'RESTRICT',
    },
    status: { type: 'text', notNull: true, default: 'active' },
    last_login_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // เก็บ email เป็น lowercase เสมอ (canonical) — กัน duplicate ที่ต่างแค่เคส
  pgm.addConstraint('users', 'users_email_lowercase_check', {
    check: 'email = lower(email)',
  });

  pgm.createIndex('users', 'role');
  pgm.createIndex('users', 'faculty_id');
};

exports.down = (pgm) => {
  pgm.dropTable('users');
  pgm.dropTable('organizations');
  pgm.dropTable('faculties');
  pgm.dropType('user_role');
};
