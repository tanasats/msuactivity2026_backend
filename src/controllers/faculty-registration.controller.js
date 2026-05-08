import {
  approveRegistration,
  bulkAddByMsuIds,
  bulkEvaluateRegistrations,
  cancelByStaff,
  evaluateRegistration,
  findRegistrationWithActivity,
  listByActivity,
  staffCheckInBulk,
} from '../models/faculty-registration.model.js';
import { findById as findActivity } from '../models/faculty-activity.model.js';

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
  res.status(201).json({ status: 'ok', ...result });
}
