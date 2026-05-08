import { getCurrentAcademicYearBE } from '../utils/academic-year.js';
import { getPublicStats } from '../models/public-stats.model.js';

export async function publicStats(_req, res) {
  const academicYear = getCurrentAcademicYearBE();
  const stats = await getPublicStats(academicYear);
  res.json({ academic_year: academicYear, ...stats });
}
