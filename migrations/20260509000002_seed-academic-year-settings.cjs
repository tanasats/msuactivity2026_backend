/* eslint-disable camelcase */

// Seed system_settings สำหรับ "วงรอบปีการศึกษา" (academic year cycle)
//   academic_year.start_month  — เดือนที่ปีการศึกษาใหม่เริ่ม (1-12)  default 8 (สิงหาคม)
//   academic_year.start_day    — วันที่ของเดือนนั้น (1-31)             default 1
//
// ใช้คำนวณ getCurrentAcademicYearBE() — ก่อนวันนี้ของปีปฏิทินไหน = ปีการศึกษานั้นยังไม่เริ่ม
// (เก็บเป็น jsonb numeric — ฝั่ง backend cast เป็น number ตอนใช้)

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO system_settings (key, value) VALUES
      ('academic_year.start_month', '8'::jsonb),
      ('academic_year.start_day',   '1'::jsonb)
    ON CONFLICT (key) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM system_settings
     WHERE key IN ('academic_year.start_month', 'academic_year.start_day');
  `);
};
