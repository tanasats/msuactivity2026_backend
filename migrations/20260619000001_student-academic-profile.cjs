/* eslint-disable camelcase */

// เพิ่ม profile วิชาการของนิสิตสำหรับ "ทรานสคริปต์กิจกรรม" (ใบระเบียนกิจกรรมนิสิต)
//   - major_name      : สาขาวิชา/เอก
//   - degree_name     : ปริญญาที่ได้รับ (เช่น ศศ.บ.)
//   - admission_date  : วันที่รับเข้าศึกษา
//
// ทั้งหมด nullable — "เตรียมที่เก็บไว้ก่อน" รอ API ระบบทะเบียนในอนาคต
//   ระหว่างนี้ admin กรอกเองได้ตอนออกทรานสคริปต์ (PATCH /admin/students/:id/academic-profile)
//   ส่วนชื่ออังกฤษใช้ name_en/surname_en/prefix_en ที่มีอยู่แล้ว (migration ...user-google-and-erp)

exports.up = (pgm) => {
  pgm.addColumns('users', {
    major_name: { type: 'text' },
    degree_name: { type: 'text' },
    admission_date: { type: 'date' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('users', ['major_name', 'degree_name', 'admission_date']);
};
