/* eslint-disable camelcase */

// ── targeting ของประกาศ — ส่งเฉพาะบาง role / บางคณะ ───────────────
//   audience_roles       : jsonb array ของ role (NULL = ทุก role)
//   audience_faculty_ids : jsonb array ของ faculty_id (NULL = ทุกคณะ)
//   ประกาศจะเห็นเมื่อ (roles NULL หรือมี role ผู้ใช้) และ (faculty_ids NULL หรือมีคณะผู้ใช้)
//   public landing เห็นเฉพาะประกาศ global (ทั้งสอง NULL)

exports.up = (pgm) => {
  pgm.addColumns('announcements', {
    audience_roles: { type: 'jsonb' }, // NULL = ทุก role
    audience_faculty_ids: { type: 'jsonb' }, // NULL = ทุกคณะ
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('announcements', ['audience_roles', 'audience_faculty_ids']);
};
