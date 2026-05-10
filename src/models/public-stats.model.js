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

// สถิติสำหรับ landing page — all-time totals + breakdown
//   - activities_count: เฉพาะ status WORK + COMPLETED (กิจกรรมที่จัดจริง — ไม่นับ DRAFT/PENDING)
//   - members_count   : บัญชีที่ active (ทุก role)
//   - by_year         : กิจกรรมต่อปีการศึกษา แบ่ง work/completed (ทุกปีที่มีข้อมูล)
//   - by_category     : กิจกรรมต่อหมวดประเภท 4 หมวด (ทุกปี รวม)
export async function getLandingStats() {
  const [totals, byYear, byCategory] = await Promise.all([
    query(
      `SELECT
         (SELECT COUNT(*)::int FROM activities
            WHERE status IN ('WORK','COMPLETED')) AS activities_count,
         (SELECT COUNT(*)::int FROM users WHERE status = 'active') AS members_count`,
    ),
    query(
      `SELECT
         academic_year,
         COUNT(*) FILTER (WHERE status = 'WORK')::int      AS work_count,
         COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_count
       FROM activities
       WHERE status IN ('WORK','COMPLETED')
       GROUP BY academic_year
       ORDER BY academic_year ASC`,
    ),
    query(
      `SELECT
         c.id   AS category_id,
         c.code AS category_code,
         c.name AS category_name,
         COUNT(a.id)::int AS count
       FROM activity_categories c
       LEFT JOIN activities a
         ON a.category_id = c.id
        AND a.status IN ('WORK','COMPLETED')
       GROUP BY c.id, c.code, c.name
       ORDER BY c.code ASC`,
    ),
  ]);

  return {
    activities_count: totals.rows[0].activities_count,
    members_count: totals.rows[0].members_count,
    by_year: byYear.rows,
    by_category: byCategory.rows,
  };
}
