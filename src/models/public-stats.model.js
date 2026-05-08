import { query } from '../db/index.js';

// สถิติบน landing page (อัปเดต 2026-05-07):
//   - activities_count    = จำนวนกิจกรรมทั้งหมดในปีการศึกษาปัจจุบัน (ทุก status)
//   - registrations_count = จำนวนการลงทะเบียน (กิจกรรมในปีปัจจุบัน + status active)
//                           1 นิสิต × 3 กิจกรรม = 3 (นับ row)
//                           filter เฉพาะ active = PENDING_APPROVAL | REGISTERED | ATTENDED
//                           (ไม่นับ CANCELLED / REJECTED / NO_SHOW)
//   - members_count       = จำนวนสมาชิกในระบบที่ active (ทุก role)
export async function getPublicStats(academicYearBE) {
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM activities WHERE academic_year = $1)
         AS activities_count,
       (SELECT COUNT(*)::int FROM registrations r
          JOIN activities a ON a.id = r.activity_id
          WHERE a.academic_year = $1
            AND r.status IN ('PENDING_APPROVAL','REGISTERED','ATTENDED'))
         AS registrations_count,
       (SELECT COUNT(*)::int FROM users WHERE status = 'active')
         AS members_count
    `,
    [academicYearBE],
  );
  return rows[0];
}
