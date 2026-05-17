import {
  approveRegistration,
  bulkAddByMsuIds,
  bulkEvaluateRegistrations,
  bulkUpdateParticipantRole,
  cancelByStaff,
  cancelStaffCheckIn,
  evaluateRegistration,
  findRegistrationWithActivity,
  isValidParticipantRole,
  listByActivity,
  revertEvaluation,
  staffCheckInBulk,
} from '../models/faculty-registration.model.js';
import { findById as findActivity } from '../models/faculty-activity.model.js';
import {
  createActivityAuditLog,
  auditMetaFromReq,
  ACTIVITY_AUDIT_ACTIONS as AUDIT,
} from '../models/activity-audit.model.js';
import {
  createRegistrationAuditLog,
  bulkCreateRegistrationAuditLog,
  REGISTRATION_AUDIT_ACTIONS as RA,
} from '../models/registration-audit.model.js';
import {
  buildParticipantsWorkbook,
  contentDispositionAttachment,
} from '../utils/excel-participants.js';

const EVALUATION_RESULTS = new Set(['PASSED', 'FAILED']);

// scope rules:
//   - "ดูรายชื่อ" = activity ต้องเป็นคณะเดียวกับ requester (faculty_id ตรง)
//   - "approve / cancel" = ต้องเป็นเจ้าของกิจกรรม (created_by = self)
//     เหตุผล: action ที่กระทบ slot/qr_token ควรเป็นเจ้าของกิจกรรมเอง

function err(res, status, message) {
  return res.status(status).json({ status: 'error', message });
}

// GET /api/faculty/activities/:id/registrations
export async function list(req, res) {
  if (!req.user.faculty_id) return err(res, 403, 'บัญชีของท่านยังไม่ถูกผูกกับคณะ');

  const activityId = Number(req.params.id);
  if (!Number.isInteger(activityId) || activityId < 1)
    return err(res, 400, 'invalid activity id');

  const activity = await findActivity(activityId);
  if (!activity) return err(res, 404, 'activity not found');
  if (activity.faculty_id !== req.user.faculty_id)
    return err(res, 403, 'ไม่มีสิทธิ์เข้าถึงกิจกรรมนี้');

  const items = await listByActivity(activityId);
  res.json({
    items,
    can_manage: activity.created_by === req.user.id,
  });
}

// helper: scope check + status precondition สำหรับ approve/cancel
async function ensureMutate(req, res, requiredStatuses) {
  if (!req.user.faculty_id) {
    err(res, 403, 'บัญชีของท่านยังไม่ถูกผูกกับคณะ');
    return null;
  }
  const regId = Number(req.params.regId);
  if (!Number.isInteger(regId) || regId < 1) {
    err(res, 400, 'invalid registration id');
    return null;
  }
  const reg = await findRegistrationWithActivity(regId);
  if (!reg) {
    err(res, 404, 'registration not found');
    return null;
  }
  if (reg.activity_created_by !== req.user.id) {
    err(res, 403, 'จัดการได้เฉพาะกิจกรรมที่ท่านสร้างเอง');
    return null;
  }
  if (!requiredStatuses.includes(reg.status)) {
    err(
      res,
      409,
      `สถานะการสมัคร ${reg.status} ไม่อนุญาตให้ทำรายการนี้`,
    );
    return null;
  }
  return { regId, reg };
}

// POST /api/faculty/activities/:id/registrations/:regId/approve
export async function approve(req, res) {
  const ctx = await ensureMutate(req, res, ['PENDING_APPROVAL']);
  if (!ctx) return;
  const result = await approveRegistration(ctx.regId, req.user.id);
  if (!result) return err(res, 409, 'อนุมัติไม่สำเร็จ');
  await createActivityAuditLog({
    actor_id: req.user.id,
    activity_id: ctx.reg.activity_id,
    action: AUDIT.APPROVE_REGISTRATION,
    after: { registration_id: ctx.regId, user_id: ctx.reg.user_id },
    ...auditMetaFromReq(req),
  });
  await createRegistrationAuditLog({
    actor_id: req.user.id,
    registration_id: ctx.regId,
    action: RA.APPROVE,
    before: { status: 'PENDING_APPROVAL' },
    after: { status: 'REGISTERED' },
    ...auditMetaFromReq(req),
  });
  res.json({ status: 'ok', registration: result });
}

