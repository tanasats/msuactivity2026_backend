import * as activities from '../models/admin-activity.model.js';
import {
  createActivityAuditLog,
  auditMetaFromReq,
  listAuditForActivity,
  ACTIVITY_AUDIT_ACTIONS as AUDIT,
} from '../models/activity-audit.model.js';
import { getPresignedGetUrl } from '../utils/s3.js';
import { getCurrentAcademicYearBE } from '../utils/academic-year.js';

const ALLOWED_STATUSES = new Set([
  'DRAFT',
  'PENDING_APPROVAL',
  'WORK',
  'COMPLETED',
]);
const ALLOWED_SORTS = new Set([
  'updated_desc',
  'updated_asc',
  'start_asc',
  'start_desc',
  'title_asc',
  'title_desc',
]);

function err(res, status, message) {
  return res.status(status).json({ status: 'error', message });
}

function parseAcademicYear(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 2500 || n > 2700) return null;
  return n;
}

function parsePosInt(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

// แปะ presigned URL บน poster + documents (เหมือน faculty controller)
async function decoratePoster(activity) {
  if (activity?.poster?.storage_key) {
    activity.poster_url = await getPresignedGetUrl(activity.poster.storage_key);
  } else {
    activity.poster_url = null;
  }
  if (Array.isArray(activity?.documents)) {
    activity.documents = await Promise.all(
      activity.documents.map(async (d) => ({
        ...d,
        url: await getPresignedGetUrl(d.storage_key),
      })),
    );
  }
  return activity;
}

// GET /api/admin/stats?academic_year=
export async function stats(req, res) {
  const academicYear = parseAcademicYear(req.query.academic_year);
  const counts = await activities.countAllByStatus(academicYear);
  res.json({ counts, academic_year: academicYear });
}

// GET /api/admin/academic-years
//   default_year = max ของปีที่ระบบมี activity (กันเคสปีปัจจุบันยังไม่มีกิจกรรม
//                  แต่มีในปีอื่น → admin overview ขึ้น empty)
export async function academicYears(req, res) {
  const current = getCurrentAcademicYearBE();
  const fromDb = await activities.listAllAcademicYears();
  const default_year = fromDb.length > 0 ? fromDb[0] : current;
  const set = new Set(fromDb);
  set.add(current);
  const available = [...set].sort((a, b) => b - a);
  res.json({ current, default_year, available });
}

// GET /api/admin/activities?status=&faculty_id=&academic_year=&search=&limit=&offset=
export async function list(req, res) {
  const status = req.query.status || null;
  if (status && !ALLOWED_STATUSES.has(status))
    return err(res, 400, 'invalid status');

  const facultyId = parsePosInt(req.query.faculty_id);
  const academicYear = parseAcademicYear(req.query.academic_year);
  const search =
    typeof req.query.search === 'string' && req.query.search.trim().length > 0
      ? req.query.search.trim().slice(0, 200)
      : null;

  let limit = Number.parseInt(req.query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = 50;
  if (limit > 250) limit = 250;

  let offset = Number.parseInt(req.query.offset, 10);
  if (!Number.isInteger(offset) || offset < 0) offset = 0;

  const sort = ALLOWED_SORTS.has(req.query.sort) ? req.query.sort : 'updated_desc';

  const out = await activities.listAll({
    status,
    facultyId,
    academicYear,
    search,
    sort,
    limit,
    offset,
  });

  res.json({
    items: out.items,
    total: out.total,
    limit,
    offset,
    sort,
    filters: { status, faculty_id: facultyId, academic_year: academicYear, search },
  });
}

// GET /api/admin/activities/:id/audit
//   timeline ของการเปลี่ยนแปลงสำคัญ (approve/reject/setStatus/setCreator/submit/complete/edit/cancel-reg)
export async function auditLog(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');

  // ตรวจ activity exists ก่อน — ป้องกันการ probe id ที่ไม่มี
  const exists = await activities.findById(id);
  if (!exists) return err(res, 404, 'activity not found');

  const items = await listAuditForActivity(id, { limit: 200 });
  res.json({ items });
}

// GET /api/admin/activities/:id
export async function detail(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');
  const activity = await activities.findById(id);
  if (!activity) return err(res, 404, 'activity not found');
  await decoratePoster(activity);
  res.json(activity);
}

// POST /api/admin/activities/:id/approve
export async function approve(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');
  const result = await activities.approveActivity(id, req.user.id);
  if (!result) {
    return err(
      res,
      409,
      'อนุมัติได้เฉพาะกิจกรรมที่อยู่ในสถานะ "รออนุมัติ"',
    );
  }
  if (result.full) {
    return err(
      res,
      422,
      'รหัสกิจกรรมในกลุ่ม (หน่วยงาน × ปีการศึกษา × ภาค × ประเภท) เต็ม (เกิน 100) — โปรดแจ้ง super_admin',
    );
  }
  await createActivityAuditLog({
    actor_id: req.user.id,
    activity_id: id,
    action: AUDIT.APPROVE,
    after: { status: 'WORK', code: result.code },
    ...auditMetaFromReq(req),
  });
  res.json({ status: 'ok', activity: result });
}

// helper: parse + dedupe activity_ids array
function parseActivityIds(raw) {
  if (!Array.isArray(raw)) return null;
  const ids = [
    ...new Set(
      raw
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v > 0),
    ),
  ];
  return ids;
}

// POST /api/admin/activities/bulk-approve
// body: { activity_ids: number[] }
export async function bulkApprove(req, res) {
  const ids = parseActivityIds(req.body?.activity_ids);
  if (!ids) return err(res, 400, 'ต้องส่ง activity_ids เป็น array');
  if (ids.length === 0) return err(res, 400, 'ไม่มี activity_id ที่ valid');
  if (ids.length > 200) return err(res, 400, 'อนุมัติได้ไม่เกิน 200 รายการต่อครั้ง');

  const out = await activities.bulkApproveActivities(ids, req.user.id);
  // log audit ทีละกิจกรรมที่ approve สำเร็จ
  const meta = auditMetaFromReq(req);
  await Promise.all(
    out.approved.map((id) =>
      createActivityAuditLog({
        actor_id: req.user.id,
        activity_id: id,
        action: AUDIT.BULK_APPROVE,
        after: { status: 'WORK' },
        ...meta,
      }),
    ),
  );
  res.json({ status: 'ok', ...out });
}

// POST /api/admin/activities/bulk-reject
// body: { activity_ids: number[], reason: string }
export async function bulkReject(req, res) {
  const ids = parseActivityIds(req.body?.activity_ids);
  if (!ids) return err(res, 400, 'ต้องส่ง activity_ids เป็น array');
  if (ids.length === 0) return err(res, 400, 'ไม่มี activity_id ที่ valid');
  if (ids.length > 200) return err(res, 400, 'ไม่อนุมัติได้ไม่เกิน 200 รายการต่อครั้ง');

  const reasonRaw = req.body?.reason;
  if (typeof reasonRaw !== 'string' || reasonRaw.trim().length === 0) {
    return err(res, 400, 'ต้องระบุเหตุผลในการไม่อนุมัติ');
  }
  const reason = reasonRaw.trim().slice(0, 1000);

  const out = await activities.bulkRejectActivities(ids, reason);
  const meta = auditMetaFromReq(req);
  await Promise.all(
    out.rejected.map((id) =>
      createActivityAuditLog({
        actor_id: req.user.id,
        activity_id: id,
        action: AUDIT.BULK_REJECT,
        after: { status: 'DRAFT' },
        note: reason,
        ...meta,
      }),
    ),
  );
  res.json({ status: 'ok', ...out });
}

// PATCH /api/admin/activities/:id/status  (super_admin only — bypass state machine)
// body: { status: 'DRAFT' | 'PENDING_APPROVAL' | 'WORK' | 'COMPLETED' }
export async function setStatus(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');

  const status = req.body?.status;
  if (typeof status !== 'string' || !ALLOWED_STATUSES.has(status)) {
    return err(
      res,
      400,
      `status ต้องเป็นค่าใดค่าหนึ่ง: ${[...ALLOWED_STATUSES].join(', ')}`,
    );
  }

  // เก็บ before-state ก่อน update เพื่อ audit
  const before = await activities.findById(id);
  if (!before) return err(res, 404, 'activity not found');

  const result = await activities.setActivityStatus(id, status, req.user.id);
  if (!result) return err(res, 404, 'activity not found');
  if (result.full) {
    return err(
      res,
      422,
      'รหัสกิจกรรมในกลุ่ม (หน่วยงาน × ปีการศึกษา × ภาค × ประเภท) เต็ม (เกิน 100) — ไม่สามารถสร้าง code ใหม่ได้',
    );
  }

  // log เฉพาะกรณีที่ status เปลี่ยนจริง
  if (before.status !== status) {
    await createActivityAuditLog({
      actor_id: req.user.id,
      activity_id: id,
      action: AUDIT.SET_STATUS,
      before: { status: before.status, code: before.code },
      after: { status: result.activity.status, code: result.activity.code, code_assigned: result.codeAssigned },
      ...auditMetaFromReq(req),
    });
  }

  res.json({ status: 'ok', activity: result.activity, code_assigned: result.codeAssigned });
}

// PATCH /api/admin/activities/:id/creator  (super_admin only)
// body: { created_by: number }
export async function setCreator(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');

  const newCreatorId = Number(req.body?.created_by);
  if (!Number.isInteger(newCreatorId) || newCreatorId < 1) {
    return err(res, 400, 'created_by ต้องเป็น integer ≥ 1');
  }

  // เก็บ before-state ก่อน update เพื่อ audit
  const before = await activities.findById(id);
  const result = await activities.setActivityCreator(id, newCreatorId);
  if (result === null) return err(res, 404, 'activity not found');
  if (!result.ok) {
    if (result.reason === 'USER_NOT_FOUND')
      return err(res, 400, 'ไม่พบผู้ใช้ที่จะตั้งเป็นผู้สร้าง');
    if (result.reason === 'USER_DISABLED')
      return err(res, 400, 'ผู้ใช้ที่จะตั้งเป็นผู้สร้างถูกระงับการใช้งาน');
    if (result.reason === 'INVALID_ROLE')
      return err(
        res,
        400,
        'ผู้สร้างต้องมี role: faculty_staff / admin / super_admin เท่านั้น',
      );
    return err(res, 400, 'เปลี่ยนผู้สร้างไม่สำเร็จ');
  }

  if (before && before.created_by !== newCreatorId) {
    await createActivityAuditLog({
      actor_id: req.user.id,
      activity_id: id,
      action: AUDIT.SET_CREATOR,
      before: { created_by: before.created_by, created_by_name: before.created_by_name },
      after: { created_by: result.activity.created_by, created_by_name: result.activity.created_by_name },
      ...auditMetaFromReq(req),
    });
  }

  res.json({ status: 'ok', activity: result.activity });
}

// PATCH /api/admin/activities/:id — admin/super_admin override edit
//   ฟิลด์ที่อนุญาต (subset): title, description, location, capacity, hours,
//                            loan_hours, start_at, end_at, registration_open_at,
//                            registration_close_at
//   ไม่ตรวจ ownership / status — admin/super_admin แก้ทุกคณะ ทุกสถานะได้
//   จะ log เป็น 'edit_admin' พร้อม before/after diff
const ADMIN_EDIT_VALIDATORS = {
  title: (v) =>
    typeof v === 'string' && v.trim().length > 0 && v.length <= 500
      ? { ok: true, value: v.trim() }
      : { ok: false, message: 'title ต้องเป็น string ความยาว 1–500' },
  description: (v) =>
    typeof v === 'string' && v.length <= 10000
      ? { ok: true, value: v }
      : { ok: false, message: 'description ต้องเป็น string ≤ 10000' },
  location: (v) =>
    typeof v === 'string' && v.length <= 500
      ? { ok: true, value: v }
      : { ok: false, message: 'location ต้องเป็น string ≤ 500' },
  capacity: (v) =>
    Number.isInteger(v) && v >= 1
      ? { ok: true, value: v }
      : { ok: false, message: 'capacity ต้องเป็น integer ≥ 1' },
  hours: (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return { ok: false, message: 'hours ≥ 0' };
    return { ok: true, value: Math.round(n * 10) / 10 };
  },
  loan_hours: (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0)
      return { ok: false, message: 'loan_hours ≥ 0' };
    return { ok: true, value: Math.round(n * 10) / 10 };
  },
  start_at: (v) => parseDateLike(v, 'start_at'),
  end_at: (v) => parseDateLike(v, 'end_at'),
  registration_open_at: (v) => parseDateLike(v, 'registration_open_at'),
  registration_close_at: (v) => parseDateLike(v, 'registration_close_at'),
};

