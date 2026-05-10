/* eslint-disable camelcase */

// Trigram GIN index ให้ค้นกิจกรรมแบบ ILIKE %q% เร็ว
//   - title : field หลักที่ผู้ใช้ค้น
//   - code  : ผู้ใช้บางครั้งจำ code ได้ (B009682101)
// pg_trgm extension เปิดอยู่แล้วจาก migration #25 (users-scale-indexes)

exports.up = (pgm) => {
  // title เป็น text → ใช้ trigram ตรงๆ ได้
  // code เป็น char(10) (CHARACTER) → trigram ไม่รับ ต้อง cast เป็น text ผ่าน functional index
  //   (queries ที่จะใช้ index นี้ ต้อง a.code::text ILIKE หรือเทียบกับ expression เดียวกัน)
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS activities_title_trgm_idx
      ON activities USING gin (title gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS activities_code_trgm_idx
      ON activities USING gin ((code::text) gin_trgm_ops);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS activities_code_trgm_idx;
    DROP INDEX IF EXISTS activities_title_trgm_idx;
  `);
};
