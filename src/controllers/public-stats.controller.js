import { getCurrentAcademicYearBE } from '../utils/academic-year.js';
import { getLandingStats, getPublicStats } from '../models/public-stats.model.js';

export async function publicStats(_req, res) {
  const academicYear = getCurrentAcademicYearBE();
  const stats = await getPublicStats(academicYear);
  res.json({ academic_year: academicYear, ...stats });
}

// landing-specific — all-time totals (WORK+COMPLETED) + breakdown by year/category
export async function landingStats(_req, res) {
  const stats = await getLandingStats();
  res.json(stats);
}
