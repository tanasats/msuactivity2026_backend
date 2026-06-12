/* eslint-disable camelcase */

// Phase 1: ปรับโครง cert_requirements ให้ตรงกับเงื่อนไขใหม่
//
// เงื่อนไขการขอ certificate (transcript กิจกรรม):
//   1. activities ที่ code ขึ้นต้นด้วย A/B/C อย่างน้อย 4 กิจกรรม
//   2. activities ที่ code ขึ้นต้นด้วย D/E/F/G อย่างน้อย 4 กิจกรรม
//   3. ชั่วโมงรวมของทั้ง 2 กลุ่ม ≥ 100 ชม.
//
// Schema เดิม (scope='total'|'category') ไม่ตรงกับ requirement ใหม่ →
//   drop + recreate (table empty อยู่แล้ว ไม่มี data หาย)
//
// versioning ผ่าน effective_from/effective_to:
//   active = effective_to IS NULL (มีได้ row เดียว — บังคับด้วย partial unique)
//   เปลี่ยน rule = set old.effective_to = today + INSERT row ใหม่

exports.up = (pgm) => {
  // 1. drop เก่า (table + enum scope) — keep `certificates` table + `cert_status` enum
  pgm.sql(`DROP TABLE IF EXISTS cert_requirements CASCADE;`);
  pgm.sql(`DROP TYPE IF EXISTS cert_req_scope;`);

  // 2. สร้างตารางใหม่
  pgm.createTable('cert_requirements', {
    id: 'id',
    // กลุ่ม A: กิจกรรมคณะ/มหาวิทยาลัย — เก็บเป็น array ของ prefix (เช่น ['A','B','C'])
    group_a_prefixes: { type: 'text[]', notNull: true },
    // กลุ่ม B: กิจกรรมองค์กรนิสิต (เช่น ['D','E','F','G'])
    group_b_prefixes: { type: 'text[]', notNull: true },
    group_a_min_activities: { type: 'integer', notNull: true },
    group_b_min_activities: { type: 'integer', notNull: true },
    min_total_hours: { type: 'integer', notNull: true },
    // วันที่เริ่มใช้ rule นี้ — admin set ตอนสร้าง (default = วันที่ insert)
    effective_from: { type: 'date', notNull: true, default: pgm.func('current_date') },
    // null = ยังใช้อยู่; non-null = ถูกแทนที่แล้ว
    effective_to: { type: 'date', notNull: false },
    note: { type: 'text', notNull: false },
    created_by: {
      type: 'integer',
      notNull: false, // seed row อาจไม่มี actor
      references: '"users"',
      onDelete: 'SET NULL',
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // 3. constraints
  pgm.addConstraint('cert_requirements', 'cert_req_min_activities_check', {
    check:
      'group_a_min_activities > 0 AND group_b_min_activities > 0',
  });
  pgm.addConstraint('cert_requirements', 'cert_req_min_hours_check', {
    check: 'min_total_hours > 0',
  });
  // ใช้ <= เพื่อรองรับกรณีที่ super_admin แก้ rule วันเดียวกับวันที่ rule เก่าเริ่มใช้
  // (เช่น แก้ใน 1 วันหลายครั้ง) — effective_from = effective_to = today ถูกต้อง
  pgm.addConstraint('cert_requirements', 'cert_req_period_check', {
    check: 'effective_to IS NULL OR effective_from <= effective_to',
  });
  pgm.addConstraint('cert_requirements', 'cert_req_prefixes_nonempty_check', {
    check:
      'array_length(group_a_prefixes, 1) > 0 AND array_length(group_b_prefixes, 1) > 0',
  });

  // 4. partial unique — บังคับ active row เดียวเสมอ
  pgm.sql(`
    CREATE UNIQUE INDEX cert_requirements_one_active
      ON cert_requirements ((effective_to IS NULL))
      WHERE effective_to IS NULL;
  `);

  // 5. seed initial rule (เริ่มใช้วันที่รัน migration นี้)
  //    note ระบุที่มา เพื่อ admin รู้ว่ามาจาก seed (ไม่มี created_by)
  pgm.sql(`
    INSERT INTO cert_requirements
      (group_a_prefixes, group_b_prefixes,
       group_a_min_activities, group_b_min_activities, min_total_hours,
       note)
    VALUES
      (ARRAY['A','B','C'], ARRAY['D','E','F','G'],
       4, 4, 100,
       'seed initial rule (Phase 1 migration)');
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('cert_requirements');
  // recreate เก่า (กัน rollback แล้วเสียโครงสร้างที่ migration ก่อนหน้าสร้างไว้)
  pgm.createType('cert_req_scope', ['total', 'category']);
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
};
