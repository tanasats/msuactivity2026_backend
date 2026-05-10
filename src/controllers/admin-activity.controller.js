import * as activities from '../models/admin-activity.model.js';
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
export async function academicYears(req, res) {
  const current = getCurrentAcademicYearBE();
  const fromDb = await activities.listAllAcademicYears();
  const set = new Set(fromDb);
  set.add(current);
  const available = [...set].sort((a, b) => b - a);
  res.json({ current, available });
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

  const result = await activities.setActivityStatus(id, status, req.user.id);
  if (!result) return err(res, 404, 'activity not found');
  if (result.full) {
    return err(
      res,
      422,
      'รหัสกิจกรรมในกลุ่ม (หน่วยงาน × ปีการศึกษา × ภาค × ประเภท) เต็ม (เกิน 100) — ไม่สามารถสร้าง code ใหม่ได้',
    );
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
  res.json({ status: 'ok', activity: result.activity });
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
  res.json({ status: 'ok', activity: result });
}
