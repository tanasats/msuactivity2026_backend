/* eslint-disable camelcase */

// บังคับ activities.check_in_opens_at / check_in_closes_at NOT NULL
//
// เหตุผล:
//   - ลด NULL semantic ("null = ใช้ default ของระบบ") ทั่วโค้ดเบส
//   - ทุก activity เก็บ snapshot ของช่วงเช็คอินในตัวเอง — super_admin
//     เปลี่ยน system_settings ไม่กระทบ activity เก่า (snapshot pattern)
//   - check-in.controller ไม่ต้องมี fallback path
//
// Backfill: ใช้ system_settings ปัจจุบัน
//   opens  = start_at - before_minutes
//   closes = end_at + after_minutes
//   (ตรงกับ behavior runtime เดิม)

exports.up = (pgm) => {
  pgm.sql(`
    UPDATE activities a
       SET check_in_opens_at = a.start_at - (
              (SELECT (value)::int FROM system_settings
                WHERE key = 'check_in.default_window_before_minutes') * interval '1 minute'
            )
     WHERE check_in_opens_at IS NULL;

    UPDATE activities a
       SET check_in_closes_at = a.end_at + (
              (SELECT (value)::int FROM system_settings
                WHERE key = 'check_in.default_window_after_minutes') * interval '1 minute'
            )
     WHERE check_in_closes_at IS NULL;
  `);

  pgm.alterColumn('activities', 'check_in_opens_at', { notNull: true });
  pgm.alterColumn('activities', 'check_in_closes_at', { notNull: true });
};

exports.down = (pgm) => {
  pgm.alterColumn('activities', 'check_in_opens_at', { notNull: false });
  pgm.alterColumn('activities', 'check_in_closes_at', { notNull: false });
  // ไม่ revert backfill — ค่าที่ใส่ไปแล้วถูกต้องตาม default policy
};
