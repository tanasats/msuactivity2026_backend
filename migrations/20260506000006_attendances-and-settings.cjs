/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.createType('attendance_status', ['VALID', 'INVALID', 'PENDING_REVIEW']);

  pgm.createTable('attendances', {
    id: 'id',
    registration_id: {
      type: 'integer',
      notNull: true,
      references: 'registrations',
      onDelete: 'RESTRICT',
    },
    method: { type: 'check_in_method', notNull: true },
    status: { type: 'attendance_status', notNull: true, default: 'VALID' },
    checked_in_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    // null = self check-in; มีค่า = staff ทำให้ (MANUAL_STAFF / QR_STAFF)
    checked_in_by: { type: 'integer', references: 'users' },

    // เฉพาะวิธีที่ใช้ GPS (SELFIE_GEO)
    lat: { type: 'decimal(10,7)' },
    lng: { type: 'decimal(10,7)' },
    distance_meters: { type: 'integer' },
    exif_taken_at: { type: 'timestamptz' },

    // เฉพาะ SELFIE_GEO
    selfie_storage_key: { type: 'text' },
    selfie_size_bytes: { type: 'integer' },

    // diagnostic / audit
    invalid_reason: { type: 'text' },
    raw_payload: { type: 'jsonb' },

    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // 1 valid attendance ต่อ registration (INVALID เก็บได้หลายแถวเป็น audit)
  pgm.createIndex('attendances', 'registration_id', {
    unique: true,
    where: "status IN ('VALID', 'PENDING_REVIEW')",
    name: 'uniq_attendances_per_reg',
  });
  pgm.createIndex('attendances', ['registration_id', 'created_at']);

  // system_settings — key-value config โดย super_admin (radius, time window, ฯลฯ)
  pgm.createTable('system_settings', {
    key: { type: 'text', primaryKey: true },
    value: { type: 'jsonb', notNull: true },
    updated_by: { type: 'integer', references: 'users' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`
    INSERT INTO system_settings (key, value) VALUES
      ('check_in.default_radius_meters', '300'),
      ('check_in.default_window_before_minutes', '30'),
      ('check_in.default_window_after_minutes', '15'),
      ('check_in.selfie_max_exif_skew_minutes', '5');
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('system_settings');
  pgm.dropTable('attendances');
  pgm.dropType('attendance_status');
};
