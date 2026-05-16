import {
  bulkAddByMsuIds,
  bulkApproveRegistrations,
  bulkEvaluateRegistrations,
  bulkUpdateParticipantRole,
  isValidParticipantRole,
  resolveMsuIdsToRegistrationIds,
  staffCheckInBulk,
} from '../models/faculty-registration.model.js';
import { findById as findActivity } from '../models/faculty-activity.model.js';
import {
  createActivityAuditLog,
  auditMetaFromReq,
  ACTIVITY_AUDIT_ACTIONS as AUDIT,
} from '../models/activity-audit.model.js';
import {
  bulkCreateRegistrationAuditLog,
  REGISTRATION_AUDIT_ACTIONS as RA,
} from '../models/registration-audit.model.js';

// admin/super_admin จัดการผู้สมัครได้ทุกกิจกรรม (cross-faculty)
//   - ไม่มี faculty scope check + ไม่ต้อง created_by ของกิจกรรม
//   - รับ msu_ids (text) — แปลงเป็น registration_id ภายในก่อนทำ
//   - bulk-add: msu_ids → register (REGISTERED ทันที, แบบเดียวกับ faculty.bulkAdd)
//   - bulk-approve: msu_ids → resolve เฉพาะ PENDING_APPROVAL → approve
//   - bulk-evaluate: msu_ids → resolve เฉพาะ ATTENDED → evaluate
//
// audit: ทุก action บันทึกใน activity_audit_logs

const EVALUATION_RESULTS = new Set(['PASSED', 'FAILED']);
const MAX_BULK = 500;

function err(res, status, message) {
  return res.status(status).json({ status: 'error', message });
}

// helper: parse + dedupe + cap msu_ids
function parseMsuIds(raw, max = MAX_BULK) {
  if (!Array.isArray(raw)) return { error: 'ต้องส่ง msu_ids เป็น array' };
  const cleaned = [
    ...new Set(
      raw
        .map((v) => String(v).trim())
        .filter((v) => v.length > 0),
    ),
  ];
  if (cleaned.length === 0) return { error: 'ไม่มีรหัสนิสิตให้ดำเนินการ' };
  if (cleaned.length > max)
    return { error: `เกินจำนวนสูงสุด ${max} รายการต่อครั้ง` };
  return { msuIds: cleaned };
}

async function loadActivity(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    err(res, 400, 'invalid activity id');
    return null;
  }
  const a = await findActivity(id);
  if (!a) {
    err(res, 404, 'activity not found');
    return null;
  }
  return a;
}

// POST /api/admin/activities/:id/registrations/bulk-add
//   body: { msu_ids: string[] }
export async function bulkAdd(req, res) {
  const activity = await loadActivity(req, res);
  if (!activity) return;

  const parsed = parseMsuIds(req.body?.msu_ids, 200);
  if (parsed.error) return err(res, 400, parsed.error);

  const result = await bulkAddByMsuIds(
    activity.id,
    parsed.msuIds,
    req.user.id,
  );

  if (result.added.length > 0) {
    await createActivityAuditLog({
      actor_id: req.user.id,
      activity_id: activity.id,
      action: AUDIT.BULK_ADD_REGISTRATION,
      after: {
        added_count: result.added.length,
        msu_ids: result.added.map((a) => a.msu_id),
      },
      note: `admin-add ${result.added.length} คน (skip ${result.errors.length})`,
      ...auditMetaFromReq(req),
    });
    await bulkCreateRegistrationAuditLog({
      actor_id: req.user.id,
      registration_ids: result.added.map((a) => a.registration_id),
      action: RA.STAFF_ADD,
      after: { activity_id: activity.id, status: 'REGISTERED' },
      note: 'admin bulk-add',
      ...auditMetaFromReq(req),
    });
  }

  res.status(201).json({ status: 'ok', ...result });
}

