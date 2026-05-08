/* eslint-disable camelcase */

// Seed master data ตามตัวอย่างใน memory project_master_data.md:
//   - organizations: 4 รายการ prefix A* / B* (parent_id ปล่อย NULL — hierarchy ยังไม่ confirm)
//   - skills: S1–S5 ตามรายการทางการของ MSU
// activity_categories ถูก seed ไปแล้วใน migration 20260506000002_master-data
//
// ทุก INSERT ใช้ ON CONFLICT (code) DO NOTHING เพื่อให้ run ซ้ำได้
// (กรณี super_admin แก้ name หลัง seed — name ที่แก้แล้วจะไม่ถูก overwrite)

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO organizations (code, name) VALUES
      ('A001', 'หน่วยงานภายในมหาวิทยาลัยมหาสารคาม'),
      ('A002', 'หน่วยงานภายนอกมหาวิทยาลัยมหาสารคาม'),
      ('B001', 'งานกิจการนิสิต กองกิจการนิสิต'),
      ('B002', 'งานกีฬา กองกิจการนิสิต')
    ON CONFLICT (code) DO NOTHING;
  `);

  pgm.sql(`
    INSERT INTO skills (code, name) VALUES
      ('S1', 'ทักษะการปรับตัว มีมนุษยสัมพันธ์ การทำงานร่วมกับผู้อื่น'),
      ('S2', 'ทักษะการคิดเชิงวิเคราะห์ การตัดสินใจ การคาดการณ์อนาคต'),
      ('S3', 'ทักษะด้านวุฒิภาวะ ความฉลาดทางอารมณ์'),
      ('S4', 'ทักษะด้านความคิดสร้างสรรค์ การสร้างวิธีคิดที่เปิดกว้าง ยืดหยุ่น'),
      ('S5', 'ทักษะด้านภาวะผู้นำ')
    ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  // ลบเฉพาะ row ที่ seed นี้ใส่เข้าไป (อ้างอิงโดย code)
  // หมายเหตุ: ถ้ามี activity reference อยู่ FK RESTRICT จะทำให้ rollback fail —
  // ในกรณีนั้นต้องลบ activity ที่อ้างถึงก่อน หรือ skip down step นี้
  pgm.sql(`DELETE FROM skills WHERE code IN ('S1','S2','S3','S4','S5');`);
  pgm.sql(`DELETE FROM organizations WHERE code IN ('A001','A002','B001','B002');`);
};
