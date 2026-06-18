import {
  getTranscriptData,
  listEligibleStudents,
  updateAcademicProfile,
} from '../models/transcript.model.js';
import { getActiveRule } from '../models/cert-requirement.model.js';
import { buildTranscriptDocx } from '../utils/transcript-docx.js';

// admin/super_admin: ตรวจสอบนิสิตที่ครบเกณฑ์ + ออกทรานสคริปต์กิจกรรม (Word)

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function err(res, status, message) {
  return res.status(status).json({ status: 'error', message });
}

function parsePosInt(v, fallback = null) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

// ── (A) GET /api/admin/students/eligible ─────────────────────────────────
//   รายชื่อนิสิตที่เข้าร่วมครบตามเกณฑ์ (active cert rule) + filter q/faculty
export async function listEligible(req, res) {
  const rule = await getActiveRule();
  if (!rule) return err(res, 409, 'ยังไม่ได้ตั้งเกณฑ์การออกทรานสคริปต์ (cert_requirements)');

  let limit = parsePosInt(req.query.limit, DEFAULT_LIMIT);
  if (limit === null) return err(res, 400, 'invalid limit');
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  let offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isInteger(offset) || offset < 0) return err(res, 400, 'invalid offset');

  const q = req.query.q?.trim() || null;
  const facultyId = parsePosInt(req.query.faculty_id, null);
  if (req.query.faculty_id && facultyId === null)
    return err(res, 400, 'invalid faculty_id');

  const out = await listEligibleStudents(rule, { q, facultyId, limit, offset });
  res.json({
    ...out,
    limit,
    offset,
    rule: {
      group_a_prefixes: rule.group_a_prefixes,
      group_b_prefixes: rule.group_b_prefixes,
      group_a_min_activities: rule.group_a_min_activities,
      group_b_min_activities: rule.group_b_min_activities,
      min_total_hours: rule.min_total_hours,
    },
  });
}

// ── (B) GET /api/admin/students/:id/transcript ───────────────────────────
//   JSON สำหรับ preview ทรานสคริปต์บนจอ
export async function transcriptData(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');

  const data = await getTranscriptData(id);
  if (!data) return err(res, 404, 'ไม่พบนิสิต');
  res.json(data);
}

// ── PATCH /api/admin/students/:id/academic-profile ───────────────────────
//   บันทึก สาขา/ปริญญา/วันรับเข้า/ชื่ออังกฤษ ลง DB
export async function patchAcademicProfile(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');

  const body = req.body ?? {};
  const fields = {};
  for (const key of ['major_name', 'degree_name', 'prefix_en', 'name_en', 'surname_en']) {
    if (body[key] !== undefined) {
      if (body[key] !== null && typeof body[key] !== 'string')
        return err(res, 400, `invalid ${key}`);
      fields[key] = body[key] === null ? null : String(body[key]).trim().slice(0, 200);
    }
  }
  if (body.admission_date !== undefined) {
    if (body.admission_date === null || body.admission_date === '') {
      fields.admission_date = null;
    } else if (
      typeof body.admission_date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.admission_date)
    ) {
      fields.admission_date = body.admission_date;
    } else {
      return err(res, 400, 'admission_date ต้องเป็นรูปแบบ YYYY-MM-DD');
    }
  }

  const updated = await updateAcademicProfile(id, fields);
  if (!updated) return err(res, 404, 'ไม่พบนิสิต');
  res.json({ status: 'ok', profile: updated });
}

// ── (C) POST /api/admin/students/:id/transcript.docx ─────────────────────
//   body (optional override จากฟอร์ม): { major_name, degree_name, admission_date, name_en_full }
//   ไม่เขียนลง DB — แค่ทับ header ตอน render เอกสาร
export async function transcriptDocx(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');

  const data = await getTranscriptData(id);
  if (!data) return err(res, 404, 'ไม่พบนิสิต');

  const body = req.body ?? {};
  const overrides = {};
  for (const k of ['major_name', 'degree_name', 'admission_date', 'name_en_full']) {
    if (typeof body[k] === 'string' && body[k].trim().length > 0) {
      overrides[k] = body[k].trim();
    }
  }

  const buffer = await buildTranscriptDocx(data, overrides);

  const filename = `transcript-${data.header.msu_id || id}.docx`;
  const safeName = filename.replace(/[^a-zA-Z0-9_.-]+/g, '_');
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.send(buffer);
}
