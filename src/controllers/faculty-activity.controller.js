import * as activities from '../models/faculty-activity.model.js';
import { deleteObject, getPresignedGetUrl } from '../utils/s3.js';
import { getCurrentAcademicYearBE } from '../utils/academic-year.js';

// helper: parse + validate academic_year query param (รับเฉพาะ พ.ศ. 4 หลัก)
function parseAcademicYear(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 2500 || n > 2700) return null;
  return n;
}

const ALLOWED_STATUSES = new Set([
  'DRAFT',
  'PENDING_APPROVAL',
  'WORK',
  'COMPLETED',
]);

const APPROVAL_MODES = new Set(['AUTO', 'MANUAL']);
const EDITABLE_STATUSES = new Set(['DRAFT']);
const LIMITED_EDITABLE_STATUSES = new Set(['WORK']);

function badRequest(res, message) {
  return res.status(400).json({ status: 'error', message });
}
function forbidden(res, message) {
  return res.status(403).json({ status: 'error', message });
}
function notFound(res) {
  return res.status(404).json({ status: 'error', message: 'activity not found' });
}
function conflict(res, message) {
  return res.status(409).json({ status: 'error', message });
}

// guard: faculty_staff ต้องมี faculty_id ก่อนใช้ระบบ — ถ้า NULL = ยังไม่ถูก provision ครบ
function requireFaculty(req, res) {
  if (!req.user.faculty_id) {
    res.status(403).json({
      status: 'error',
      message:
        'บัญชีของท่านยังไม่ถูกผูกกับคณะ — โปรดติดต่อผู้ดูแลระบบเพื่อตั้งค่าคณะของท่าน',
    });
    return false;
  }
  return true;
}

export async function stats(req, res) {
  if (!requireFaculty(req, res)) return;
  const academicYear = parseAcademicYear(req.query.academic_year);
  const [byFaculty, mine] = await Promise.all([
    activities.countByStatus(req.user.faculty_id, academicYear),
    activities.countMineByStatus(req.user.id, academicYear),
  ]);
  res.json({ faculty: byFaculty, mine, academic_year: academicYear });
}

// GET /api/faculty/academic-years
//   คืน { current, available } ใช้ populate dropdown filter
//     current   = ปีการศึกษาปัจจุบัน (คำนวณจากวันที่)
//     available = ปีทั้งหมดที่มี activity ในคณะ + รวม current เผื่อยังไม่มี activity ปีนี้
export async function academicYears(req, res) {
  if (!requireFaculty(req, res)) return;
  const current = getCurrentAcademicYearBE();
  const fromDb = await activities.listAcademicYearsByFaculty(req.user.faculty_id);
  const set = new Set(fromDb);
  set.add(current);
  const available = [...set].sort((a, b) => b - a);
  res.json({ current, available });
}

