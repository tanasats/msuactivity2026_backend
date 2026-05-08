/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.createTable('activity_categories', {
    id: 'id',
    code: { type: 'smallint', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // 4 หมวดทางการของ MSU — super_admin แก้ได้ภายหลัง
  pgm.sql(`
    INSERT INTO activity_categories (code, name) VALUES
      (1, 'กิจกรรมด้านนิสิตสัมพันธ์และวิชาการ'),
      (2, 'กิจกรรมด้านกีฬา'),
      (3, 'กิจกรรมด้านบำเพ็ญประโยชน์'),
      (4, 'กิจกรรมด้านศิลปวัฒนธรรม');
  `);

  pgm.createTable('skills', {
    id: 'id',
    code: { type: 'text', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('skills');
  pgm.dropTable('activity_categories');
};
