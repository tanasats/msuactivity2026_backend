/* eslint-disable camelcase */

// เพิ่ม profile fields บน users:
//   - จาก Google ID token: google_sub (UNIQUE), picture_url
//   - จาก ERP API (เฉพาะ non-student): staff_id, ชื่อ-สกุล th/en, prefix, position,
//     หน่วยงานตาม ERP (faculty/department/program), phone, erp_synced_at
//
// หมายเหตุ: erp_* คือ "หน่วยงาน" ตามข้อมูล ERP (สำนักงานอธิการบดี, กองแผนงาน ฯลฯ)
// ไม่ใช่ entity เดียวกับ faculties table (คณะวิชาการสำหรับนิสิต) — เก็บแยกโดยตั้งใจ

exports.up = (pgm) => {
  pgm.addColumns('users', {
    google_sub: { type: 'text', unique: true },
    picture_url: { type: 'text' },

    staff_id: { type: 'text', unique: true },
    prefix_th: { type: 'text' },
    prefix_en: { type: 'text' },
    name_th: { type: 'text' },
    surname_th: { type: 'text' },
    name_en: { type: 'text' },
    surname_en: { type: 'text' },
    position_th: { type: 'text' },
    phone: { type: 'text' },

    erp_faculty_id: { type: 'text' },
    erp_faculty_name: { type: 'text' },
    erp_department_id: { type: 'text' },
    erp_department_name: { type: 'text' },
    erp_program_id: { type: 'text' },
    erp_program_name: { type: 'text' },
    erp_synced_at: { type: 'timestamptz' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('users', [
    'google_sub',
    'picture_url',
    'staff_id',
    'prefix_th',
    'prefix_en',
    'name_th',
    'surname_th',
    'name_en',
    'surname_en',
    'position_th',
    'phone',
    'erp_faculty_id',
    'erp_faculty_name',
    'erp_department_id',
    'erp_department_name',
    'erp_program_id',
    'erp_program_name',
    'erp_synced_at',
  ]);
};