// POST /api/faculty/activities/:id/registrations/:regId/cancel
export async function cancel(req, res) {
  const ctx = await ensureMutate(req, res, [
    'PENDING_APPROVAL',
    'REGISTERED',
  ]);
  if (!ctx) return;
  const reason =
    typeof req.body?.reason === 'string' ? req.body.reason.trim() || null : null;
  const result = await cancelByStaff(ctx.regId, req.user.id, reason);
  if (!result) return err(res, 409, 'ยกเลิกไม่สำเร็จ');
  await createActivityAuditLog({
    actor_id: req.user.id,
    activity_id: ctx.reg.activity_id,
    action: AUDIT.CANCEL_REGISTRATION,
    before: { status: ctx.reg.status },
    after: { registration_id: ctx.regId, user_id: ctx.reg.user_id, reason },
    note: reason,
    ...auditMetaFromReq(req),
  });
  await createRegistrationAuditLog({
    actor_id: req.user.id,
    registration_id: ctx.regId,
    action: RA.CANCEL_BY_STAFF,
    before: { status: ctx.reg.status },
    after: { status: 'CANCELLED_BY_STAFF', reason },
    note: reason,
    ...auditMetaFromReq(req),
  });
  res.json({ status: 'ok', registration: result });
}

// POST /api/faculty/activities/:id/registrations/:regId/evaluate
// body: { result: 'PASSED'|'FAILED', note?: string }
export async function evaluate(req, res) {
  const result = req.body?.result;
  if (!EVALUATION_RESULTS.has(result)) {
    return err(res, 400, 'result ต้องเป็น PASSED หรือ FAILED');
  }

  const noteRaw = req.body?.note;
  const note =
    typeof noteRaw === 'string' && noteRaw.trim().length > 0
      ? noteRaw.trim().slice(0, 1000)
      : null;

  // reuse scope check — แต่อนุญาตเฉพาะ ATTENDED (เช็คใน model)
  const ctx = await ensureMutate(req, res, ['ATTENDED']);
  if (!ctx) return;

  const updated = await evaluateRegistration(
    ctx.regId,
    req.user.id,
    result,
    note,
  );
  if (!updated) return err(res, 409, 'บันทึกผลประเมินไม่สำเร็จ');
  await createActivityAuditLog({
    actor_id: req.user.id,
    activity_id: ctx.reg.activity_id,
    action: AUDIT.EVALUATE_REGISTRATION,
    after: {
      registration_id: ctx.regId,
      user_id: ctx.reg.user_id,
      result,
      note,
    },
    ...auditMetaFromReq(req),
  });
  await createRegistrationAuditLog({
    actor_id: req.user.id,
    registration_id: ctx.regId,
    action: RA.EVALUATE,
    after: { evaluation_status: result, evaluation_note: note },
    note,
    ...auditMetaFromReq(req),
  });
  res.json({ status: 'ok', registration: updated });
}

