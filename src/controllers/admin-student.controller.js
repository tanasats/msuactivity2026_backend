import * as model from '../models/admin-student.model.js';
import { findById as findUser } from '../models/user-admin.model.js';
import { rowsToCsv, sendCsv } from '../utils/csv.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const VALID_SORTS = new Set([
  'name_asc',
  'name_desc',
  'hours_desc',
  'hours_asc',
  'last_login_desc',
]);
const VALID_REG_STATUSES = new Set([
  'PENDING_APPROVAL',
  'REGISTERED',
  'WAITLISTED',
  'CANCELLED_BY_USER',
  'CANCELLED_BY_STAFF',
  'REJECTED_BY_STAFF',
  'ATTENDED',
  'NO_SHOW',
]);
const VALID_EVAL_STATUSES = new Set([
  'PENDING_EVALUATION',
  'PASSED',
  'FAILED',
]);

function err(res, status, message) {
  return res.status(status).json({ status: 'error', message });
}

function parsePosInt(v, fallback = null) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function parseAcademicYear(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 2500 || n > 2700) return null;
  return n;
}

// ── students list ────────────────────────────────────────────

export async function listStudents(req, res) {
  let limit = parsePosInt(req.query.limit, DEFAULT_LIMIT);
  if (limit === null) return err(res, 400, 'invalid limit');
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  let offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isInteger(offset) || offset < 0) return err(res, 400, 'invalid offset');

  const sort = VALID_SORTS.has(req.query.sort) ? req.query.sort : 'name_asc';
  const q = req.query.q?.trim() || null;
  const facultyId = parsePosInt(req.query.faculty_id, null);
  if (req.query.faculty_id && facultyId === null)
    return err(res, 400, 'invalid faculty_id');

  const out = await model.listStudents({ q, facultyId, sort, limit, offset });
  res.json({ ...out, limit, offset, sort });
}

// ── student detail (drill-down) ──────────────────────────────

export async function studentDetail(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');

  const user = await findUser(id);
  if (!user) return err(res, 404, 'student not found');
  if (user.role !== 'student')
    return err(res, 400, 'user นี้ไม่ใช่ role student');

  const [stats, registrations] = await Promise.all([
    model.getStudentAggregateStats(id),
    model.listStudentRegistrations(id),
  ]);

  res.json({
    user: {
      id: user.id,
      msu_id: user.msu_id,
      email: user.email,
      full_name: user.full_name,
      faculty_id: user.faculty_id,
      faculty_name: user.faculty_name,
      picture_url: user.picture_url,
      status: user.status,
      last_login_at: user.last_login_at,
      created_at: user.created_at,
    },
    stats,
    registrations,
  });
}

// ── student registrations CSV ────────────────────────────────

const STUDENT_REG_CSV_COLS = [
  { key: 'activity_code',         label: 'รหัสกิจกรรม' },
  { key: 'activity_title',        label: 'ชื่อกิจกรรม' },
  { key: 'academic_year',         label: 'ปีการศึกษา' },
  { key: 'semester',              label: 'ภาค' },
  { key: 'category_name',         label: 'หมวด' },
  { key: 'organization_name',     label: 'หน่วยงาน' },
  { key: 'activity_faculty_name', label: 'คณะที่จัด' },
  { key: 'registration_status',   label: 'สถานะลงทะเบียน' },
  { key: 'evaluation_status',     label: 'ผลประเมิน' },
  { key: 'hours',                 label: 'ชั่วโมง' },
  { key: 'loan_hours',            label: 'ชม. กยศ' },
  { key: 'registered_at',         label: 'ลงทะเบียนเมื่อ' },
  { key: 'attended_at',           label: 'เช็คอินเมื่อ' },
];

export async function studentRegistrationsCsv(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');

  const user = await findUser(id);
  if (!user) return err(res, 404, 'student not found');

  const rows = await model.listStudentRegistrations(id);
  const csv = rowsToCsv(rows, STUDENT_REG_CSV_COLS);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `student-${user.msu_id || user.id}-registrations-${stamp}.csv`;
  sendCsv(res, filename, csv);
}

