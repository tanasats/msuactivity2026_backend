/* eslint-disable camelcase */

// ── เพิ่ม hierarchy ให้ skills ──────────────────────────────────────────
//   skill เป็น 2 ระดับ:
//     parent (parent_id=NULL, academic_year=NULL) — รายการแม่ ใช้ข้ามปี (S1–S5 เดิม)
//     child  (parent_id NOT NULL, academic_year NOT NULL) — รายการรายปี ของปีนั้น ๆ
//   activity_skills ผูกเข้ากับ child เท่านั้น (super_admin จะตรวจตอน validate)
//   รายงานข้ามปีของนิสิต = JOIN ผ่าน child.parent_id แล้ว GROUP BY parent
//
//   uniqueness:
//     parent: unique(code) WHERE parent_id IS NULL — กัน code ซ้ำใน parent
//     child:  unique(parent_id, academic_year, code) — code ซ้ำได้ข้ามปี/ข้าม parent
//
// migration นี้ออกแบบให้ S1–S5 เดิมยังคงสภาพ (กลายเป็น parent ทั้งหมด)
// activity_skills ที่อ้างถึง S1–S5 เดิมจะ "ค้าง" (อ้าง parent โดยตรง) ซึ่งหลังจาก
// super_admin สร้าง child ของปีปัจจุบันแล้ว ค่อย re-link ทีหลังหรือยอมรับว่ามี
// กิจกรรมเก่าผูก parent ตรง ๆ (ฝั่ง query rollup ใช้ COALESCE(parent_id, id))

exports.up = (pgm) => {
  // 1. เพิ่ม column
  pgm.addColumns('skills', {
    parent_id: {
      type: 'integer',
      references: 'skills(id)',
      onDelete: 'RESTRICT',
    },
    academic_year: { type: 'integer' },
  });

  // 2. drop unique(code) global (ของเดิมตอน createTable)
  //    pg sets default name "skills_code_key" สำหรับ unique constraint single column
  pgm.dropConstraint('skills', 'skills_code_key');

  // 3. partial unique สำหรับ parent code
  pgm.createIndex('skills', ['code'], {
    name: 'uniq_skills_parent_code',
    unique: true,
    where: 'parent_id IS NULL',
  });

  // 4. unique สำหรับ child ภายใน (parent, year)
  pgm.createIndex('skills', ['parent_id', 'academic_year', 'code'], {
    name: 'uniq_skills_child_code',
    unique: true,
    where: 'parent_id IS NOT NULL',
  });

  // 5. check constraint: parent_id และ academic_year ต้อง NULL คู่กัน หรือ NOT NULL คู่กัน
  pgm.addConstraint('skills', 'skills_hierarchy_chk', {
    check: `(parent_id IS NULL AND academic_year IS NULL)
         OR (parent_id IS NOT NULL AND academic_year IS NOT NULL)`,
  });

  // 6. lookup index — query ที่เจอบ่อย: list children ของปี Y
  pgm.createIndex('skills', ['academic_year', 'parent_id'], {
    name: 'idx_skills_year',
    where: 'parent_id IS NOT NULL',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('skills', null, { name: 'idx_skills_year' });
  pgm.dropConstraint('skills', 'skills_hierarchy_chk');
  pgm.dropIndex('skills', null, { name: 'uniq_skills_child_code' });
  pgm.dropIndex('skills', null, { name: 'uniq_skills_parent_code' });
  pgm.addConstraint('skills', 'skills_code_key', { unique: 'code' });
  pgm.dropColumns('skills', ['parent_id', 'academic_year']);
};
