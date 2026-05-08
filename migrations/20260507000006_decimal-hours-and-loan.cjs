/* eslint-disable camelcase */

// ปรับ "ชั่วโมงกิจกรรม" + เพิ่ม "ชั่วโมง กยศ":
//   - hours      : smallint → decimal(4,1)  (รองรับทศนิยม 1 ตำแหน่ง เช่น 2.5 ชั่วโมง)
//   - loan_hours : decimal(4,1) NOT NULL DEFAULT 0  (ชั่วโมง กยศ; 0 = ไม่นับ)
//
// constraint:
//   - hours > 0       (มีอยู่แล้ว — ตรวจกับค่า decimal ก็ทำงาน)
//   - loan_hours >= 0 (ใหม่)

exports.up = (pgm) => {
  // 1. cast hours จาก smallint เป็น decimal(4,1) — preserve ค่าเดิม
  pgm.sql(`
    ALTER TABLE activities
      ALTER COLUMN hours TYPE decimal(4,1) USING hours::decimal(4,1);
  `);

  // 2. เพิ่ม loan_hours (default 0)
  pgm.addColumns('activities', {
    loan_hours: { type: 'decimal(4,1)', notNull: true, default: 0 },
  });

  pgm.addConstraint('activities', 'activities_loan_hours_check', {
    check: 'loan_hours >= 0',
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('activities', 'activities_loan_hours_check');
  pgm.dropColumns('activities', ['loan_hours']);
  // lossy rollback — round เป็น smallint
  pgm.sql(`
    ALTER TABLE activities
      ALTER COLUMN hours TYPE smallint USING ROUND(hours)::smallint;
  `);
};
