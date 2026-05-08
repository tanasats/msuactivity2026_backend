/* eslint-disable camelcase */

// Denormalize ชื่อคณะลง users.faculty_name — snapshot ตอน set faculty_id
//   - ดึง user มาพร้อมชื่อคณะได้ทันที ไม่ต้อง JOIN faculties
//   - trade-off: ถ้า super_admin แก้ faculties.name ภายหลัง users.faculty_name จะค้างเก่า
//                (ยอมรับเพราะ rename คณะเกิดน้อย; ต้อง re-sync manual ถ้าจำเป็น)

exports.up = (pgm) => {
  pgm.addColumns('users', {
    faculty_name: { type: 'text' },
  });
  pgm.sql(`
    UPDATE users u
       SET faculty_name = f.name
      FROM faculties f
     WHERE f.id = u.faculty_id;
  `);
};

exports.down = (pgm) => {
  pgm.dropColumns('users', ['faculty_name']);
};
