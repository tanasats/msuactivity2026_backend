/* eslint-disable camelcase */

// Index ให้พร้อมรับ users 20K+ ที่ใช้ใน super_admin user management
//   - users(created_at DESC, id DESC) → รองรับ ORDER BY ของ list view โดยตรง
//   - GIN trigram (pg_trgm) บน email, full_name, msu_id → ILIKE %q% เร็วระดับ ms
//   - users(status) → กรอง active/disabled (cardinality ต่ำแต่ความถี่สูง)

exports.up = (pgm) => {
  pgm.createExtension('pg_trgm', { ifNotExists: true });
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS users_created_at_desc_idx
      ON users (created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS users_email_trgm_idx
      ON users USING gin (email gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS users_full_name_trgm_idx
      ON users USING gin (full_name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS users_msu_id_trgm_idx
      ON users USING gin (msu_id gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS users_status_idx
      ON users (status);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS users_status_idx;
    DROP INDEX IF EXISTS users_msu_id_trgm_idx;
    DROP INDEX IF EXISTS users_full_name_trgm_idx;
    DROP INDEX IF EXISTS users_email_trgm_idx;
    DROP INDEX IF EXISTS users_created_at_desc_idx;
  `);
  // ไม่ drop pg_trgm — extension อาจถูกใช้โดย index ตารางอื่นในอนาคต
};
