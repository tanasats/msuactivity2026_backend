/* eslint-disable camelcase */

// เพิ่ม column `category` บน faculties — แบ่งกลุ่มหน่วยงานเพื่อ filter ใน UI
//   - 'A' = หน่วยงานที่มีนิสิตสังกัด (คณะวิชาการ + วิทยาลัย + บัณฑิตวิทยาลัย)
//   - NULL = ยังไม่จัดประเภท (สำนัก/กอง/สถาบันวิจัย/โรงเรียนสาธิต/ฯลฯ — super_admin assign ภายหลัง)
//
// ใน form "คณะที่รับสมัคร" ของกิจกรรม จะ filter เฉพาะ category='A' (ดู frontend ActivityForm)

exports.up = (pgm) => {
  pgm.addColumns('faculties', {
    category: { type: 'text' },
  });
  pgm.createIndex('faculties', 'category');

  // backfill: 20 หน่วยงานที่มีนิสิต = 'A'
  pgm.sql(`
    UPDATE faculties SET category = 'A'
     WHERE code IN (
       '01','02','03','04','05','07','08','09','10','11',
       '12','13','14','15','17','20','22','23','24',
       '62'
     );
  `);
};

exports.down = (pgm) => {
  pgm.dropIndex('faculties', 'category');
  pgm.dropColumns('faculties', ['category']);
};