// POST /api/admin/activities/:id/registrations/bulk-approve
//   body: { msu_ids: string[] }
export async function bulkApprove(req, res) {
  const activity = await loadActivity(req, res);
  if (!activity) return;

  const parsed = parseMsuIds(req.body?.msu_ids);
  if (parsed.error) return err(res, 400, parsed.error);

  const resolved = await resolveMsuIdsToRegistrationIds(
    activity.id,
    parsed.msuIds,
    ['PENDING_APPROVAL'],
  );
  if (resolved.resolved.length === 0) {
    return res.json({
      status: 'ok',
      approved: [],
      skipped: [],
      errors: resolved.errors,
    });
  }

  const out = await bulkApproveRegistrations({
    activityId: activity.id,
    registrationIds: resolved.resolved.map((r) => r.registration_id),
    approverId: req.user.id,
  });

  // map msu_id back to result
  const idToMsuId = new Map(
    resolved.resolved.map((r) => [r.registration_id, r.msu_id]),
  );
  const approved = out.approved.map((row) => ({
    msu_id: idToMsuId.get(row.registration_id),
    registration_id: row.registration_id,
    qr_token: row.qr_token,
  }));

  if (approved.length > 0) {
    await createActivityAuditLog({
      actor_id: req.user.id,
      activity_id: activity.id,
      action: AUDIT.BULK_APPROVE_REGISTRATION,
      after: {
        approved_count: approved.length,
        msu_ids: approved.map((a) => a.msu_id),
      },
      note: `admin-approve ${approved.length} คน`,
      ...auditMetaFromReq(req),
    });
    await bulkCreateRegistrationAuditLog({
      actor_id: req.user.id,
      registration_ids: approved.map((a) => a.registration_id),
      action: RA.APPROVE,
      before: { status: 'PENDING_APPROVAL' },
      after: { status: 'REGISTERED' },
      note: 'admin bulk-approve',
      ...auditMetaFromReq(req),
    });
  }

  res.json({
    status: 'ok',
    approved,
    skipped: out.skipped,
    errors: resolved.errors,
  });
}

// POST /api/admin/activities/:id/registrations/bulk-evaluate
//   body: { msu_ids: string[], result: 'PASSED'|'FAILED', note?: string }
export async function bulkEvaluate(req, res) {
  const activity = await loadActivity(req, res);
  if (!activity) return;

  const result = req.body?.result;
  if (!EVALUATION_RESULTS.has(result)) {
    return err(res, 400, 'result ต้องเป็น PASSED หรือ FAILED');
  }
  const noteRaw = req.body?.note;
  const note =
    typeof noteRaw === 'string' && noteRaw.trim().length > 0
      ? noteRaw.trim().slice(0, 1000)
      : null;

  const parsed = parseMsuIds(req.body?.msu_ids);
  if (parsed.error) return err(res, 400, parsed.error);

  const resolved = await resolveMsuIdsToRegistrationIds(
    activity.id,
    parsed.msuIds,
    ['ATTENDED'],
  );
  if (resolved.resolved.length === 0) {
    return res.json({
      status: 'ok',
      evaluated: [],
      skipped: [],
      errors: resolved.errors,
    });
  }

  const out = await bulkEvaluateRegistrations({
    activityId: activity.id,
    registrationIds: resolved.resolved.map((r) => r.registration_id),
    evaluatorId: req.user.id,
    result,
    note,
  });

  const idToMsuId = new Map(
    resolved.resolved.map((r) => [r.registration_id, r.msu_id]),
  );
  // model คืน { updated, skipped } — map กลับเป็น msu_id ที่ระบุได้
  const evaluated = (out.updated ?? []).map((id) => ({
    msu_id: idToMsuId.get(id),
    registration_id: id,
  }));

  if (evaluated.length > 0) {
    await createActivityAuditLog({
      actor_id: req.user.id,
      activity_id: activity.id,
      action: AUDIT.BULK_EVALUATE_REGISTRATION,
      after: {
        evaluated_count: evaluated.length,
        result,
        msu_ids: evaluated.map((e) => e.msu_id),
      },
      note: `admin-evaluate ${result} ${evaluated.length} คน${note ? ` — ${note}` : ''}`,
      ...auditMetaFromReq(req),
    });
    await bulkCreateRegistrationAuditLog({
      actor_id: req.user.id,
      registration_ids: evaluated.map((e) => e.registration_id),
      action: RA.EVALUATE,
      after: { evaluation_status: result, evaluation_note: note },
      note: note ?? `admin bulk-evaluate ${result}`,
      ...auditMetaFromReq(req),
    });
  }

  res.json({
    status: 'ok',
    evaluated,
    skipped: out.skipped ?? [],
    errors: resolved.errors,
  });
}