// POST /api/faculty/activities/:id/registrations/staff-check-in
// body: { registration_ids: number[] }
//   - เจ้าหน้าที่คณะกดเช็คอินแทนนิสิต (single id หรือหลาย id)
//   - bypass window/qr — แต่ต้องเป็นเจ้าของกิจกรรม + activity status='WORK' หรือ 'COMPLETED'
//   - คืน { checked_in: number[], skipped: number[] }
export async function staffCheckIn(req, res) {
  if (!req.user.faculty_id) return err(res, 403, 'บัญชีของท่านยังไม่ถูกผูกกับคณะ');

  const activityId = Number(req.params.id);
  if (!Number.isInteger(activityId) || activityId < 1)
    return err(res, 400, 'invalid activity id');

  const activity = await findActivity(activityId);
  if (!activity) return err(res, 404, 'activity not found');
  if (activity.created_by !== req.user.id)
    return err(res, 403, 'จัดการได้เฉพาะกิจกรรมที่ท่านสร้างเอง');
  if (activity.status !== 'WORK' && activity.status !== 'COMPLETED')
    return err(res, 409, 'กิจกรรมยังไม่อยู่ในสถานะที่เช็คอินได้');

  const rawIds = Array.isArray(req.body?.registration_ids)
    ? req.body.registration_ids
    : null;
  if (!rawIds) return err(res, 400, 'ต้องส่ง registration_ids เป็น array');
  const regIds = [
    ...new Set(
      rawIds
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v > 0),
    ),
  ];
  if (regIds.length === 0) return err(res, 400, 'ไม่มี registration_id ที่ valid');
  if (regIds.length > 500)
    return err(res, 400, 'เช็คอินได้ไม่เกิน 500 รายการต่อครั้ง');

  const out = await staffCheckInBulk({
    activityId,
    registrationIds: regIds,
    staffId: req.user.id,
  });
  if (out.checkedIn.length > 0) {
    await createActivityAuditLog({
      actor_id: req.user.id,
      activity_id: activityId,
      action: AUDIT.STAFF_CHECK_IN,
      after: {
        count: out.checkedIn.length,
        registration_ids: out.checkedIn,
      },
      note: `staff check-in ${out.checkedIn.length} คน`,
      ...auditMetaFromReq(req),
    });
    await bulkCreateRegistrationAuditLog({
      actor_id: req.user.id,
      registration_ids: out.checkedIn,
      action: RA.STAFF_CHECK_IN,
      before: { status: 'REGISTERED' },
      after: { status: 'ATTENDED', method: 'MANUAL_STAFF' },
      ...auditMetaFromReq(req),
    });
  }
  res.json({
    status: 'ok',
    checked_in: out.checkedIn,
    skipped: out.skipped,
  });
}

// POST /api/faculty/activities/:id/registrations/bulk-evaluate
// body: { registration_ids: number[], result: 'PASSED'|'FAILED', note?: string }
export async function bulkEvaluate(req, res) {
  if (!req.user.faculty_id) return err(res, 403, 'บัญชีของท่านยังไม่ถูกผูกกับคณะ');

  const activityId = Number(req.params.id);
  if (!Number.isInteger(activityId) || activityId < 1)
    return err(res, 400, 'invalid activity id');

  const activity = await findActivity(activityId);
  if (!activity) return err(res, 404, 'activity not found');
  if (activity.created_by !== req.user.id)
    return err(res, 403, 'จัดการได้เฉพาะกิจกรรมที่ท่านสร้างเอง');

  const result = req.body?.result;
  if (!EVALUATION_RESULTS.has(result)) {
    return err(res, 400, 'result ต้องเป็น PASSED หรือ FAILED');
  }

  const noteRaw = req.body?.note;
  const note =
    typeof noteRaw === 'string' && noteRaw.trim().length > 0
      ? noteRaw.trim().slice(0, 1000)
      : null;

  const rawIds = Array.isArray(req.body?.registration_ids)
    ? req.body.registration_ids
    : null;
  if (!rawIds) return err(res, 400, 'ต้องส่ง registration_ids เป็น array');
  // dedupe + cast เป็น integer + กรอง invalid
  const regIds = [
    ...new Set(
      rawIds
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v > 0),
    ),
  ];
  if (regIds.length === 0) return err(res, 400, 'ไม่มี registration_id ที่ valid');
  if (regIds.length > 500)
    return err(res, 400, 'ประเมินได้ไม่เกิน 500 รายชื่อต่อครั้ง');

  const out = await bulkEvaluateRegistrations({
    activityId,
    registrationIds: regIds,
    evaluatorId: req.user.id,
    result,
    note,
  });
  if (out.updated.length > 0) {
    await createActivityAuditLog({
      actor_id: req.user.id,
      activity_id: activityId,
      action: AUDIT.BULK_EVALUATE_REGISTRATION,
      after: { result, count: out.updated.length, registration_ids: out.updated },
      note: note ?? `bulk evaluate ${result} ${out.updated.length} คน`,
      ...auditMetaFromReq(req),
    });
    await bulkCreateRegistrationAuditLog({
      actor_id: req.user.id,
      registration_ids: out.updated,
      action: RA.EVALUATE,
      after: { evaluation_status: result, evaluation_note: note },
      note,
      ...auditMetaFromReq(req),
    });
  }
  res.json({ status: 'ok', ...out });
}

