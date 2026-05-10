/* eslint-disable camelcase */

// อนุญาตให้กิจกรรมมี hours = 0 ได้
//   - constraint เดิม: activities_hours_check (hours > 0)  จาก migration #3
//   - constraint ใหม่: activities_hours_check (hours >= 0)
//
// use case: กิจกรรมบางอย่างไม่นับชั่วโมง (เช่น ประชุมรับฟัง, กิจกรรมเสริม) แต่ยังต้องการลงทะเบียน

exports.up = (pgm) => {
  pgm.dropConstraint('activities', 'activities_hours_check');
  pgm.addConstraint('activities', 'activities_hours_check', {
    check: 'hours >= 0',
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('activities', 'activities_hours_check');
  pgm.addConstraint('activities', 'activities_hours_check', {
    check: 'hours > 0',
  });
};
