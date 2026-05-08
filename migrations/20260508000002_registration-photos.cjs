/* eslint-disable camelcase */

// รูปภาพหลักฐานการเข้าร่วมกิจกรรม — นิสิตอัปโหลดเอง (optional)
//   - 1 photo ผูกกับ 1 registration (ON DELETE CASCADE: ลบ registration → ลบรูปทั้งหมด)
//   - constraint "≤ 5 ภาพต่อ registration" บังคับใน backend (ไม่ใส่ใน DB เพราะ subquery CHECK ไม่ idiomatic)
//   - ปลด UNIQUE บน storage_key — กัน upload ซ้ำ key (UUID generated)
//   - กฎ access:
//       upload/delete = นิสิตเจ้าของ registration เท่านั้น + เฉพาะ evaluation_status='PASSED'
//       view = เจ้าของ + faculty staff คณะเดียวกับ activity (สำหรับ phase ถัดไป)

exports.up = (pgm) => {
  pgm.createTable('registration_photos', {
    id: 'id',
    registration_id: {
      type: 'integer',
      notNull: true,
      references: 'registrations',
      onDelete: 'CASCADE',
    },
    storage_key: { type: 'text', notNull: true, unique: true },
    filename: { type: 'text', notNull: true },
    mime_type: { type: 'text', notNull: true },
    size_bytes: { type: 'integer', notNull: true },
    uploaded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // หา/นับรูปต่อ registration เร็ว — ใช้ในทั้ง list + count guard
  pgm.createIndex('registration_photos', ['registration_id', 'uploaded_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('registration_photos');
};
