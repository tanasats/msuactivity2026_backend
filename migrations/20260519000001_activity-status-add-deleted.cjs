/* eslint-disable camelcase */

// Phase 1a: เพิ่มค่า 'DELETED' เข้า enum activity_status
//   แยกออกมาเป็น migration เดี่ยว เพราะ Postgres ห้ามใช้ค่า enum ใหม่
//   ใน transaction เดียวกันที่ ADD VALUE (error code 55P04 "unsafe use of new value")
//   migration ถัดไป (20260519000002) จะใช้ค่านี้ใน partial index ได้

exports.up = (pgm) => {
  pgm.sql(`ALTER TYPE activity_status ADD VALUE IF NOT EXISTS 'DELETED';`);
};

exports.down = () => {
  // Postgres ไม่รองรับ DROP VALUE จาก enum
  //   ถ้า rollback จำเป็นต้อง recreate type ทั้งก้อน (destructive)
  //   ปล่อย no-op — ค่า DELETED ที่เกินจะยังอยู่แต่ไม่มีแถวไหนใช้
};