// POST /api/faculty/activities/:id/registrations/bulk-add
// body: { msu_ids: string[] }
export async function bulkAdd(req, res) {
  if (!req.user.faculty_id) return err(res, 403, 'บัญชีของท่านยังไม่ถูกผูกกับคณะ');

  const activityId = Number(req.params.id);
  if (!Number.isInteger(activityId) || activityId < 1)
    return err(res, 400, 'invalid activity id');

  const activity = await findActivity(activityId);
  if (!activity) return err(res, 404, 'activity not found');
  if (activity.created_by !== req.user.id)
    return err(res, 403, 'จัดการได้เฉพาะกิจกรรมที่ท่านสร้างเอง');

  // parse + dedupe msu_ids
  const raw = Array.isArray(req.body?.msu_ids) ? req.body.msu_ids : null;
  if (!raw) return err(res, 400, 'ต้องส่ง msu_ids เป็น array');
  const msuIds = [
    ...new Set(
      raw
        .map((v) => String(v).trim())
        .filter((v) => v.length > 0),
    ),
  ];
  if (msuIds.length === 0)
    return err(res, 400, 'ไม่มีรหัสนิสิตให้เพิ่ม');
  if (msuIds.length > 200)
    return err(res, 400, 'เพิ่มได้ไม่เกิน 200 รายชื่อต่อครั้ง');

  const result = await bulkAddByMsuIds(activityId, msuIds, req.user.id);
  if (result.added?.length > 0) {
    await createActivityAuditLog({
      actor_id: req.user.id,
      activity_id: activityId,
      action: AUDIT.BULK_ADD_REGISTRATION,
      after: {
        count: result.added.length,
        msu_ids: result.added.map((r) => r.msu_id),
        registration_ids: result.added.map((r) => r.registration_id),
      },
      note: `bulk add ${result.added.length} คน`,
      ...auditMetaFromReq(req),
    });
    await bulkCreateRegistrationAuditLog({
      actor_id: req.user.id,
      registration_ids: result.added.map((r) => r.registration_id),
      action: RA.STAFF_ADD,
      after: { activity_id: activityId, status: 'REGISTERED' },
      note: `bulk-add by faculty staff`,
      ...auditMetaFromReq(req),
    });
  }
  res.status(201).json({ status: 'ok', ...result });
}

