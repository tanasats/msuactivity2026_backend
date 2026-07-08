import { getLandingStats, getPublicStats } from '../models/public-stats.model.js';

// GET /api/public/stats?academic_year=  (ตัวเลข พ.ศ. / 'all' / ไม่ส่ง → ทุกปี)
//   academic_year = null → นับทุกปีการศึกษา (default)
export async function publicStats(req, res) {
  const raw = req.query.academic_year;
  let academicYear = null; // ทุกปี
  if (raw !== undefined && raw !== '' && raw !== 'all') {
    const n = Number.parseInt(raw, 10);
    if (Number.isInteger(n) && n >= 2500 && n <= 2700) academicYear = n;
  }
  const stats = await getPublicStats(academicYear);
  res.json({ academic_year: academicYear, ...stats });
}

// landing-specific — all-time totals (WORK+COMPLETED) + breakdown by year/category
export async function landingStats(_req, res) {
  const stats = await getLandingStats();
  res.json(stats);
}
