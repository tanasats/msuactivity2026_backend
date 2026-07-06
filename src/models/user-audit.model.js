import { query } from '../db/index.js';

export const AUDIT_ACTIONS = Object.freeze({
  ROLE_CHANGE: 'role_change',
  FACULTY_CHANGE: 'faculty_change',
  STATUS_CHANGE: 'status_change',
  MESSAGE_SENT: 'message_sent',
});

// batch audit — บันทึก "admin ส่งข้อความถึงผู้ใช้หลายคน" ทีเดียว (1 แถว/ผู้รับ)
//   after = { title, channels } เก็บ snapshot ว่าส่งอะไร
export async function logMessagesSent(actorId, targetUserIds, after, { ip = null, user_agent = null } = {}) {
  if (!targetUserIds?.length) return 0;
  const afterJson = JSON.stringify(after ?? {});
  const values = [];
  const params = [actorId, AUDIT_ACTIONS.MESSAGE_SENT, afterJson, ip, user_agent];
  targetUserIds.forEach((uid, i) => {
    params.push(uid);
    values.push(`($1, $${params.length}, $2, $3, $4, $5)`);
  });
  const { rowCount } = await query(
    `INSERT INTO user_audit_logs (actor_id, target_user_id, action, after, ip, user_agent)
     VALUES ${values.join(', ')}`,
    params,
  );
  return rowCount;
}

export async function createAuditLog({
  actor_id,
  target_user_id,
  action,
  before = null,
  after = null,
  ip = null,
  user_agent = null,
}) {
  const { rows } = await query(
    `INSERT INTO user_audit_logs
       (actor_id, target_user_id, action, before, after, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      actor_id,
      target_user_id,
      action,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      ip,
      user_agent,
    ],
  );
  return rows[0];
}

// list ตาม target user — ใช้แสดง timeline บน user detail
export async function listForTargetUser(targetUserId, { limit = 50 } = {}) {
  const { rows } = await query(
    `SELECT
       l.id,
       l.action,
       l.before,
       l.after,
       l.ip,
       l.user_agent,
       l.created_at,
       l.actor_id,
       a.full_name AS actor_name,
       a.email     AS actor_email
     FROM user_audit_logs l
     JOIN users a ON a.id = l.actor_id
     WHERE l.target_user_id = $1
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT $2`,
    [targetUserId, limit],
  );
  return rows;
}
