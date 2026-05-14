import { query } from '../db/index.js';

// master_data_audit_logs — กลางของระบบ (Phase 2)
//   target_type = ตารางอะไร (organization / category / skill / faculty / system_setting / announcement)
//   target_id   = id ของแถว (NULL ได้สำหรับ system_setting)
//   target_key  = denormalized identifier (system_setting.key, skill.code) — อ่าน history ง่าย

export const MASTER_AUDIT_TARGETS = Object.freeze({
  ORGANIZATION: 'organization',
  CATEGORY: 'category',
  SKILL: 'skill',
  FACULTY: 'faculty',
  SYSTEM_SETTING: 'system_setting',
  ANNOUNCEMENT: 'announcement',
});

export const MASTER_AUDIT_ACTIONS = Object.freeze({
  CREATE: 'create',
  UPDATE: 'update',
  SOFT_DELETE: 'soft_delete',   // is_active=true → false (deactivate)
  RESTORE: 'restore',           // is_active=false → true (reactivate)
  DELETE: 'delete',             // hard delete (เฉพาะ announcement)
});

// ส่ง before/after เป็น JS object — null → ไม่บันทึก
export async function createMasterDataAuditLog({
  actor_id,
  target_type,
  target_id = null,
  target_key = null,
  action,
  before = null,
  after = null,
  note = null,
  ip = null,
  user_agent = null,
}) {
  await query(
    `INSERT INTO master_data_audit_logs
       (actor_id, target_type, target_id, target_key, action, before, after, note, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      actor_id,
      target_type,
      target_id,
      target_key,
      action,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      note,
      ip,
      user_agent,
    ],
  );
}

// list history แบบยืดหยุ่น — ใช้ทั้ง drill-down (target เฉพาะ) และ central viewer (รายการรวม)
//   target* + action + actorId เป็น filter optional (null = ไม่กรอง)
//   คืน { items, total } เพื่อให้ UI ทำ pagination ได้
export async function listMasterDataAudit({
  targetType = null,
  targetId = null,
  targetKey = null,
  action = null,
  actorId = null,
  limit = 50,
  offset = 0,
} = {}) {
  const where = [];
  const params = [];

  if (targetType !== null) {
    params.push(targetType);
    where.push(`l.target_type = $${params.length}`);
  }
  if (targetId !== null) {
    params.push(targetId);
    where.push(`l.target_id = $${params.length}`);
  }
  if (targetKey !== null) {
    params.push(targetKey);
    where.push(`l.target_key = $${params.length}`);
  }
  if (action !== null) {
    params.push(action);
    where.push(`l.action = $${params.length}`);
  }
  if (actorId !== null) {
    params.push(actorId);
    where.push(`l.actor_id = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // total ก่อน เพื่อ UI แสดงจำนวนรวม
  const totalRes = await query(
    `SELECT COUNT(*)::int AS total FROM master_data_audit_logs l ${whereSql}`,
    params,
  );

  params.push(limit, offset);
  const { rows } = await query(
    `SELECT
       l.id, l.action, l.target_type, l.target_id, l.target_key,
       l.before, l.after, l.note, l.ip, l.user_agent, l.created_at,
       l.actor_id,
       u.full_name AS actor_name,
       u.email     AS actor_email,
       u.role      AS actor_role
     FROM master_data_audit_logs l
     JOIN users u ON u.id = l.actor_id
     ${whereSql}
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows, total: totalRes.rows[0].total };
}