export async function list(req, res) {
  if (!requireFaculty(req, res)) return;

  const status = req.query.status;
  if (status && !ALLOWED_STATUSES.has(status)) {
    return badRequest(res, 'invalid status');
  }
  const mineOnly = req.query.mine === 'true';
  const academicYear = parseAcademicYear(req.query.academic_year);
  const search =
    typeof req.query.search === 'string' && req.query.search.trim().length > 0
      ? req.query.search.trim().slice(0, 200)
      : null;
  let limit = Number.parseInt(req.query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = 50;
  if (limit > 200) limit = 200;

  const items = await activities.listByFaculty({
    facultyId: req.user.faculty_id,
    requesterId: req.user.id,
    status: status ?? null,
    mineOnly,
    academicYear,
    search,
    limit,
  });

  // เพิ่ม flag can_edit / can_edit_limited (hybrid scope):
  //   can_edit         = แก้ทุกฟิลด์ได้ (DRAFT) — เฉพาะผู้สร้าง
  //   can_edit_limited = แก้บางฟิลด์ได้ (WORK) — เฉพาะผู้สร้าง
  const enriched = items.map((a) => ({
    ...a,
    can_edit:
      a.created_by === req.user.id && EDITABLE_STATUSES.has(a.status),
    can_edit_limited:
      a.created_by === req.user.id &&
      LIMITED_EDITABLE_STATUSES.has(a.status),
    is_mine: a.created_by === req.user.id,
  }));
  res.json({
    items: enriched,
    status: status ?? null,
    mine_only: mineOnly,
    academic_year: academicYear,
    search,
  });
}

export async function detail(req, res) {
  if (!requireFaculty(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const activity = await activities.findById(id);
  if (!activity) return notFound(res);

  // scope check: ผู้สร้างต้องอยู่ในคณะเดียวกัน
  if (activity.created_by_faculty_id !== req.user.faculty_id) {
    return forbidden(res, 'ไม่มีสิทธิ์เข้าถึงกิจกรรมนี้');
  }

  await decoratePoster(activity);
  res.json({
    ...activity,
    can_edit:
      activity.created_by === req.user.id &&
      EDITABLE_STATUSES.has(activity.status),
    can_edit_limited:
      activity.created_by === req.user.id &&
      LIMITED_EDITABLE_STATUSES.has(activity.status),
    is_mine: activity.created_by === req.user.id,
  });
}

// ── write actions ────────────────────────────────────────────────

const POSTER_ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const POSTER_MAX_BYTES = 5 * 1024 * 1024;

// แปลงค่าเงินจาก client (number/string) → number; null ถ้า invalid
function parseMoney(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  // ปัด 2 ตำแหน่งทศนิยม กัน floating-point error สะสม
  return Math.round(n * 100) / 100;
}

// แปลงชั่วโมง (กิจกรรม + กยศ) → number ทศนิยม 1 ตำแหน่ง; null ถ้า invalid
function parseHours(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function validatePoster(poster) {
  if (!poster || typeof poster !== 'object') return 'ต้องอัปโหลดภาพโปสเตอร์';
  if (typeof poster.storage_key !== 'string' || !poster.storage_key.startsWith('posters/'))
    return 'รูปแบบ storage_key ไม่ถูกต้อง';
  if (typeof poster.filename !== 'string' || !poster.filename.trim())
    return 'ชื่อไฟล์โปสเตอร์ไม่ถูกต้อง';
  if (!POSTER_ALLOWED_MIMES.has(poster.mime_type))
    return 'ภาพโปสเตอร์ต้องเป็น JPG, PNG หรือ WebP';
  if (
    !Number.isInteger(poster.size_bytes) ||
    poster.size_bytes <= 0 ||
    poster.size_bytes > POSTER_MAX_BYTES
  )
    return `ขนาดภาพโปสเตอร์ต้องไม่เกิน ${POSTER_MAX_BYTES / 1024 / 1024} MB`;
  return null;
}

function validatePayload(body, { requirePoster = false } = {}) {
  const errs = [];

  if (requirePoster) {
    const e = validatePoster(body.poster);
    if (e) errs.push(e);
  } else if (body.poster !== undefined && body.poster !== null) {
    // update: ถ้าส่ง poster มาแสดงว่าจะเปลี่ยน → ต้อง valid
    const e = validatePoster(body.poster);
    if (e) errs.push(e);
  }

  const isStr = (v) => typeof v === 'string';
  const isPosInt = (v) => Number.isInteger(v) && v >= 1;
  const inRange = (v, min, max) =>
    Number.isInteger(v) && v >= min && v <= max;
  const parseDate = (v) => {
    if (typeof v !== 'string') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  if (!isStr(body.title) || !body.title.trim()) errs.push('กรอก "ชื่อกิจกรรม"');
  if (!isStr(body.location) || !body.location.trim())
    errs.push('กรอก "สถานที่จัด"');
  if (!isPosInt(body.organization_id)) errs.push('เลือก "หน่วยงานเจ้าของ"');
  if (!isPosInt(body.category_id)) errs.push('เลือก "ประเภทกิจกรรม"');

  // ปีการศึกษา พ.ศ. — แนวกันค่าผิดประเภท ไม่บังคับช่วงเข้มเกิน
  if (!inRange(body.academic_year, 2500, 2700))
    errs.push('"ปีการศึกษา" ต้องเป็น พ.ศ. 4 หลัก');
  if (!inRange(body.semester, 1, 3)) errs.push('"ภาคเรียน" ต้องเป็น 1, 2 หรือ 3');

  const hoursParsed = parseHours(body.hours);
  if (hoursParsed === null || hoursParsed <= 0)
    errs.push('"จำนวนชั่วโมง" ต้องเป็นตัวเลข > 0 (ทศนิยม 1 ตำแหน่ง)');
  // loan_hours: optional ใน input → default 0; ถ้าใส่มาต้อง ≥ 0
  if (body.loan_hours !== undefined && body.loan_hours !== null && body.loan_hours !== '') {
    const loanParsed = parseHours(body.loan_hours);
    if (loanParsed === null || loanParsed < 0)
      errs.push('"ชั่วโมง กยศ" ต้องเป็นตัวเลข ≥ 0');
  }
  if (!isPosInt(body.capacity)) errs.push('"จำนวนที่รับ" ต้องเป็นจำนวนเต็ม ≥ 1');

  const startAt = parseDate(body.start_at);
  const endAt = parseDate(body.end_at);
  if (!startAt) errs.push('"วันเวลาเริ่มกิจกรรม" ไม่ถูกต้อง');
  if (!endAt) errs.push('"วันเวลาสิ้นสุดกิจกรรม" ไม่ถูกต้อง');
  if (startAt && endAt && startAt >= endAt)
    errs.push('"เวลาเริ่ม" ต้องน้อยกว่า "เวลาสิ้นสุด"');

  const regOpen = parseDate(body.registration_open_at);
  const regClose = parseDate(body.registration_close_at);
  if (!regOpen) errs.push('"วันเปิดรับสมัคร" ไม่ถูกต้อง');
  if (!regClose) errs.push('"วันปิดรับสมัคร" ไม่ถูกต้อง');
  if (regOpen && regClose && regOpen >= regClose)
    errs.push('"เปิดรับสมัคร" ต้องน้อยกว่า "ปิดรับสมัคร"');

  if (!APPROVAL_MODES.has(body.approval_mode))
    errs.push('"โหมดอนุมัติผู้สมัคร" ไม่ถูกต้อง (AUTO/MANUAL)');

  // budget — source + requested required ตอน create/edit; actual optional (กรอกหลังจบกิจกรรม)
  if (typeof body.budget_source !== 'string' || !body.budget_source.trim())
    errs.push('กรอก "แหล่งงบประมาณ"');
  const reqBudget = parseMoney(body.budget_requested);
  if (reqBudget === null || reqBudget < 0)
    errs.push('"งบประมาณที่ขอใช้" ต้องเป็นจำนวนเงิน ≥ 0');
  if (body.budget_actual !== null && body.budget_actual !== undefined && body.budget_actual !== '') {
    const actBudget = parseMoney(body.budget_actual);
    if (actBudget === null || actBudget < 0)
      errs.push('"งบประมาณที่จ่ายจริง" ต้องเป็นจำนวนเงิน ≥ 0 หรือว่าง');
  }

  // skills required ≥ 1 (memory: ทุกกิจกรรมต้องมี skill ที่นิสิตจะได้รับ)
  if (!Array.isArray(body.skill_ids) || body.skill_ids.length === 0)
    errs.push('ต้องเลือก "ทักษะที่จะได้รับ" อย่างน้อย 1 ข้อ');
  else if (!body.skill_ids.every(isPosInt))
    errs.push('"ทักษะ" มีค่าไม่ถูกต้อง');

  // eligible_faculty_ids ว่างได้ (= ทุกคณะ)
  if (
    body.eligible_faculty_ids !== undefined &&
    body.eligible_faculty_ids !== null &&
    !(Array.isArray(body.eligible_faculty_ids) &&
      body.eligible_faculty_ids.every(isPosInt))
  )
    errs.push('"คณะที่รับสมัคร" มีค่าไม่ถูกต้อง');

  // window check-in (optional — fallback ใช้ start_at - 30m / end_at + 15m)
  const ciOpens = body.check_in_opens_at == null ? null : parseDate(body.check_in_opens_at);
  const ciCloses = body.check_in_closes_at == null ? null : parseDate(body.check_in_closes_at);
  if (body.check_in_opens_at != null && !ciOpens)
    errs.push('"ช่วงเปิดเช็คอิน — เริ่ม" ไม่ถูกต้อง');
  if (body.check_in_closes_at != null && !ciCloses)
    errs.push('"ช่วงเปิดเช็คอิน — สิ้นสุด" ไม่ถูกต้อง');
  if (ciOpens && ciCloses && ciOpens >= ciCloses)
    errs.push('"ช่วงเช็คอินเริ่ม" ต้องน้อยกว่า "ช่วงเช็คอินสิ้นสุด"');

  return errs;
}

// build payload ที่ส่งให้ model — clean trim + default fallback
function normalizePayload(body) {
  const payload = {
    title: body.title.trim(),
    description: typeof body.description === 'string' ? body.description.trim() : '',
    location: body.location.trim(),
    organization_id: body.organization_id,
    category_id: body.category_id,
    academic_year: body.academic_year,
    semester: body.semester,
    hours: parseHours(body.hours),
    loan_hours: parseHours(body.loan_hours) ?? 0,
    capacity: body.capacity,
    start_at: body.start_at,
    end_at: body.end_at,
    registration_open_at: body.registration_open_at,
    registration_close_at: body.registration_close_at,
    approval_mode: body.approval_mode,
    check_in_opens_at: body.check_in_opens_at ?? null,
    check_in_closes_at: body.check_in_closes_at ?? null,
    budget_source: body.budget_source.trim(),
    budget_requested: parseMoney(body.budget_requested),
    budget_actual: parseMoney(body.budget_actual),
    skill_ids: body.skill_ids,
    eligible_faculty_ids: body.eligible_faculty_ids ?? [],
  };
  if (body.poster && typeof body.poster === 'object') {
    payload.poster = {
      storage_key: body.poster.storage_key,
      filename: body.poster.filename.trim(),
      mime_type: body.poster.mime_type,
      size_bytes: body.poster.size_bytes,
    };
  }
  return payload;
}

// แปะ presigned URL บน poster + documents ก่อนส่งกลับ frontend
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

export async function create(req, res) {
  if (!requireFaculty(req, res)) return;
  const errors = validatePayload(req.body || {}, { requirePoster: true });
  if (errors.length) {
    return res.status(400).json({ status: 'error', message: errors[0], errors });
  }
  const payload = normalizePayload(req.body);
  let id;
  try {
    id = await activities.createActivity(payload, req.user.id, req.user.faculty_id);
  } catch (err) {
    // create ล้มเหลว → ลบ poster ที่ upload ไปแล้วใน MinIO (best-effort, กัน orphan)
    if (payload.poster?.storage_key) {
      deleteObject(payload.poster.storage_key);
    }
    throw err;
  }
  const created = await decoratePoster(await activities.findById(id));
  res.status(201).json({
    ...created,
    is_mine: true,
    can_edit: EDITABLE_STATUSES.has(created.status),
    can_edit_limited: LIMITED_EDITABLE_STATUSES.has(created.status),
  });
}

export async function update(req, res) {
  if (!requireFaculty(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const existing = await activities.findById(id);
  if (!existing) return notFound(res);
  if (existing.created_by_faculty_id !== req.user.faculty_id)
    return forbidden(res, 'ไม่มีสิทธิ์เข้าถึงกิจกรรมนี้');
  if (existing.created_by !== req.user.id)
    return forbidden(res, 'แก้ไขได้เฉพาะกิจกรรมที่ท่านสร้างเอง');
  if (!EDITABLE_STATUSES.has(existing.status))
    return conflict(res, `สถานะ ${existing.status} ไม่อนุญาตให้แก้ไข`);

  const errors = validatePayload(req.body || {});
  if (errors.length) {
    return res.status(400).json({ status: 'error', message: errors[0], errors });
  }

  const payload = normalizePayload(req.body);
  let result;
  try {
    result = await activities.updateActivity(id, payload, req.user.id);
  } catch (err) {
    // update ล้มเหลว + มี poster ใหม่ → ลบ poster ใหม่ที่ upload ไป (กัน orphan)
    if (payload.poster?.storage_key) {
      deleteObject(payload.poster.storage_key);
    }
    throw err;
  }
  // ถ้าเปลี่ยน poster สำเร็จ → ลบ object เก่าใน S3 (best-effort)
  if (result?.oldPosterStorageKey && payload.poster) {
    deleteObject(result.oldPosterStorageKey);
  }
  const updated = await decoratePoster(await activities.findById(id));
  res.json({
    ...updated,
    is_mine: true,
    can_edit: EDITABLE_STATUSES.has(updated.status),
    can_edit_limited: LIMITED_EDITABLE_STATUSES.has(updated.status),
  });
}

// validator + normalizer เฉพาะ field ที่อนุญาตให้แก้ตอน status='WORK'
//   columns: capacity, description, location, start_at, end_at,
//            registration_open_at, registration_close_at, approval_mode, budget_actual
//   m2m:     eligible_faculty_ids, skill_ids
function validateLimitedPayload(body) {
  const errs = [];
  const isStr = (v) => typeof v === 'string';
  const isPosInt = (v) => Number.isInteger(v) && v >= 1;
  const parseDate = (v) => {
    if (typeof v !== 'string') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  if (!isStr(body.location) || !body.location.trim())
    errs.push('กรอก "สถานที่จัด"');
  if (!isPosInt(body.capacity)) errs.push('"จำนวนที่รับ" ต้องเป็นจำนวนเต็ม ≥ 1');

  const startAt = parseDate(body.start_at);
  const endAt = parseDate(body.end_at);
  if (!startAt) errs.push('"วันเวลาเริ่มกิจกรรม" ไม่ถูกต้อง');
  if (!endAt) errs.push('"วันเวลาสิ้นสุดกิจกรรม" ไม่ถูกต้อง');
  if (startAt && endAt && startAt >= endAt)
    errs.push('"เวลาเริ่ม" ต้องน้อยกว่า "เวลาสิ้นสุด"');

  const regOpen = parseDate(body.registration_open_at);
  const regClose = parseDate(body.registration_close_at);
  if (!regOpen) errs.push('"วันเปิดรับสมัคร" ไม่ถูกต้อง');
  if (!regClose) errs.push('"วันปิดรับสมัคร" ไม่ถูกต้อง');
  if (regOpen && regClose && regOpen >= regClose)
    errs.push('"เปิดรับสมัคร" ต้องน้อยกว่า "ปิดรับสมัคร"');

  if (!APPROVAL_MODES.has(body.approval_mode))
    errs.push('"โหมดอนุมัติผู้สมัคร" ไม่ถูกต้อง (AUTO/MANUAL)');

  // budget_actual optional (รอกรอกหลังจบ) — รับ '' / null = clear ได้
  if (body.budget_actual !== null && body.budget_actual !== undefined && body.budget_actual !== '') {
    const actBudget = parseMoney(body.budget_actual);
    if (actBudget === null || actBudget < 0)
      errs.push('"งบประมาณที่จ่ายจริง" ต้องเป็นจำนวนเงิน ≥ 0 หรือว่าง');
  }

  // skills required ≥ 1 (memory: ทุกกิจกรรมต้องมี skill อย่างน้อย 1)
  if (!Array.isArray(body.skill_ids) || body.skill_ids.length === 0)
    errs.push('ต้องเลือก "ทักษะที่จะได้รับ" อย่างน้อย 1 ข้อ');
  else if (!body.skill_ids.every(isPosInt))
    errs.push('"ทักษะ" มีค่าไม่ถูกต้อง');

  if (
    body.eligible_faculty_ids !== undefined &&
    body.eligible_faculty_ids !== null &&
    !(
      Array.isArray(body.eligible_faculty_ids) &&
      body.eligible_faculty_ids.every(isPosInt)
    )
  )
    errs.push('"คณะที่รับสมัคร" มีค่าไม่ถูกต้อง');

  return errs;
}

function normalizeLimitedPayload(body) {
  // budget_actual: '' หรือ null/undefined → null (clear ค่า), อื่น ๆ → parseMoney
  const budgetActual =
    body.budget_actual === '' ||
    body.budget_actual === null ||
    body.budget_actual === undefined
      ? null
      : parseMoney(body.budget_actual);
  return {
    capacity: body.capacity,
    description:
      typeof body.description === 'string' ? body.description.trim() : '',
    location: body.location.trim(),
    start_at: body.start_at,
    end_at: body.end_at,
    registration_open_at: body.registration_open_at,
    registration_close_at: body.registration_close_at,
    approval_mode: body.approval_mode,
    budget_actual: budgetActual,
    skill_ids: body.skill_ids,
    eligible_faculty_ids: body.eligible_faculty_ids ?? [],
  };
}

// PATCH /api/faculty/activities/:id/limited-update
//   เจ้าหน้าที่คณะแก้ไขกิจกรรมที่อยู่ในสถานะ "ดำเนินการ" (WORK)
//   เฉพาะฟิลด์ที่อนุญาต — กันการแก้ field สำคัญ (title/hours/budget/poster/skills) หลังกิจกรรมเริ่มแล้ว
export async function updateLimited(req, res) {
  if (!requireFaculty(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const existing = await activities.findById(id);
  if (!existing) return notFound(res);
  if (existing.created_by_faculty_id !== req.user.faculty_id)
    return forbidden(res, 'ไม่มีสิทธิ์เข้าถึงกิจกรรมนี้');
  if (existing.created_by !== req.user.id)
    return forbidden(res, 'แก้ไขได้เฉพาะกิจกรรมที่ท่านสร้างเอง');
  if (!LIMITED_EDITABLE_STATUSES.has(existing.status))
    return conflict(
      res,
      `สถานะ ${existing.status} ไม่อนุญาตให้แก้ไข (โหมดจำกัด)`,
    );

  const errors = validateLimitedPayload(req.body || {});
  if (errors.length)
    return res.status(400).json({ status: 'error', message: errors[0], errors });

  const payload = normalizeLimitedPayload(req.body);
  const result = await activities.updateActivityLimited(id, payload);
  if (!result.ok) {
    if (result.reason === 'CAPACITY_TOO_LOW') {
      return conflict(
        res,
        `ลดจำนวนรับไม่ได้ — มีผู้สมัครแล้ว ${result.current} คน`,
      );
    }
    if (result.reason === 'NOT_WORK') {
      return conflict(
        res,
        'สถานะกิจกรรมเปลี่ยนไปแล้ว — โปรดโหลดข้อมูลใหม่',
      );
    }
    return notFound(res);
  }

  const updated = await decoratePoster(await activities.findById(id));
  res.json({
    ...updated,
    is_mine: true,
    can_edit: EDITABLE_STATUSES.has(updated.status),
    can_edit_limited: LIMITED_EDITABLE_STATUSES.has(updated.status),
  });
}

export async function submit(req, res) {
  if (!requireFaculty(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const existing = await activities.findById(id);
  if (!existing) return notFound(res);
  if (existing.created_by_faculty_id !== req.user.faculty_id)
    return forbidden(res, 'ไม่มีสิทธิ์เข้าถึงกิจกรรมนี้');
  if (existing.created_by !== req.user.id)
    return forbidden(res, 'ส่งอนุมัติได้เฉพาะกิจกรรมที่ท่านสร้างเอง');

  // re-validate ครบถ้วนก่อนยอมส่ง — กันส่ง draft ที่กรอกไม่ครบ
  const toIso = (v) =>
    v instanceof Date ? v.toISOString() : v;
  const reValidate = validatePayload(
    {
      ...existing,
      skill_ids: existing.skills.map((s) => s.id),
      eligible_faculty_ids: existing.eligible_faculties.map((f) => f.id),
      start_at: toIso(existing.start_at),
      end_at: toIso(existing.end_at),
      registration_open_at: toIso(existing.registration_open_at),
      registration_close_at: toIso(existing.registration_close_at),
      check_in_opens_at: toIso(existing.check_in_opens_at),
      check_in_closes_at: toIso(existing.check_in_closes_at),
    },
    { requirePoster: true },
  );
  if (reValidate.length) {
    return res.status(400).json({
      status: 'error',
      message: 'กิจกรรมยังกรอกไม่ครบ — ' + reValidate[0],
      errors: reValidate,
    });
  }

  const result = await activities.submitActivity(id);
  if (!result) {
    return conflict(
      res,
      `สถานะ ${existing.status} ไม่อนุญาตให้ส่งอนุมัติ (ต้องเป็น DRAFT)`,
    );
  }
  const updated = await decoratePoster(await activities.findById(id));
  res.json({
    ...updated,
    is_mine: true,
    can_edit: EDITABLE_STATUSES.has(updated.status),
    can_edit_limited: LIMITED_EDITABLE_STATUSES.has(updated.status),
  });
}

// POST /api/faculty/activities/:id/complete
// ปิดโครงการ — เฉพาะผู้สร้างกิจกรรม + status WORK เท่านั้น
//   COMPLETED เป็น terminal state ในการมองของ faculty (จะ reverse ต้องผ่าน super_admin)
export async function complete(req, res) {
  if (!requireFaculty(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const existing = await activities.findById(id);
  if (!existing) return notFound(res);
  if (existing.created_by_faculty_id !== req.user.faculty_id)
    return forbidden(res, 'ไม่มีสิทธิ์เข้าถึงกิจกรรมนี้');
  if (existing.created_by !== req.user.id)
    return forbidden(res, 'ปิดโครงการได้เฉพาะกิจกรรมที่ท่านสร้างเอง');
  if (existing.status !== 'WORK')
    return conflict(
      res,
      `สถานะ ${existing.status} ไม่อนุญาตให้ปิดโครงการ (ต้องเป็น WORK)`,
    );

  const result = await activities.completeActivity(id);
  if (!result) {
    // race: status เปลี่ยนระหว่าง check กับ update
    return conflict(
      res,
      'สถานะกิจกรรมเปลี่ยนระหว่างทำงาน — โหลดหน้าใหม่แล้วลองอีกครั้ง',
    );
  }

  const updated = await decoratePoster(await activities.findById(id));
  res.json({
    ...updated,
    is_mine: true,
    can_edit: EDITABLE_STATUSES.has(updated.status),
    can_edit_limited: LIMITED_EDITABLE_STATUSES.has(updated.status),
  });
}