// POST /api/faculty/activities/:id/registrations/bulk-participant-role
// body: { registration_ids: number[], role: 'PARTICIPANT'|'ORGANIZER'|'LEADER' }
//   scope: ผู้สร้างกิจกรรมเท่านั้น
//   logic: bulk set participant_role; skip ของที่ status ไม่ active
export async function bulkParticipantRole(req, res) {
  if (!req.user.faculty_id) return err(res, 403, 'บัญชีของท่านยังไม่ถูกผูกกับคณะ');

  const activityId = Number(req.params.id);
  if (!Number.isInteger(activityId) || activityId < 1)
    return err(res, 400, 'invalid activity id');

  const activity = await findActivity(activityId);
  if (!activity) return err(res, 404, 'activity not found');
  if (activity.created_by !== req.user.id)
    return err(res, 403, 'จัดการได้เฉพาะกิจกรรมที่ท่านสร้างเอง');

  const role = req.body?.role;
  if (!isValidParticipantRole(role)) {
    return err(res, 400, 'role ต้องเป็น PARTICIPANT / ORGANIZER / LEADER');
  }

  const rawIds = Array.isArray(req.body?.registration_ids)
    ? req.body.registration_ids
    : null;
  if (!rawIds) return err(res, 400, 'ต้องส่ง registration_ids เป็น array');
  const regIds = [
    ...new Set(
      rawIds
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v > 0),
    ),
  ];
  if (regIds.length === 0) return err(res, 400, 'ไม่มี registration_id ที่ valid');
  if (regIds.length > 500)
    return err(res, 400, 'เปลี่ยนสถานภาพได้ไม่เกิน 500 รายชื่อต่อครั้ง');

  const out = await bulkUpdateParticipantRole({
    activityId,
    registrationIds: regIds,
    role,
  });

  if (out.updated.length > 0) {
    await createActivityAuditLog({
      actor_id: req.user.id,
      activity_id: activityId,
      action: AUDIT.CHANGE_PARTICIPANT_ROLE,
      after: {
        role,
        count: out.updated.length,
        registration_ids: out.updated,
      },
      note: `set ${role} ให้ ${out.updated.length} คน`,
      ...auditMetaFromReq(req),
    });
    await bulkCreateRegistrationAuditLog({
      actor_id: req.user.id,
      registration_ids: out.updated,
      action: RA.CHANGE_ROLE,
      after: { participant_role: role },
      note: `faculty set role = ${role}`,
      ...auditMetaFromReq(req),
    });
  }

  res.json({ status: 'ok', ...out });
}

// GET /api/faculty/activities/:id/registrations.xlsx
//   ส่งออกรายชื่อผู้สมัครเป็น Excel (.xlsx)
//   scope: ผู้สร้างกิจกรรมเท่านั้น (created_by = self) — เหมือนกับ manage flow อื่น ๆ
//   export ทุก row (ทุก status) — ลูกข่ายค่อย filter ใน Excel ผ่าน auto-filter
export async function exportRegistrationsXlsx(req, res) {
  if (!req.user.faculty_id) return err(res, 403, 'บัญชีของท่านยังไม่ถูกผูกกับคณะ');

  const activityId = Number(req.params.id);
  if (!Number.isInteger(activityId) || activityId < 1)
    return err(res, 400, 'invalid activity id');

  const activity = await findActivity(activityId);
  if (!activity) return err(res, 404, 'activity not found');
  if (activity.created_by !== req.user.id)
    return err(res, 403, 'ส่งออกได้เฉพาะกิจกรรมที่ท่านสร้างเอง');

  const registrations = await listByActivity(activityId);

  const buffer = await buildParticipantsWorkbook({ activity, registrations });

  const stamp = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, ''); // YYYYMMDD
  const safeCode = (activity.code ?? `id${activity.id}`).replace(
    /[^A-Za-z0-9_-]/g,
    '',
  );
  const filename = `${safeCode}_participants_${stamp}.xlsx`;

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', contentDispositionAttachment(filename));
  res.setHeader('Content-Length', buffer.byteLength);
  res.end(Buffer.from(buffer));
}

