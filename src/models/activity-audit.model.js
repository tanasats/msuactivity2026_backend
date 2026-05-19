import { query } from '../db/index.js';

// audit actions — เก็บเป็นค่า text (ไม่ใช้ enum เพื่อเพิ่ม action ใหม่ได้ง่าย)
export const ACTIVITY_AUDIT_ACTIONS = Object.freeze({
  // ── lifecycle ของกิจกรรม ─────────────────────────────────────
  CREATE: 'create',                  // สร้างกิจกรรมใหม่ (DRAFT)
  EDIT: 'edit',                      // faculty/admin แก้ไขกิจกรรม (DRAFT mode — full edit)
  EDIT_LIMITED: 'edit_limited',      // faculty creator แก้ไขแบบจำกัด (WORK mode)
  SUBMIT: 'submit',                  // faculty: DRAFT → PENDING
  APPROVE: 'approve',                // admin: PENDING → WORK
  REJECT: 'reject',                  // admin: PENDING → DRAFT
  SET_STATUS: 'set_status',          // super_admin override
  SET_CREATOR: 'set_creator',        // super_admin: transfer ownership
  COMPLETE: 'complete',              // faculty creator: WORK → COMPLETED
  EDIT_ADMIN: 'edit_admin',          // admin edit fields ของกิจกรรม (override)
  BULK_APPROVE: 'bulk_approve',      // bulk approve activity (1 row ต่อกิจกรรม)
  BULK_REJECT: 'bulk_reject',        // bulk reject activity (1 row ต่อกิจกรรม)
  DELETE: 'delete',                  // super_admin: soft-delete (status → DELETED, เก็บ previous_status)
  RESTORE: 'restore',                // super_admin: กู้คืน (DELETED → previous_status)

  // ── registration lifecycle ───────────────────────────────────
  APPROVE_REGISTRATION: 'approve_registration',           // อนุมัติผู้สมัคร 1 คน (faculty)
  CANCEL_REGISTRATION: 'cancel_registration',             // ยกเลิกผู้สมัคร (faculty / admin)
  EVALUATE_REGISTRATION: 'evaluate_registration',         // ประเมินผู้สมัคร 1 คน
  REVERT_EVALUATION: 'revert_evaluation',                 // ยกเลิกผลประเมิน (PASSED/FAILED → PENDING)
  STAFF_CHECK_IN: 'staff_check_in',                       // เจ้าหน้าที่ check-in แทน (single/bulk)
  CANCEL_CHECK_IN: 'cancel_check_in',                     // ยกเลิกการเช็คอิน (revert ATTENDED → REGISTERED)
  BULK_ADD_REGISTRATION: 'bulk_add_registration',         // เพิ่มผู้สมัครทีละหลายคน (faculty/admin)
  BULK_APPROVE_REGISTRATION: 'bulk_approve_registration', // admin อนุมัติผู้สมัครหลายคน
  BULK_EVALUATE_REGISTRATION: 'bulk_evaluate_registration', // ประเมินหลายคน (faculty/admin)
  CHANGE_PARTICIPANT_ROLE: 'change_participant_role',     // เปลี่ยนสถานภาพผู้เข้าร่วม
});

// คำนวณ diff ของ payload — เก็บเฉพาะ field ที่เปลี่ยน
//   ใช้ shallow comparison (JSON.stringify) — สำหรับ field ที่เป็น array/object ก็เปรียบเทียบทั้งก้อน
//   คืน { before, after, changed: string[] } — ถ้าไม่มี change คืน null
export function buildDiff(before, after, fields) {
  const changed = [];
  const beforeDiff = {};
  const afterDiff = {};
  for (const f of fields) {
    const b = before?.[f] ?? null;
    const a = after?.[f] ?? null;
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      changed.push(f);
      beforeDiff[f] = b;
      afterDiff[f] = a;
    }
  }
  if (changed.length === 0) return null;
  return { before: beforeDiff, after: afterDiff, changed };
}

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