// ── cross-browse: list registrations ────────────────────────

function parseRegistrationsFilters(query) {
  const q = query.q?.trim() || null;
  const studentFacultyId = parsePosInt(query.student_faculty_id, null);
  if (query.student_faculty_id && studentFacultyId === null)
    return { error: 'invalid student_faculty_id' };
  const activityFacultyId = parsePosInt(query.activity_faculty_id, null);
  if (query.activity_faculty_id && activityFacultyId === null)
    return { error: 'invalid activity_faculty_id' };

  const registrationStatus = query.status?.trim() || null;
  if (registrationStatus && !VALID_REG_STATUSES.has(registrationStatus))
    return { error: 'invalid status' };

  const evaluationStatus = query.evaluation_status?.trim() || null;
  if (evaluationStatus && !VALID_EVAL_STATUSES.has(evaluationStatus))
    return { error: 'invalid evaluation_status' };

  const academicYear = parseAcademicYear(query.academic_year);
  if (query.academic_year && academicYear === null)
    return { error: 'invalid academic_year' };

  const activityId = parsePosInt(query.activity_id, null);
  if (query.activity_id && activityId === null)
    return { error: 'invalid activity_id' };

  return {
    filters: {
      q,
      studentFacultyId,
      activityFacultyId,
      registrationStatus,
      evaluationStatus,
      academicYear,
      activityId,
    },
  };
}

export async function listRegistrations(req, res) {
  const parsed = parseRegistrationsFilters(req.query);
  if (parsed.error) return err(res, 400, parsed.error);

  let limit = parsePosInt(req.query.limit, DEFAULT_LIMIT);
  if (limit === null) return err(res, 400, 'invalid limit');
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  let offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isInteger(offset) || offset < 0) return err(res, 400, 'invalid offset');

  const out = await model.listRegistrations({ ...parsed.filters, limit, offset });
  res.json({ ...out, limit, offset, filters: parsed.filters });
}

// ── cross-browse CSV export ─────────────────────────────────

const CROSS_CSV_COLS = [
  { key: 'msu_id',                label: 'รหัสนิสิต' },
  { key: 'student_name',          label: 'ชื่อ-สกุล' },
  { key: 'student_faculty_name',  label: 'คณะ' },
  { key: 'student_email',         label: 'อีเมล' },
  { key: 'activity_code',         label: 'รหัสกิจกรรม' },
  { key: 'activity_title',        label: 'ชื่อกิจกรรม' },
  { key: 'academic_year',         label: 'ปีการศึกษา' },
  { key: 'semester',              label: 'ภาค' },
  { key: 'category_name',         label: 'หมวด' },
  { key: 'activity_faculty_name', label: 'คณะที่จัด' },
  { key: 'registration_status',   label: 'สถานะลงทะเบียน' },
  { key: 'evaluation_status',     label: 'ผลประเมิน' },
  { key: 'hours',                 label: 'ชั่วโมง' },
  { key: 'loan_hours',            label: 'ชม. กยศ' },
  { key: 'registered_at',         label: 'ลงทะเบียนเมื่อ' },
  { key: 'attended_at',           label: 'เช็คอินเมื่อ' },
];

// limit สูงกว่า list (CSV เป็น "ดึงไปวิเคราะห์")
const CSV_HARD_LIMIT = 10000;

export async function registrationsCsv(req, res) {
  const parsed = parseRegistrationsFilters(req.query);
  if (parsed.error) return err(res, 400, parsed.error);

  // ดึงครั้งเดียวยกชุด (ไม่ paginate) — limit safety
  const { items } = await model.listRegistrations({
    ...parsed.filters,
    limit: CSV_HARD_LIMIT,
    offset: 0,
  });

  const csv = rowsToCsv(items, CROSS_CSV_COLS);
  const stamp = new Date().toISOString().slice(0, 10);
  sendCsv(res, `registrations-${stamp}.csv`, csv);
}