function parseDateLike(v, label) {
  if (v === null || v === undefined) return { ok: false, message: `${label} ต้องมีค่า` };
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? { ok: false, message: `${label} ไม่ใช่วันที่ที่ถูกต้อง` }
    : { ok: true, value: d.toISOString() };
}

export async function adminEdit(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');

  const before = await activities.findById(id);
  if (!before) return err(res, 404, 'activity not found');

  // เก็บเฉพาะ field ที่ส่งมา + ผ่าน validator
  const payload = {};
  const beforeSnapshot = {};
  const afterSnapshot = {};
  for (const [key, validator] of Object.entries(ADMIN_EDIT_VALIDATORS)) {
    if (req.body?.[key] === undefined) continue;
    const v = validator(req.body[key]);
    if (!v.ok) return err(res, 400, v.message);
    payload[key] = v.value;
    beforeSnapshot[key] = before[key];
    afterSnapshot[key] = v.value;
  }

  // ตรวจช่วงเวลาให้สมเหตุสมผล (ถ้าส่งคู่กัน)
  const finalStart = payload.start_at ?? before.start_at;
  const finalEnd = payload.end_at ?? before.end_at;
  if (new Date(finalStart) >= new Date(finalEnd))
    return err(res, 400, 'start_at ต้องน้อยกว่า end_at');
  const finalRegOpen = payload.registration_open_at ?? before.registration_open_at;
  const finalRegClose = payload.registration_close_at ?? before.registration_close_at;
  if (new Date(finalRegOpen) >= new Date(finalRegClose))
    return err(res, 400, 'registration_open_at ต้องน้อยกว่า registration_close_at');

  if (Object.keys(payload).length === 0) {
    return res.json({ status: 'ok', activity: before, changed: false });
  }

  // ตรวจ capacity ใหม่ต้อง >= registered_count
  if (payload.capacity !== undefined && payload.capacity < before.registered_count) {
    return err(
      res,
      409,
      `capacity ใหม่ (${payload.capacity}) ต้อง ≥ จำนวนผู้สมัครปัจจุบัน (${before.registered_count})`,
    );
  }

  const updated = await activities.adminEditActivity(id, payload);

  // skip field ที่ค่าไม่เปลี่ยน (กัน log noise)
  const changedFields = Object.keys(payload).filter(
    (k) => String(beforeSnapshot[k]) !== String(afterSnapshot[k]),
  );
  if (changedFields.length > 0) {
    await createActivityAuditLog({
      actor_id: req.user.id,
      activity_id: id,
      action: AUDIT.EDIT_ADMIN,
      before: Object.fromEntries(changedFields.map((k) => [k, beforeSnapshot[k]])),
      after: Object.fromEntries(changedFields.map((k) => [k, afterSnapshot[k]])),
      ...auditMetaFromReq(req),
    });
  }

  res.json({ status: 'ok', activity: updated, changed_fields: changedFields });
}

// POST /api/admin/activities/:id/reject
// body: { reason: string }
export async function reject(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');

  const reasonRaw = req.body?.reason;
  if (typeof reasonRaw !== 'string' || reasonRaw.trim().length === 0) {
    return err(res, 400, 'ต้องระบุเหตุผลในการไม่อนุมัติ');
  }
  const reason = reasonRaw.trim().slice(0, 1000);

  const result = await activities.rejectActivity(id, reason);
  if (!result) {
    return err(
      res,
      409,
      'ไม่อนุมัติได้เฉพาะกิจกรรมที่อยู่ในสถานะ "รออนุมัติ"',
    );
  }
  await createActivityAuditLog({
    actor_id: req.user.id,
    activity_id: id,
    action: AUDIT.REJECT,
    after: { status: 'DRAFT' },
    note: reason,
    ...auditMetaFromReq(req),
  });
  res.json({ status: 'ok', activity: result });
}
