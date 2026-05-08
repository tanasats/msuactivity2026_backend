/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.createType('cert_req_scope', ['total', 'category']);
  pgm.createType('cert_status', ['REQUESTED', 'APPROVED', 'REJECTED', 'ISSUED']);

  // เกณฑ์ออกหนังสือรับรอง — versioned โดย effective_from/to
  // scope='total' (ค่ารวม) ใช้ตอนนี้; scope='category' รองรับ quota รายหมวดถ้าใช้ภายหลัง
  pgm.createTable('cert_requirements', {
    id: 'id',
    scope: { type: 'cert_req_scope', notNull: true },
    category_id: {
      type: 'integer',
      references: 'activity_categories',
      onDelete: 'RESTRICT',
    },
    hours_required: { type: 'smallint', notNull: true },
    effective_from: { type: 'date', notNull: true },
    effective_to: { type: 'date' },
    created_by: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('cert_requirements', 'cert_requirements_hours_check', {
    check: 'hours_required > 0',
  });
  pgm.addConstraint('cert_requirements', 'cert_requirements_scope_check', {
    check:
      "(scope = 'total' AND category_id IS NULL) OR (scope = 'category' AND category_id IS NOT NULL)",
  });
  pgm.addConstraint('cert_requirements', 'cert_requirements_period_check', {
    check: 'effective_to IS NULL OR effective_from < effective_to',
  });

  pgm.createIndex('cert_requirements', ['scope', 'category_id', 'effective_from']);

  // คำขอ + สถานะการออกหนังสือรับรอง
  // flow: REQUESTED → admin approve → APPROVED → ระบบออก PDF → ISSUED
  //                → admin reject → REJECTED (rejected_reason)
  pgm.createTable('certificates', {
    id: 'id',
    user_id: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    status: { type: 'cert_status', notNull: true, default: 'REQUESTED' },
    total_hours_at_request: { type: 'smallint', notNull: true },
    rule_snapshot: { type: 'jsonb', notNull: true },
    requested_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    reviewed_by: { type: 'integer', references: 'users' },
    reviewed_at: { type: 'timestamptz' },
    rejected_reason: { type: 'text' },
    issued_at: { type: 'timestamptz' },
    document_no: { type: 'text', unique: true },
    pdf_storage_key: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('certificates', ['user_id', 'status']);
};

exports.down = (pgm) => {
  pgm.dropTable('certificates');
  pgm.dropTable('cert_requirements');
  pgm.dropType('cert_status');
  pgm.dropType('cert_req_scope');
};