// POST /api/faculty/activities/:id/registrations/:regId/cancel-check-in
//   body: { reason: string }
//   ยกเลิกการเช็คอิน — ATTENDED → REGISTERED + attendance.status → INVALID
//   scope: ผู้สร้างกิจกรรมเท่านั้น
//   block: ถ้า evaluation_status เป็น PASSED/FAILED แล้ว (กระทบชั่วโมง/cert)
export async function cancelCheckIn(req, res) {
  // ยอมรับ ATTENDED เท่านั้นใน ensureMutate (model ตรวจ evaluation_status ซ้ำอีกชั้น)
  const ctx = await ensureMutate(req, res, ['ATTENDED']);
  if (!ctx) return;

  const reasonRaw = req.body?.reason;
  if (typeof reasonRaw !== 'string' || reasonRaw.trim().length === 0) {
    return err(res, 400, 'ต้องระบุเหตุผลในการยกเลิกเช็คอิน');
  }
  const reason = reasonRaw.trim().slice(0, 500);

  const result = await cancelStaffCheckIn(ctx.regId);
  if (!result.ok) {
    if (result.reason === 'ALREADY_EVALUATED') {
      return err(
        res,
        409,
        `ประเมินแล้ว (${result.evaluationStatus}) — ยกเลิกเช็คอินไม่ได้ ต้องยกเลิกผลประเมินก่อน`,
      );
    }
    if (result.reason === 'STATUS_MISMATCH') {
      return err(
        res,
        409,
        `สถานะ ${result.currentStatus} ไม่อนุญาตให้ยกเลิกเช็คอิน`,
      );
    }
    return err(res, 404, 'registration not found');
  }

  await createActivityAuditLog({
    actor_id: req.user.id,
    activity_id: ctx.reg.activity_id,
    action: AUDIT.CANCEL_CHECK_IN,
    before: { status: 'ATTENDED', evaluation_status: result.before.evaluation_status },
    after: { status: 'REGISTERED', registration_id: ctx.regId },
    note: reason,
    ...auditMetaFromReq(req),
  });
  await createRegistrationAuditLog({
    actor_id: req.user.id,
    registration_id: ctx.regId,
    action: RA.CANCEL_CHECK_IN,
    before: { status: 'ATTENDED', evaluation_status: result.before.evaluation_status },
    after: { status: 'REGISTERED' },
    note: reason,
    ...auditMetaFromReq(req),
  });

  res.json({ status: 'ok', registration_id: ctx.regId });
}

// POST /api/faculty/activities/:id/registrations/:regId/revert-evaluation
//   body: { reason?: string } — optional, อธิบายเหตุผล
//   ยกเลิกผลประเมิน — PASSED/FAILED → PENDING_EVALUATION + ล้าง evaluated_at/by/note
//   scope: ผู้สร้างกิจกรรมเท่านั้น
//   precondition (ทั้งใน controller + model): status=ATTENDED + eval=PASSED|FAILED
//
//   ใช้กรณี: ประเมินผิด, อยากเปลี่ยนใจก่อนตัดสินใจ final, แก้ bulk-evaluate ที่ผิดกลุ่ม
//   หลัง revert: กลับไปประเมินใหม่ได้ + ยกเลิกเช็คอินก็ได้
export async function revertEvalRegistration(req, res) {
  const ctx = await ensureMutate(req, res, ['ATTENDED']);
  if (!ctx) return;

  const noteRaw = req.body?.reason;
  const reason =
    typeof noteRaw === 'string' && noteRaw.trim().length > 0
      ? noteRaw.trim().slice(0, 500)
      : null;

  const updated = await revertEvaluation(ctx.regId);
  if (!updated) {
    return err(
      res,
      409,
      `สถานะปัจจุบันไม่อนุญาตให้ยกเลิกผลประเมิน (ต้องประเมินแล้วเป็น PASSED/FAILED)`,
    );
  }

  const previousEval = ctx.reg.evaluation_status; // PASSED หรือ FAILED
  await createActivityAuditLog({
    actor_id: req.user.id,
    activity_id: ctx.reg.activity_id,
    action: AUDIT.REVERT_EVALUATION,
    before: { evaluation_status: previousEval },
    after: {
      registration_id: ctx.regId,
      user_id: ctx.reg.user_id,
      evaluation_status: 'PENDING_EVALUATION',
    },
    note: reason,
    ...auditMetaFromReq(req),
  });
  await createRegistrationAuditLog({
    actor_id: req.user.id,
    registration_id: ctx.regId,
    action: RA.REVERT_EVALUATION,
    before: { evaluation_status: previousEval },
    after: { evaluation_status: 'PENDING_EVALUATION' },
    note: reason,
    ...auditMetaFromReq(req),
  });

  res.json({ status: 'ok', registration: updated });
}
