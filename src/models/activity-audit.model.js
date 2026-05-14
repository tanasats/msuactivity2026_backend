import { query } from '../db/index.js';

// audit actions — เก็บเป็นค่า text (ไม่ใช้ enum เพื่อเพิ่ม action ใหม่ได้ง่าย)
export const ACTIVITY_AUDIT_ACTIONS = Object.freeze({
  SUBMIT: 'submit',                  // faculty: DRAFT → PENDING
  APPROVE: 'approve',                // admin: PENDING → WORK
  REJECT: 'reject',                  // admin: PENDING → DRAFT
  SET_STATUS: 'set_status',          // super_admin override
  SET_CREATOR: 'set_creator',        // super_admin: transfer ownership
  COMPLETE: 'complete',              // faculty creator: WORK → COMPLETED
  CANCEL_REGISTRATION: 'cancel_registration', // admin cancel ผู้สมัคร
  EDIT_ADMIN: 'edit_admin',          // admin edit fields ของกิจกรรม
  BULK_APPROVE: 'bulk_approve',      // bulk approve activity (1 row ต่อกิจกรรม)
  BULK_REJECT: 'bulk_reject',        // bulk reject activity (1 row ต่อกิจกรรม)
  BULK_ADD_REGISTRATION: 'bulk_add_registration',     // admin เพิ่มผู้สมัครทีละหลายคน
  BULK_APPROVE_REGISTRATION: 'bulk_approve_registration', // admin อนุมัติผู้สมัครหลายคน
  BULK_EVALUATE_REGISTRATION: 'bulk_evaluate_registration', // admin ประเมินหลายคน
});

// บันทึก audit log — เรียกหลังจาก mutation สำเร็จ
//   ทุก field optional ยกเว้น actor_id / activity_id / action
//   before/after: JS object → stringify เป็น jsonb
export async function createActivityAuditLog({
  actor_id,
  activity_id,
  action,
  before = null,
  after = null,
  note = null,
  ip = null,
  user_agent = null,
}) {
  await query(
    `INSERT INTO activity_audit_logs
       (actor_id, activity_id, action, before, after, note, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      actor_id,
      activity_id,
      action,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      note,
      ip,
      user_agent,
    ],
  );
}

// list audit ของกิจกรรม — JOIN users เพื่อโชว์ชื่อ actor
export async function listAuditForActivity(activityId, { limit = 200 } = {}) {
  const { rows } = await query(
    `SELECT
       l.id,
       l.action,
       l.before,
       l.after,
       l.note,
       l.ip,
       l.user_agent,
       l.created_at,
       l.actor_id,
       u.full_name AS actor_name,
       u.email     AS actor_email,
       u.role      AS actor_role
     FROM activity_audit_logs l
     JOIN users u ON u.id = l.actor_id
     WHERE l.activity_id = $1
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT $2`,
    [activityId, limit],
  );
  return rows;
}

// helper สำหรับ controller — extract ip + user-agent จาก req
export function auditMetaFromReq(req) {
  return {
    ip: req.ip ?? null,
    user_agent: req.get('user-agent') ?? null,
  };
}
