import {
  createFaculty,
  findById,
  findByCode,
  listFaculties,
  softDeleteFaculty,
  updateFaculty,
} from '../models/faculty.model.js';
import {
  createMasterDataAuditLog,
  MASTER_AUDIT_TARGETS,
  MASTER_AUDIT_ACTIONS,
} from '../models/master-data-audit.model.js';
import {
  auditMetaFromReq,
  buildDiff,
} from '../models/activity-audit.model.js';

// code = ตัวอักษร/ตัวเลข 1-10 ตัว — เผื่อ MSU ใช้ทั้งตัวเลข (01..) และตัวอักษร
const CODE_REGEX = /^[A-Z0-9]{1,10}$/;
// category — ปัจจุบันใช้ 'A' หรือ NULL; allow string 1-4 ตัวเผื่ออนาคต
const CATEGORY_REGEX = /^[A-Z]{1,4}$/;
const FACULTY_DIFF_FIELDS = ['code', 'name', 'category', 'is_active'];

function badRequest(res, message) {
  return res.status(400).json({ status: 'error', message });
}
function conflict(res, message) {
  return res.status(409).json({ status: 'error', message });
}
function notFound(res, message = 'faculty not found') {
  return res.status(404).json({ status: 'error', message });
}

function parseBoolFlag(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export async function list(req, res) {
  const isActive = parseBoolFlag(req.query.is_active);
  const q = req.query.q?.trim() || null;
  const category = req.query.category?.trim() || null;
  const items = await listFaculties({ isActive, q, category });
  res.json({ items });
}

export async function getOne(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');
  const item = await findById(id);
  if (!item) return notFound(res);
  res.json(item);
}

export async function create(req, res) {
  const { code, name, category = null, is_active = true } = req.body ?? {};

  if (typeof code !== 'string' || !CODE_REGEX.test(code)) {
    return badRequest(res, 'code ต้องเป็นตัวอักษรพิมพ์ใหญ่/ตัวเลข 1–10 ตัว');
  }
  if (typeof name !== 'string' || !name.trim()) {
    return badRequest(res, 'name ต้องไม่ว่าง');
  }
  if (category !== null) {
    if (typeof category !== 'string' || !CATEGORY_REGEX.test(category)) {
      return badRequest(res, 'category ต้องเป็นตัวอักษรพิมพ์ใหญ่ 1–4 ตัว หรือ null');
    }
  }
  if (typeof is_active !== 'boolean' && is_active !== undefined) {
    return badRequest(res, 'is_active ต้องเป็น boolean');
  }

  const dup = await findByCode(code);
  if (dup) return conflict(res, `code "${code}" ซ้ำกับรายการที่มีอยู่`);

  const created = await createFaculty({
    code,
    name: name.trim(),
    category,
    is_active: !!is_active,
  });
  await createMasterDataAuditLog({
    actor_id: req.user.id,
    target_type: MASTER_AUDIT_TARGETS.FACULTY,
    target_id: created.id,
    target_key: created.code,
    action: MASTER_AUDIT_ACTIONS.CREATE,
    after: {
      code: created.code,
      name: created.name,
      category: created.category,
      is_active: created.is_active,
    },
    ...auditMetaFromReq(req),
  });
  res.status(201).json(created);
}

export async function update(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const existing = await findById(id);
  if (!existing) return notFound(res);

  const { code, name, category, is_active } = req.body ?? {};

  if (code !== undefined) {
    if (typeof code !== 'string' || !CODE_REGEX.test(code)) {
      return badRequest(res, 'code ต้องเป็นตัวอักษรพิมพ์ใหญ่/ตัวเลข 1–10 ตัว');
    }
    if (code !== existing.code) {
      const dup = await findByCode(code);
      if (dup) return conflict(res, `code "${code}" ซ้ำกับรายการที่มีอยู่`);
    }
  }
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return badRequest(res, 'name ต้องไม่ว่าง');
  }
  if (category !== undefined && category !== null) {
    if (typeof category !== 'string' || !CATEGORY_REGEX.test(category)) {
      return badRequest(res, 'category ต้องเป็นตัวอักษรพิมพ์ใหญ่ 1–4 ตัว หรือ null');
    }
  }
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    return badRequest(res, 'is_active ต้องเป็น boolean');
  }

  const updated = await updateFaculty(id, {
    code,
    name: name?.trim(),
    category,
    is_active,
  });
  const diff = buildDiff(existing, updated, FACULTY_DIFF_FIELDS);
  if (diff) {
    const isRestore =
      diff.changed.includes('is_active') &&
      diff.before.is_active === false &&
      diff.after.is_active === true;
    await createMasterDataAuditLog({
      actor_id: req.user.id,
      target_type: MASTER_AUDIT_TARGETS.FACULTY,
      target_id: id,
      target_key: updated.code,
      action: isRestore
        ? MASTER_AUDIT_ACTIONS.RESTORE
        : MASTER_AUDIT_ACTIONS.UPDATE,
      before: diff.before,
      after: diff.after,
      ...auditMetaFromReq(req),
    });
  }
  res.json(updated);
}

export async function softDelete(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const before = await findById(id);
  const updated = await softDeleteFaculty(id);
  if (!updated) {
    if (!before) return notFound(res);
    return conflict(res, 'faculty ถูกปิดใช้งานอยู่แล้ว');
  }
  await createMasterDataAuditLog({
    actor_id: req.user.id,
    target_type: MASTER_AUDIT_TARGETS.FACULTY,
    target_id: id,
    target_key: updated.code,
    action: MASTER_AUDIT_ACTIONS.SOFT_DELETE,
    before: { is_active: before.is_active },
    after: { is_active: updated.is_active },
    ...auditMetaFromReq(req),
  });
  res.json(updated);
}
