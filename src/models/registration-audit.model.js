import { query } from '../db/index.js';

// ── registration_audit_logs model ────────────────────────────────
//   per-registration mutation log — แยกจาก activity_audit_logs (per-activity)
//   ทุก state transition ของ registration จะ insert 1 row ใน table นี้
//   (bulk ops insert N rows + 1 summary row ใน activity_audit_logs)

export const REGISTRATION_AUDIT_ACTIONS = Object.freeze({
  // ── เหตุการณ์เริ่มต้น ───────────────────────────────────────
  REGISTER: 'register',                 // student self-register (POST /student/registrations)
  STAFF_ADD: 'staff_add',               // faculty/admin เพิ่มผู้สมัครตรง (bulk-add)

  // ── approval flow ──────────────────────────────────────────
  APPROVE: 'approve',                   // PENDING_APPROVAL → REGISTERED (faculty/admin)
  REJECT: 'reject',                     // PENDING → REJECTED_BY_STAFF (reserved — ยังไม่ใช้)

  // ── cancellation ───────────────────────────────────────────
  CANCEL_BY_USER: 'cancel_by_user',     // student self-cancel (PENDING เท่านั้น)
  CANCEL_BY_STAFF: 'cancel_by_staff',   // faculty/admin cancel (PENDING หรือ REGISTERED)

  // ── attendance ─────────────────────────────────────────────
  CHECK_IN: 'check_in',                 // student self check-in (QR/selfie) — actor = student
  STAFF_CHECK_IN: 'staff_check_in',     // staff manual check-in แทนนิสิต — actor = staff
  NO_SHOW: 'no_show',                   // (reserved — ยังไม่ implement) mark no-show

  // ── post-attendance ────────────────────────────────────────
  EVALUATE: 'evaluate',                 // PASSED / FAILED — note บอกผล
  CHANGE_ROLE: 'change_role',           // เปลี่ยน participant_role
});

// helper: extract ip + user-agent จาก req (เหมือน activity-audit)
export function auditMetaFromReq(req) {
  return {
    ip: req.ip ?? null,
    user_agent: req.get?.('user-agent') ?? null,
  };
}

// บันทึก 1 row — ใช้กับ single mutation (approve, cancel, evaluate, register, ...)
export async function createRegistrationAuditLog({
  actor_id,
  registration_id,
  action,
  before = null,
  after = null,
  note = null,
  ip = null,
  user_agent = null,
}) {
  await query(
    `INSERT INTO registration_audit_logs
       (actor_id, registration_id, action, before, after, note, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      actor_id,
      registration_id,
      action,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      note,
      ip,
      user_agent,
    ],
  );
}

// บันทึกหลาย row พร้อมกัน — ใช้กับ bulk ops (bulk-approve / bulk-evaluate / etc.)
//   registrationIds: number[]  → insert N rows ที่ action/note/before/after เดียวกัน
//   ใช้ UNNEST เพื่อ batch insert ใน statement เดียว (เร็ว + atomic)
export async function bulkCreateRegistrationAuditLog({
  actor_id,
  registration_ids,
  action,
  before = null,
  after = null,
  note = null,
  ip = null,
  user_agent = null,
}) {
  if (!registration_ids || registration_ids.length === 0) return;
  await query(
    `INSERT INTO registration_audit_logs
       (actor_id, registration_id, action, before, after, note, ip, user_agent)
     SELECT $1, regid, $3, $4, $5, $6, $7, $8
       FROM UNNEST($2::int[]) AS regid`,
    [
      actor_id,
      registration_ids,
      action,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      note,
      ip,
      user_agent,
    ],
  );
}

// list audit ของ registration เดียว — JOIN users เพื่อโชว์ actor info
//   (สำหรับ Phase ถัดไป — UI viewer)
export async function listAuditForRegistration(registrationId, { limit = 200 } = {}) {
  const { rows } = await query(
    `SELECT
       l.id, l.action, l.before, l.after, l.note, l.ip, l.user_agent, l.created_at,
       l.actor_id,
       u.full_name AS actor_name,
       u.email     AS actor_email,
       u.role      AS actor_role
     FROM registration_audit_logs l
     JOIN users u ON u.id = l.actor_id
     WHERE l.registration_id = $1
     ORDER BY l.created_at ASC, l.id ASC
     LIMIT $2`,
    [registrationId, limit],
  );
  return rows;
}
