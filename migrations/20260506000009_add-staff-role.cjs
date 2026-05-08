/* eslint-disable camelcase */

// เพิ่ม role 'staff' เข้า enum user_role
// staff = default role สำหรับบุคลากร MSU ที่ login ครั้งแรก (ยังไม่มีสิทธิ์ใดๆ)
// admin/super_admin จะ promote → faculty_staff/executive/admin ภายหลัง
// วางก่อน 'faculty_staff' เพื่อสื่อ progression: staff → faculty_staff → ...

exports.up = (pgm) => {
  pgm.addTypeValue('user_role', 'staff', { before: 'faculty_staff' });
};

exports.down = () => {
  // Postgres ไม่รองรับการลบ enum value โดยตรง — ต้องสร้าง type ใหม่ + copy ข้อมูล
  // ถ้าจำเป็นต้อง rollback จริง ให้ทำมือ: ตรวจว่าไม่มี users ที่ role='staff' ก่อน
  throw new Error(
    'Cannot remove enum value "staff" automatically. Manual SQL required: ' +
      'verify no users have role=staff, then ALTER TYPE user_role RENAME → CREATE new TYPE → migrate data.',
  );
};
