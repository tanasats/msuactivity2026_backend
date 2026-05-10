/* eslint-disable camelcase */

// Backfill activity_code_counters จาก codes ที่ assign ไปแล้วในตาราง activities
//
// บั๊กที่แก้: ที่ผ่านมาตาราง activity_code_counters ถูก seed/migrate ไม่ครบ ทำให้
//   เมื่อ admin กดอนุมัติกิจกรรมในกลุ่ม (org, ปีการศึกษา, ภาค, ประเภท) ที่ counter
//   ยังว่างอยู่ → ระบบสร้าง suffix "00" ใหม่ → ชนกับ activity ที่ใช้ code นั้นไปแล้ว
//   → unique constraint violation: "activities_code_key"
//
// วิธี backfill:
//   1. group activities ที่มี code ตาม (org, year, sem, cat)
//   2. หา max suffix (2 ตัวสุดท้ายของ code ตาม format [org4][yy2][sem1][cat1][run2])
//   3. INSERT counter row ที่ next_running = max_suffix + 1 (= ค่าที่ assign ครั้งถัดไปจะคืน)
//   4. ON CONFLICT → ใช้ค่ามากกว่า (กันลด counter ถ้ามีแก้แมนนวล)
//
// idempotent: รันซ้ำได้ไม่กระทบ
// fresh DB: ไม่มี activities → INSERT ไม่มีอะไรจะใส่ → no-op

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO activity_code_counters
      (organization_id, academic_year, semester, category_id, next_running)
    SELECT
      a.organization_id,
      a.academic_year,
      a.semester,
      a.category_id,
      MAX(CAST(SUBSTRING(a.code FROM 9 FOR 2) AS INT)) + 1
    FROM activities a
    WHERE a.code IS NOT NULL
      AND a.code ~ '^[A-Z0-9]{4}[0-9]{2}[0-9]{1}[0-9]{1}[0-9]{2}$'
    GROUP BY
      a.organization_id, a.academic_year, a.semester, a.category_id
    ON CONFLICT (organization_id, academic_year, semester, category_id)
    DO UPDATE SET
      next_running = GREATEST(
        activity_code_counters.next_running,
        EXCLUDED.next_running
      );
  `);
};

exports.down = (pgm) => {
  // ไม่ต้อง rollback — backfill เพิ่มข้อมูลที่ขาดเฉยๆ
  // (ถ้า rollback ก็ปล่อยให้ counter ว่างต่อ ซึ่งคือ state ก่อน backfill)
  pgm.sql(`SELECT 1`);
};
