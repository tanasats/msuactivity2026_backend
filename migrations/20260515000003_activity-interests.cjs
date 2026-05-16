/* eslint-disable camelcase */

// ── ผู้สนใจกิจกรรม (interest tracking) ─────────────────────────────
//
// MVP design:
//   1. activities.view_count       — counter ของ page view (denormalized)
//   2. activities.interested_count — counter ของจำนวนนิสิตที่กด "สนใจ"
//   3. activity_interests          — m2m ของ user_id × activity_id
//
// View counter:
//   - increment ผ่าน POST /api/activities/:id/view (public, ไม่ต้อง auth)
//   - dedup ฝั่ง client ด้วย localStorage (1 view ต่อ session)
//   - ไม่ต้องเก็บ event log — แค่ counter พอ
//
// Interest:
//   - toggle (add/remove) ผ่าน student endpoint (auth นิสิตเท่านั้น)
//   - sync counter ใน activities.interested_count ผ่าน transaction
//     (ทาง app — ไม่ใช้ trigger เพื่อให้ debug ง่าย + logic ชัดเจน)

exports.up = (pgm) => {
  // 1. counters บน activities
  pgm.addColumns('activities', {
    view_count: { type: 'integer', notNull: true, default: 0 },
    interested_count: { type: 'integer', notNull: true, default: 0 },
  });

  // 2. interests table (m2m)
  pgm.createTable('activity_interests', {
    user_id: {
      type: 'integer',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
    activity_id: {
      type: 'integer',
      notNull: true,
      references: 'activities(id)',
      onDelete: 'CASCADE',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('activity_interests', 'activity_interests_pkey', {
    primaryKey: ['user_id', 'activity_id'],
  });

  // index สำหรับ query "ใครสนใจกิจกรรมนี้บ้าง" และ count by activity
  pgm.createIndex('activity_interests', ['activity_id'], {
    name: 'idx_activity_interests_activity',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('activity_interests');
  pgm.dropColumns('activities', ['view_count', 'interested_count']);
};
