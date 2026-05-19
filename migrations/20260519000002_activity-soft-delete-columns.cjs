/* eslint-disable camelcase */

// Phase 1b: คอลัมน์รองรับ soft-delete
//   - previous_status: เก็บ status ก่อนลบ → restore กลับไป
//   - deleted_at / deleted_by: trash list + accountability (กัน JOIN audit log ทุก list)
//   - partial index ใช้ค่า 'DELETED' จาก migration ก่อนหน้า (committed แล้ว)

exports.up = (pgm) => {
  pgm.addColumns('activities', {
    previous_status: { type: 'text', notNull: false },
    deleted_at: { type: 'timestamptz', notNull: false },
    deleted_by: {
      type: 'integer',
      notNull: false,
      references: '"users"',
      onDelete: 'SET NULL',
    },
  });

  // partial index เร่ง trash listing
  pgm.createIndex('activities', ['deleted_at'], {
    name: 'idx_activities_deleted',
    where: "status = 'DELETED'",
    method: 'btree',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('activities', ['deleted_at'], {
    name: 'idx_activities_deleted',
    ifExists: true,
  });
  pgm.dropColumns('activities', ['deleted_by', 'deleted_at', 'previous_status']);
};
