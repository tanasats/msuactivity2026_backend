/* eslint-disable camelcase */

// เพิ่ม 3 ฟิลด์งบประมาณบน activities:
//   - budget_source     TEXT          แหล่งงบ (เช่น "งบประมาณรายจ่ายประจำปี", "งบกิจการนิสิต")
//   - budget_requested  DECIMAL(14,2) จำนวนเงินที่ขอใช้ (บาท); ตอนวางแผนกิจกรรม
//   - budget_actual     DECIMAL(14,2) จำนวนเงินที่จ่ายจริง (กรอกหลังกิจกรรมจบ — nullable)
//
// Required ที่ DRAFT: budget_source + budget_requested (บังคับที่ app layer)
// DB อนุญาต NULL ทั้ง 3 columns ชั่วคราวเพื่อ migrate ข้อมูลเก่า + รองรับ flow create

exports.up = (pgm) => {
  pgm.addColumns('activities', {
    budget_source: { type: 'text' },
    budget_requested: { type: 'decimal(14,2)' },
    budget_actual: { type: 'decimal(14,2)' },
  });

  pgm.addConstraint('activities', 'activities_budget_requested_check', {
    check: 'budget_requested IS NULL OR budget_requested >= 0',
  });
  pgm.addConstraint('activities', 'activities_budget_actual_check', {
    check: 'budget_actual IS NULL OR budget_actual >= 0',
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('activities', 'activities_budget_actual_check');
  pgm.dropConstraint('activities', 'activities_budget_requested_check');
  pgm.dropColumns('activities', [
    'budget_source',
    'budget_requested',
    'budget_actual',
  ]);
};
