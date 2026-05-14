import * as cats from '../models/category.model.js';
import {
  createMasterDataAuditLog,
  MASTER_AUDIT_TARGETS,
  MASTER_AUDIT_ACTIONS,
} from '../models/master-data-audit.model.js';
import {
  auditMetaFromReq,
  buildDiff,
} from '../models/activity-audit.model.js';

const CAT_DIFF_FIELDS = ['code', 'name', 'is_active'];

function badRequest(res, message) {
  return res.status(400).json({ status: 'error', message });
}
function conflict(res, message) {
  return res.status(409).json({ status: 'error', message });
}
function notFound(res, message = 'category not found') {
  return res.status(404).json({ status: 'error', message });
}

function parseBoolFlag(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

// schema: code = smallint UNIQUE
function isValidCode(value) {
  return Number.isInteger(value) && value >= 1 && value <= 32767;
}

export async function list(req, res) {
  const isActive = parseBoolFlag(req.query.is_active);
  const q = req.query.q?.trim() || null;
  const items = await cats.listCategories({ isActive, q });
  res.json({ items });
}

export async function getOne(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');
  const item = await cats.findById(id);
  if (!item) return notFound(res);
  res.json(item);
}

export async function create(req, res) {
  const { code, name, is_active = true } = req.body ?? {};

  if (!isValidCode(code)) {
    return badRequest(res, 'code ต้องเป็น integer ≥ 1');
  }
  if (typeof name !== 'string' || !name.trim()) {
    return badRequest(res, 'name ต้องไม่ว่าง');
  }

  const dup = await cats.findByCode(code);
  if (dup) return conflict(res, `code ${code} ซ้ำกับรายการที่มีอยู่`);

  const created = await cats.createCategory({
    code,
    name: name.trim(),
    is_active: !!is_active,
  });
  await createMasterDataAuditLog({
    actor_id: req.user.id,
    target_type: MASTER_AUDIT_TARGETS.CATEGORY,
    target_id: created.id,
    target_key: String(created.code),
    action: MASTER_AUDIT_ACTIONS.CREATE,
    after: {
      code: created.code,
      name: created.name,
      is_active: created.is_active,
    },
    ...auditMetaFromReq(req),
  });
  res.status(201).json(created);
}

export async function update(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const existing = await cats.findById(id);
  if (!existing) return notFound(res);

  const { code, name, is_active } = req.body ?? {};

  if (code !== undefined) {
    if (!isValidCode(code)) return badRequest(res, 'code ต้องเป็น integer ≥ 1');
    if (code !== existing.code) {
      const dup = await cats.findByCode(code);
      if (dup) return conflict(res, `code ${code} ซ้ำกับรายการที่มีอยู่`);
    }
  }
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return badRequest(res, 'name ต้องไม่ว่าง');
  }
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    return badRequest(res, 'is_active ต้องเป็น boolean');
  }

  const updated = await cats.updateCategory(id, {
    code,
    name: name?.trim(),
    is_active,
  });
  const diff = buildDiff(existing, updated, CAT_DIFF_FIELDS);
  if (diff) {
    const isRestore =
      diff.changed.includes('is_active') &&
      diff.before.is_active === false &&
      diff.after.is_active === true;
    await createMasterDataAuditLog({
      actor_id: req.user.id,
      target_type: MASTER_AUDIT_TARGETS.CATEGORY,
      target_id: id,
      target_key: String(updated.code),
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

  const before = await cats.findById(id);
  const updated = await cats.softDeleteCategory(id);
  if (!updated) {
    if (!before) return notFound(res);
    return conflict(res, 'category ถูกปิดใช้งานอยู่แล้ว');
  }
  await createMasterDataAuditLog({
    actor_id: req.user.id,
    target_type: MASTER_AUDIT_TARGETS.CATEGORY,
    target_id: id,
    target_key: String(updated.code),
    action: MASTER_AUDIT_ACTIONS.SOFT_DELETE,
    before: { is_active: before.is_active },
    after: { is_active: updated.is_active },
    ...auditMetaFromReq(req),
  });
  res.json(updated);
}
