/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.createType('activity_status', [
    'DRAFT',
    'PENDING_APPROVAL',
    'REJECTED',
    'APPROVED',
    'PUBLISHED',
    'CANCELLED',
    'COMPLETED',
  ]);

  pgm.createType('approval_mode', ['AUTO', 'MANUAL']);

  pgm.createType('check_in_method', [
    'QR_TERMINAL',
    'QR_STAFF',
    'SELFIE_GEO',
    'MANUAL_STAFF',
    'PIN_CODE',
  ]);

  pgm.createTable('activities', {
    id: 'id',
    // ตัวระบุ — code เป็น 10 ตัว, NULL จนกว่า admin approve (ดู project_activity_code memory)
    code: { type: 'char(10)', unique: true },
    title: { type: 'text', notNull: true },
    description: { type: 'text', notNull: true, default: '' },
    location: { type: 'text', notNull: true, default: '' },

    // ความเป็นเจ้าของ
    organization_id: {
      type: 'integer',
      notNull: true,
      references: 'organizations',
      onDelete: 'RESTRICT',
    },
    category_id: {
      type: 'integer',
      notNull: true,
      references: 'activity_categories',
      onDelete: 'RESTRICT',
    },
    created_by: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },

    // ปีการศึกษา (ส่วนของ activity code)
    academic_year: { type: 'smallint', notNull: true },
    semester: { type: 'smallint', notNull: true },

    // ชั่วโมง + ที่นั่ง (registered_count = atomic counter)
    hours: { type: 'smallint', notNull: true },
    capacity: { type: 'integer', notNull: true },
    registered_count: { type: 'integer', notNull: true, default: 0 },

    // ช่วงเวลากิจกรรม
    start_at: { type: 'timestamptz', notNull: true },
    end_at: { type: 'timestamptz', notNull: true },

    // ช่วงเปิดรับสมัคร + โหมดอนุมัติผู้สมัคร
    registration_open_at: { type: 'timestamptz', notNull: true },
    registration_close_at: { type: 'timestamptz', notNull: true },
    approval_mode: { type: 'approval_mode', notNull: true, default: 'AUTO' },

    // check-in config (NULL = ใช้ system default)
    venue_lat: { type: 'decimal(10,7)' },
    venue_lng: { type: 'decimal(10,7)' },
    check_in_radius_meters: { type: 'integer' },
    check_in_opens_at: { type: 'timestamptz' },
    check_in_closes_at: { type: 'timestamptz' },
    check_in_config: { type: 'jsonb', notNull: true, default: '{}' },

    // workflow
    status: { type: 'activity_status', notNull: true, default: 'DRAFT' },
    rejection_reason: { type: 'text' },
    approved_by: { type: 'integer', references: 'users' },
    approved_at: { type: 'timestamptz' },
    published_at: { type: 'timestamptz' },

    // ขยายต่อได้โดยไม่ migrate
    extra: { type: 'jsonb', notNull: true, default: '{}' },

    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('activities', 'activities_semester_check', {
    check: 'semester BETWEEN 1 AND 3',
  });
  pgm.addConstraint('activities', 'activities_capacity_check', {
    check: 'capacity > 0 AND registered_count >= 0 AND registered_count <= capacity',
  });
  pgm.addConstraint('activities', 'activities_time_check', {
    check: 'start_at < end_at',
  });
  pgm.addConstraint('activities', 'activities_window_check', {
    check: 'registration_open_at < registration_close_at',
  });
  pgm.addConstraint('activities', 'activities_hours_check', {
    check: 'hours > 0',
  });
  pgm.addConstraint('activities', 'activities_radius_check', {
    check: 'check_in_radius_meters IS NULL OR check_in_radius_meters > 0',
  });

  pgm.createIndex('activities', 'organization_id');
  pgm.createIndex('activities', 'category_id');
  pgm.createIndex('activities', 'status');
  pgm.createIndex('activities', 'created_by');
  pgm.createIndex('activities', ['academic_year', 'semester']);
  pgm.createIndex('activities', ['status', 'registration_open_at', 'registration_close_at'], {
    name: 'idx_activities_browse',
  });

  // m2m: ทักษะที่นิสิตจะได้รับ
  pgm.createTable('activity_skills', {
    activity_id: {
      type: 'integer',
      notNull: true,
      references: 'activities',
      onDelete: 'CASCADE',
    },
    skill_id: {
      type: 'integer',
      notNull: true,
      references: 'skills',
      onDelete: 'RESTRICT',
    },
  });
  pgm.addConstraint('activity_skills', 'activity_skills_pkey', {
    primaryKey: ['activity_id', 'skill_id'],
  });

  // m2m: คณะที่รับสมัคร — ว่าง = ทุกคณะ (ดู project_eligibility memory)
  pgm.createTable('activity_eligible_faculties', {
    activity_id: {
      type: 'integer',
      notNull: true,
      references: 'activities',
      onDelete: 'CASCADE',
    },
    faculty_id: {
      type: 'integer',
      notNull: true,
      references: 'faculties',
      onDelete: 'RESTRICT',
    },
  });
  pgm.addConstraint('activity_eligible_faculties', 'activity_eligible_faculties_pkey', {
    primaryKey: ['activity_id', 'faculty_id'],
  });

  // m2m: วิธี check-in ที่ผู้สร้างเปิดให้ใช้
  pgm.createTable('activity_check_in_methods', {
    activity_id: {
      type: 'integer',
      notNull: true,
      references: 'activities',
      onDelete: 'CASCADE',
    },
    method: { type: 'check_in_method', notNull: true },
  });
  pgm.addConstraint('activity_check_in_methods', 'activity_check_in_methods_pkey', {
    primaryKey: ['activity_id', 'method'],
  });

  // counter ออก running number ใน activity code (atomic upsert ตอน admin approve)
  // 100 = sentinel "เต็ม"; เกิน 99 → app ปฏิเสธ + ส่งให้ super_admin จัดการ
  pgm.createTable('activity_code_counters', {
    organization_id: {
      type: 'integer',
      notNull: true,
      references: 'organizations',
      onDelete: 'RESTRICT',
    },
    academic_year: { type: 'smallint', notNull: true },
    semester: { type: 'smallint', notNull: true },
    category_id: {
      type: 'integer',
      notNull: true,
      references: 'activity_categories',
      onDelete: 'RESTRICT',
    },
    next_running: { type: 'smallint', notNull: true, default: 0 },
  });
  pgm.addConstraint('activity_code_counters', 'activity_code_counters_pkey', {
    primaryKey: ['organization_id', 'academic_year', 'semester', 'category_id'],
  });
  pgm.addConstraint('activity_code_counters', 'activity_code_counters_running_check', {
    check: 'next_running BETWEEN 0 AND 100',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('activity_code_counters');
  pgm.dropTable('activity_check_in_methods');
  pgm.dropTable('activity_eligible_faculties');
  pgm.dropTable('activity_skills');
  pgm.dropTable('activities');
  pgm.dropType('check_in_method');
  pgm.dropType('approval_mode');
  pgm.dropType('activity_status');
};
