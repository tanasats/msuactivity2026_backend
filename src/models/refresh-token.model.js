import { query } from '../db/index.js';

export async function storeRefreshToken({ jti, user_id, expires_at, user_agent, ip }) {
  await query(
    `INSERT INTO refresh_tokens (jti, user_id, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [jti, user_id, expires_at, user_agent || null, ip || null],
  );
}

export async function findRefreshToken(jti) {
  const { rows } = await query('SELECT * FROM refresh_tokens WHERE jti = $1', [jti]);
  return rows[0] || null;
}

export async function revokeRefreshToken(jti) {
  await query(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE jti = $1 AND revoked_at IS NULL`,
    [jti],
  );
}

export async function revokeAllForUser(user_id) {
  await query(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [user_id],
  );
}
