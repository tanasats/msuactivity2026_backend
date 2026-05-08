/* eslint-disable camelcase */

// Simplify check-in: เหลือวิธีเดียว QR_STAFF (นิสิตแสดง QR ของ registration ให้เจ้าหน้าที่ scan)
// ตัด dead structures ที่ไม่เกี่ยวกับวิธีนี้:
//   - DROP TABLE activity_check_in_methods (m2m เพราะมีวิธีเดียวแล้ว)
//   - DROP COLUMNs activities.{venue_lat, venue_lng, check_in_radius_meters, check_in_config}
//     (เคยใช้กับ SELFIE_GEO + PIN_CODE)
//   - DELETE system_settings keys ที่ไม่เกี่ยว
//
// คงเก็บไว้:
//   - enum check_in_method (attendances.method ใช้อยู่; ทุก attendance ใหม่จะเป็น QR_STAFF)
//   - activities.{check_in_opens_at, check_in_closes_at} — window ที่เจ้าหน้าที่ scan ได้
//   - registrations.qr_token — UUID ที่ encode ใน QR
//   - attendances.* (geo/selfie cols) — ปล่อยไว้เพื่อหลีกเลี่ยง migration cost; แถวใหม่ NULL ทั้งหมด
//   - system_settings: check_in.default_window_before_minutes (30) + ..._after_minutes (15)

exports.up = (pgm) => {
  pgm.dropTable('activity_check_in_methods');

  pgm.dropConstraint('activities', 'activities_radius_check');
  pgm.dropColumns('activities', [
    'venue_lat',
    'venue_lng',
    'check_in_radius_meters',
    'check_in_config',
  ]);

  pgm.sql(`
    DELETE FROM system_settings
     WHERE key IN (
       'check_in.default_radius_meters',
       'check_in.selfie_max_exif_skew_minutes'
     );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    INSERT INTO system_settings (key, value) VALUES
      ('check_in.default_radius_meters', '300'),
      ('check_in.selfie_max_exif_skew_minutes', '5')
    ON CONFLICT (key) DO NOTHING;
  `);

  pgm.addColumns('activities', {
    venue_lat: { type: 'decimal(10,7)' },
    venue_lng: { type: 'decimal(10,7)' },
    check_in_radius_meters: { type: 'integer' },
    check_in_config: { type: 'jsonb', notNull: true, default: '{}' },
  });
  pgm.addConstraint('activities', 'activities_radius_check', {
    check: 'check_in_radius_meters IS NULL OR check_in_radius_meters > 0',
  });

  pgm.createTable('activity_check_in_methods', {
    activity_id: {
      type: 'integer',
      notNull: true,
      references: 'activities',
      onDelete: 'CASCADE',
    },
    method: { type: 'check_in_method', notNull: true },
  });
  pgm.addConstraint('activity_check_in_methods', 'activity_check_in_methods_pkey', {
    primaryKey: ['activity_id', 'method'],
  });
};
