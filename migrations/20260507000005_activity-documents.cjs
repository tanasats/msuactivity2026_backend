/* eslint-disable camelcase */

// เพิ่ม 2 columns บน activity_files เพื่อรองรับเอกสารประกอบ (kind=DOCUMENT):
//   - display_name TEXT — ชื่อที่แสดงใน UI (ผู้สร้างตั้งเอง); NULL = ใช้ filename เดิม
//   - is_public    BOOLEAN — เผยแพร่ในหน้า public detail หรือไม่ (default false)
//
// ใช้ได้กับ kind ทุกแบบ (POSTER/DOCUMENT/GALLERY) แต่ตอนนี้ใช้จริงแค่ DOCUMENT

exports.up = (pgm) => {
  pgm.addColumns('activity_files', {
    display_name: { type: 'text' },
    is_public: { type: 'boolean', notNull: true, default: false },
  });

  // index ช่วย query "เอกสาร public ของ activity" บ่อย
  pgm.createIndex(
    'activity_files',
    ['activity_id', 'kind', 'is_public'],
    { name: 'idx_activity_files_public' },
  );
};

exports.down = (pgm) => {
  pgm.dropIndex('activity_files', null, { name: 'idx_activity_files_public' });
  pgm.dropColumns('activity_files', ['display_name', 'is_public']);
};
