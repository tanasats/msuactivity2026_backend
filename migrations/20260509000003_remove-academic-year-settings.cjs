/* eslint-disable camelcase */

// ลบ system_settings keys ของ academic_year — ฟีเจอร์ "super_admin ตั้งวงรอบปีการศึกษา"
// ถูก rollback เพราะในทางปฏิบัติแทบไม่มีผล:
//   - การจำแนกกิจกรรมจริงใช้ activities.academic_year column ที่กำหนดตอน create
//   - settings มีผลแค่ default ตอน create form / dropdown bootstrap / public stats default
//   - มมส boundary คงที่ 1 ส.ค. ไม่จำเป็นต้อง configurable
//
// หลัง migration นี้: getCurrentAcademicYearBE() กลับไป hardcode 1 ส.ค. (เหมือนเดิม)

exports.up = (pgm) => {
  pgm.sql(`
    DELETE FROM system_settings
     WHERE key IN ('academic_year.start_month', 'academic_year.start_day');
  `);
};

exports.down = (pgm) => {
  // restore default ถ้าจะ rollback (ฟีเจอร์ก่อนถอน)
  pgm.sql(`
    INSERT INTO system_settings (key, value) VALUES
      ('academic_year.start_month', '8'::jsonb),
      ('academic_year.start_day',   '1'::jsonb)
    ON CONFLICT (key) DO NOTHING;
  `);
};
