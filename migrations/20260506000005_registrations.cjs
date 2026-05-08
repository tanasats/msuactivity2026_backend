/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.createType('registration_status', [
    'PENDING_APPROVAL',
    'REGISTERED',
    'WAITLISTED',
    'CANCELLED_BY_USER',
    'CANCELLED_BY_STAFF',
    'REJECTED_BY_STAFF',
    'ATTENDED',
    'NO_SHOW',
  ]);

  pgm.createTable('registrations', {
    id: 'id',
    user_id: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    activity_id: {
      type: 'integer',
      notNull: true,
      references: 'activities',
      onDelete: 'RESTRICT',
    },
    status: { type: 'registration_status', notNull: true },
    // qr_token สร้างตอน status → REGISTERED (NULL ก่อนหน้านั้น)
    qr_token: { type: 'uuid', unique: true },

    registered_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    waitlisted_at: { type: 'timestamptz' },
    promoted_at: { type: 'timestamptz' },

    // approval flow (MANUAL mode)
    approved_at: { type: 'timestamptz' },
    approved_by: { type: 'integer', references: 'users' },
    rejected_at: { type: 'timestamptz' },
    rejected_by: { type: 'integer', references: 'users' },
    rejected_reason: { type: 'text' },

    // cancellation
    cancelled_at: { type: 'timestamptz' },
    cancelled_by: { type: 'integer', references: 'users' },
    cancel_reason: { type: 'text' },

    // attendance result (set ตอน check-in สำเร็จ)
    attended_at: { type: 'timestamptz' },

    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // กันสมัครซ้ำใน slot active (รวม PENDING) — แต่หลัง cancel/reject สมัครใหม่ได้
  pgm.createIndex('registrations', ['user_id', 'activity_id'], {
    unique: true,
    where: "status IN ('REGISTERED', 'WAITLISTED', 'PENDING_APPROVAL')",
    name: 'uniq_registrations_active',
  });

  // หา waitlist หัวคิวเร็ว (FIFO promote)
  pgm.createIndex('registrations', ['activity_id', 'status', 'waitlisted_at'], {
    name: 'idx_registrations_waitlist',
  });

  // pending review queue ของ faculty (MANUAL mode)
  pgm.createIndex('registrations', ['activity_id', 'status', 'registered_at'], {
    name: 'idx_registrations_pending_queue',
  });

  // รายการของนิสิต
  pgm.createIndex('registrations', ['user_id', 'status']);
};

exports.down = (pgm) => {
  pgm.dropTable('registrations');
  pgm.dropType('registration_status');
};
