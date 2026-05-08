import { pool, query } from '../db/index.js';

// flow ของ QR_STAFF check-in:
//   1. นิสิตได้ qr_token (UUID) ตอน registration → REGISTERED
//   2. แสดง QR ที่ encode UUID ตรง ๆ ให้เจ้าหน้าที่ scan
//   3. เจ้าหน้าที่ POST /api/faculty/activities/:id/check-in { qr_token }
//   4. backend: validate → INSERT attendance (method=QR_STAFF, status=VALID)
//                       + UPDATE registration (status=ATTENDED, attended_at=now())

// ค้น registration ตาม qr_token พร้อมข้อมูลกิจกรรม + นิสิต ที่ใช้ validate
export async function findActiveRegistrationByToken(qrToken) {
  const { rows } = await query(
    `SELECT r.id              AS registration_id,
            r.user_id,
            r.activity_id,
            r.status          AS registration_status,
            r.qr_token,
            u.full_name       AS student_name,
            u.msu_id,
            a.title           AS activity_title,
            a.location        AS activity_location,
            a.start_at,
            a.end_at,
            a.check_in_opens_at,
            a.check_in_closes_at,
            a.status          AS activity_status,
            a.faculty_id      AS activity_owner_faculty_id
       FROM registrations r
       JOIN users u           ON u.id = r.user_id
       JOIN activities a      ON a.id = r.activity_id
      WHERE r.qr_token = $1`,
    [qrToken],
  );
  return rows[0] || null;
}

// อ่าน fallback window minutes จาก system_settings (super_admin ตั้งเอง)
export async function getCheckInWindowDefaults() {
  const { rows } = await query(
    `SELECT key, value FROM system_settings
      WHERE key IN (
        'check_in.default_window_before_minutes',
        'check_in.default_window_after_minutes'
      )`,
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  // value เป็น jsonb — pg parse ให้แล้ว (number); fallback hard-code ถ้า key หาย
  return {
    beforeMinutes: Number(map['check_in.default_window_before_minutes'] ?? 30),
    afterMinutes: Number(map['check_in.default_window_after_minutes'] ?? 15),
  };
}

// transaction: insert attendance + mark registration ATTENDED
// คืน { attendanceId } หรือ throw ถ้า unique-violation (กัน double check-in)
export async function recordCheckIn({ registrationId, checkedInBy }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: attRows } = await client.query(
      `INSERT INTO attendances (registration_id, method, status, checked_in_by)
       VALUES ($1, 'QR_STAFF', 'VALID', $2)
       RETURNING id, checked_in_at`,
      [registrationId, checkedInBy],
    );
    // ตั้ง evaluation_status = PENDING_EVALUATION เพื่อให้เจ้าหน้าที่คณะมาประเมินผล (ผ่าน/ไม่ผ่าน)
    await client.query(
      `UPDATE registrations
          SET status            = 'ATTENDED',
              attended_at       = now(),
              evaluation_status = 'PENDING_EVALUATION',
              updated_at        = now()
        WHERE id = $1`,
      [registrationId],
    );

    await client.query('COMMIT');
    return { attendanceId: attRows[0].id, checkedInAt: attRows[0].checked_in_at };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
