/* eslint-disable camelcase */

// Denormalize faculty_id ของผู้สร้างกิจกรรมไปเก็บในตาราง activities โดยตรง
//   - เพิ่มความเร็วในการ scope query "กิจกรรมของคณะ"
//   - snapshot ตอนสร้าง — ถ้า user เปลี่ยน faculty ภายหลัง activity เดิมไม่กระทบ
//   - nullable เพราะผู้สร้างอาจไม่มี faculty_id ตอนเริ่มต้น (เคสพิเศษ)

exports.up = (pgm) => {
  pgm.addColumns('activities', {
    faculty_id: {
      type: 'integer',
      references: 'faculties',
      onDelete: 'RESTRICT',
    },
  });
  pgm.createIndex('activities', 'faculty_id');

  // backfill จาก users.faculty_id ของผู้สร้าง
  pgm.sql(`
    UPDATE activities a
       SET faculty_id = u.faculty_id
      FROM users u
     WHERE u.id = a.created_by;
  `);
};

exports.down = (pgm) => {
  pgm.dropIndex('activities', 'faculty_id');
  pgm.dropColumns('activities', ['faculty_id']);
};
