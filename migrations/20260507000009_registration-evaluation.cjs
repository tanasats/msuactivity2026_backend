/* eslint-disable camelcase */

// ผลประเมินการเข้าร่วมกิจกรรม (เจ้าหน้าที่คณะให้หลังนิสิตเช็คอิน)
//   - PENDING_EVALUATION: ตั้งอัตโนมัติตอน check-in สำเร็จ (registration.status = ATTENDED)
//   - PASSED / FAILED:   เจ้าหน้าที่ประเมินผ่าน /api/faculty/.../registrations/:id/evaluate
//   - ปล่อย NULL ถ้ายังไม่มี attendance (กันสับสนระหว่าง "ยังไม่เช็คอิน" กับ "รอประเมิน")

exports.up = (pgm) => {
  pgm.createType('evaluation_status', ['PENDING_EVALUATION', 'PASSED', 'FAILED']);

  pgm.addColumns('registrations', {
    evaluation_status: { type: 'evaluation_status' },
    evaluated_at: { type: 'timestamptz' },
    evaluated_by: { type: 'integer', references: 'users' },
    evaluation_note: { type: 'text' },
  });

  // backfill: ถ้ามี ATTENDED row อยู่แล้ว → เซ็ตเป็น PENDING_EVALUATION
  pgm.sql(`
    UPDATE registrations
       SET evaluation_status = 'PENDING_EVALUATION'
     WHERE status = 'ATTENDED'
       AND evaluation_status IS NULL
  `);
};

exports.down = (pgm) => {
  pgm.dropColumns('registrations', [
    'evaluation_status',
    'evaluated_at',
    'evaluated_by',
    'evaluation_note',
  ]);
  pgm.dropType('evaluation_status');
};
