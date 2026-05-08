/* eslint-disable camelcase */

// State machine ของกิจกรรม simplify เป็น 4 สถานะ:
//   DRAFT ──submit──► PENDING_APPROVAL ──approve──► WORK ──► COMPLETED
//                          │
//                          │ admin reject (เก็บใน rejection_reason)
//                          ▼
//                       DRAFT  (กลับไปแก้แล้ว resubmit)
//
// Mapping จาก enum เดิม (7 ค่า) → ใหม่ (4 ค่า):
//   DRAFT             → DRAFT
//   PENDING_APPROVAL  → PENDING_APPROVAL
//   REJECTED          → DRAFT          (rejection_reason ยังเก็บ — faculty เห็น + แก้ resubmit)
//   APPROVED          → WORK           (รวม approve + publish เป็น step เดียว)
//   PUBLISHED         → WORK
//   CANCELLED         → COMPLETED      (terminal — ไม่มีสถานะ cancel แยก)
//   COMPLETED         → COMPLETED

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. cast column ไป text เพื่อ drop enum + update ค่าได้
    ALTER TABLE activities ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE activities ALTER COLUMN status TYPE text USING status::text;

    -- 2. drop old enum (no other column ใช้)
    DROP TYPE activity_status;

    -- 3. map ค่าเก่า → ใหม่
    UPDATE activities SET status = 'DRAFT'      WHERE status = 'REJECTED';
    UPDATE activities SET status = 'WORK'       WHERE status IN ('APPROVED', 'PUBLISHED');
    UPDATE activities SET status = 'COMPLETED'  WHERE status = 'CANCELLED';

    -- 4. create new enum (4 values)
    CREATE TYPE activity_status AS ENUM ('DRAFT','PENDING_APPROVAL','WORK','COMPLETED');

    -- 5. cast back + restore default
    ALTER TABLE activities
      ALTER COLUMN status TYPE activity_status USING status::activity_status,
      ALTER COLUMN status SET DEFAULT 'DRAFT';
  `);
};

exports.down = (pgm) => {
  // lossy rollback: WORK → APPROVED (ไม่สามารถ recover PUBLISHED state เดิมได้)
  pgm.sql(`
    ALTER TABLE activities ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE activities ALTER COLUMN status TYPE text USING status::text;
    DROP TYPE activity_status;
    UPDATE activities SET status = 'APPROVED' WHERE status = 'WORK';
    CREATE TYPE activity_status AS ENUM (
      'DRAFT','PENDING_APPROVAL','REJECTED','APPROVED','PUBLISHED','CANCELLED','COMPLETED'
    );
    ALTER TABLE activities
      ALTER COLUMN status TYPE activity_status USING status::activity_status,
      ALTER COLUMN status SET DEFAULT 'DRAFT';
  `);
};