// POST /api/admin/activities/:id/registrations/bulk-participant-role
//   body: { msu_ids: string[], role: 'PARTICIPANT'|'ORGANIZER'|'LEADER' }
//   admin + super_admin (cross-faculty); ใช้ msu_ids แทน registration_ids
export async function bulkParticipantRole(req, res) {
  const activity = await loadActivity(req, res);
  if (!activity) return;

  const role = req.body?.role;
  if (!isValidParticipantRole(role)) {
    return err(res, 400, 'role ต้องเป็น PARTICIPANT / ORGANIZER / LEADER');
  }

  const parsed = parseMsuIds(req.body?.msu_ids);
  if (parsed.error) return err(res, 400, parsed.error);

  // resolve msu_ids → registration_ids (allow active statuses)
  const resolved = await resolveMsuIdsToRegistrationIds(
    activity.id,
    parsed.msuIds,
    ['PENDING_APPROVAL', 'REGISTERED', 'ATTENDED', 'NO_SHOW'],
  );
  if (resolved.resolved.length === 0) {
    return res.json({
      status: 'ok',
      updated: [],
      skipped: [],
      errors: resolved.errors,
    });
  }

  const out = await bulkUpdateParticipantRole({
    activityId: activity.id,
    registrationIds: resolved.resolved.map((r) => r.registration_id),
    role,
  });

  const idToMsuId = new Map(
    resolved.resolved.map((r) => [r.registration_id, r.msu_id]),
  );
  const updated = out.updated.map((id) => ({
    msu_id: idToMsuId.get(id),
    registration_id: id,
  }));

  if (updated.length > 0) {
    await createActivityAuditLog({
      actor_id: req.user.id,
      activity_id: activity.id,
      action: AUDIT.CHANGE_PARTICIPANT_ROLE,
      after: {
        role,
        count: updated.length,
        msu_ids: updated.map((u) => u.msu_id),
      },
      note: `admin set ${role} ให้ ${updated.length} คน`,
      ...auditMetaFromReq(req),
    });
    await bulkCreateRegistrationAuditLog({
      actor_id: req.user.id,
      registration_ids: updated.map((u) => u.registration_id),
      action: RA.CHANGE_ROLE,
      after: { participant_role: role },
      note: `admin set role = ${role}`,
      ...auditMetaFromReq(req),
    });
  }

  res.json({
    status: 'ok',
    updated,
    skipped: out.skipped,
    errors: resolved.errors,
  });
}

// POST /api/admin/activities/:id/registrations/bulk-check-in
//   body: { msu_ids: string[] }
//   super_admin only — เพิ่มรายชื่อ check-in (REGISTERED → ATTENDED)
//   bypass QR/window — เป็น override สำหรับกรณีที่นิสิตเช็คอินไม่ได้ด้วยตัวเอง
//   activity ต้องอยู่ใน WORK หรือ COMPLETED
//   ใช้ staffCheckInBulk (เดิม) ผ่านการ resolve msu_ids → registration_ids ก่อน
export async function bulkCheckIn(req, res) {
  const activity = await loadActivity(req, res);
  if (!activity) return;

  if (activity.status !== 'WORK' && activity.status !== 'COMPLETED') {
    return err(res, 409, 'กิจกรรมยังไม่อยู่ในสถานะที่เช็คอินได้ (ต้อง WORK/COMPLETED)');
  }

  const parsed = parseMsuIds(req.body?.msu_ids);
  if (parsed.error) return err(res, 400, parsed.error);

  const resolved = await resolveMsuIdsToRegistrationIds(
    activity.id,
    parsed.msuIds,
    ['REGISTERED'],
  );
  if (resolved.resolved.length === 0) {
    return res.json({
      status: 'ok',
      checked_in: [],
      skipped: [],
      errors: resolved.errors,
    });
  }

  const out = await staffCheckInBulk({
    activityId: activity.id,
    registrationIds: resolved.resolved.map((r) => r.registration_id),
    staffId: req.user.id,
  });

  // map registration_id → msu_id เพื่อให้ frontend แสดงผลตามรหัสนิสิต
  const idToMsuId = new Map(
    resolved.resolved.map((r) => [r.registration_id, r.msu_id]),
  );
  const checkedIn = out.checkedIn.map((id) => ({
    msu_id: idToMsuId.get(id),
    registration_id: id,
  }));

  if (checkedIn.length > 0) {
    await createActivityAuditLog({
      actor_id: req.user.id,
      activity_id: activity.id,
      action: AUDIT.STAFF_CHECK_IN,
      after: {
        count: checkedIn.length,
        msu_ids: checkedIn.map((c) => c.msu_id),
        registration_ids: checkedIn.map((c) => c.registration_id),
      },
      note: `admin check-in ${checkedIn.length} คน`,
      ...auditMetaFromReq(req),
    });
    await bulkCreateRegistrationAuditLog({
      actor_id: req.user.id,
      registration_ids: checkedIn.map((c) => c.registration_id),
      action: RA.STAFF_CHECK_IN,
      before: { status: 'REGISTERED' },
      after: { status: 'ATTENDED', method: 'MANUAL_STAFF' },
      note: 'admin bulk check-in',
      ...auditMetaFromReq(req),
    });
  }

  res.json({
    status: 'ok',
    checked_in: checkedIn,
    skipped: out.skipped,
    errors: resolved.errors,
  });
}
