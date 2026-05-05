import { getDbTime } from '../models/health.model.js';

export async function checkHealth(_req, res) {
  const now = await getDbTime();
  res.json({ status: 'ok', db: now });
}
