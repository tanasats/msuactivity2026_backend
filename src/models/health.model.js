import { query } from '../db/index.js';

export async function getDbTime() {
  const { rows } = await query('SELECT NOW() AS now');
  return rows[0].now;
}
