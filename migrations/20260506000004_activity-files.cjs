/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.createType('activity_file_kind', ['POSTER', 'DOCUMENT', 'GALLERY']);

  pgm.createTable('activity_files', {
    id: 'id',
    activity_id: {
      type: 'integer',
      notNull: true,
      references: 'activities',
      onDelete: 'CASCADE',
    },
    kind: { type: 'activity_file_kind', notNull: true },
    filename: { type: 'text', notNull: true },
    mime_type: { type: 'text', notNull: true },
    size_bytes: { type: 'integer', notNull: true },
    storage_key: { type: 'text', notNull: true, unique: true },
    display_order: { type: 'smallint', notNull: true, default: 0 },
    uploaded_by: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'RESTRICT',
    },
    uploaded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('activity_files', 'activity_files_size_check', {
    check: 'size_bytes > 0',
  });

  // โปสเตอร์ได้แค่ 1 ต่อกิจกรรม (required ที่ DRAFT บังคับ app layer)
  pgm.createIndex('activity_files', 'activity_id', {
    unique: true,
    where: "kind = 'POSTER'",
    name: 'uniq_activity_poster',
  });

  pgm.createIndex('activity_files', ['activity_id', 'kind', 'display_order'], {
    name: 'idx_activity_files_browse',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('activity_files');
  pgm.dropType('activity_file_kind');
};
