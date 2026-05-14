import * as orgs from '../models/organization.model.js';
import {
  createMasterDataAuditLog,
  MASTER_AUDIT_TARGETS,
  MASTER_AUDIT_ACTIONS,
} from '../models/master-data-audit.model.js';
import {
  auditMetaFromReq,
  buildDiff,
} from '../models/activity-audit.model.js';

const CODE_REGEX = /^[A-Z0-9]{4}$/;
const ORG_DIFF_FIELDS = ['code', 'name', 'parent_id', 'is_active'];

function badRequest(res, message) {
  return res.status(400).json({ status: 'error', message });
}
function conflict(res, message) {
  return res.status(409).json({ status: 'error', message });
}
function notFound(res, message = 'organization not found') {
  return res.status(404).json({ status: 'error', message });
}

function parseBoolFlag(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export async function list(req, res) {
  const isActive = parseBoolFlag(req.query.is_active);
  const parentId = req.query.parent_id ?? null; // ส่ง 'null' เพื่อกรอง root nodes
  const q = req.query.q?.trim() || null;

  const items = await orgs.listOrganizations({ isActive, parentId, q });
  res.json({ items });
}

export async function getOne(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const item = await orgs.findById(id);
  if (!item) return notFound(res);
  res.json(item);
}

export async function create(req, res) {
  const { code, name, parent_id = null, is_active = true } = req.body ?? {};

  if (typeof code !== 'string' || !CODE_REGEX.test(code)) {
    return badRequest(res, 'code ต้องเป็นตัวอักษร/ตัวเลขพิมพ์ใหญ่ 4 ตัว (เช่น A001)');
  }
  if (typeof name !== 'string' || !name.trim()) {
    return badRequest(res, 'name ต้องไม่ว่าง');
  }
  if (parent_id !== null) {
    if (!Number.isInteger(parent_id) || parent_id < 1) {
      return badRequest(res, 'parent_id ต้องเป็น integer หรือ null');
    }
    const parent = await orgs.findById(parent_id);
    if (!parent) return badRequest(res, 'parent_id ไม่พบในระบบ');
  }

  const existing = await orgs.findByCode(code);
  if (existing) return conflict(res, `code "${code}" ซ้ำกับรายการที่มีอยู่`);

  const created = await orgs.createOrganization({
    code,
    name: name.trim(),
    parent_id,
    is_active: !!is_active,
  });
  await createMasterDataAuditLog({
    actor_id: req.user.id,
    target_type: MASTER_AUDIT_TARGETS.ORGANIZATION,
    target_id: created.id,
    target_key: created.code,
    action: MASTER_AUDIT_ACTIONS.CREATE,
    after: {
      code: created.code,
      name: created.name,
      parent_id: created.parent_id,
      is_active: created.is_active,
    },
    ...auditMetaFromReq(req),
  });
  res.status(201).json(created);
}

export async function update(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const existing = await orgs.findById(id);
  if (!existing) return notFound(res);

  const { code, name, parent_id, is_active } = req.body ?? {};

  if (code !== undefined) {
    if (typeof code !== 'string' || !CODE_REGEX.test(code)) {
      return badRequest(res, 'code ต้องเป็นตัวอักษร/ตัวเลขพิมพ์ใหญ่ 4 ตัว');
    }
    if (code !== existing.code) {
      const dup = await orgs.findByCode(code);
      if (dup) return conflict(res, `code "${code}" ซ้ำกับรายการที่มีอยู่`);
    }
  }
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return badRequest(res, 'name ต้องไม่ว่าง');
  }
  if (parent_id !== undefined && parent_id !== null) {
    if (!Number.isInteger(parent_id) || parent_id < 1) {
      return badRequest(res, 'parent_id ต้องเป็น integer หรือ null');
    }
    const parent = await orgs.findById(parent_id);
    if (!parent) return badRequest(res, 'parent_id ไม่พบในระบบ');
    if (await orgs.wouldCreateCycle(id, parent_id)) {
      return badRequest(res, 'parent_id จะสร้าง cycle ใน hierarchy');
    }
  }
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    return badRequest(res, 'is_active ต้องเป็น boolean');
  }

  const updated = await orgs.updateOrganization(id, {
    code,
    name: name?.trim(),
    parent_id,
    is_active,
  });
  const diff = buildDiff(existing, updated, ORG_DIFF_FIELDS);
  if (diff) {
    // ตรวจ RESTORE (false → true) แยกออกจาก UPDATE ทั่วไป — เพื่อ filter ง่ายตอนดู history
    const isRestore =
      diff.changed.includes('is_active') &&
      diff.before.is_active === false &&
      diff.after.is_active === true;
    await createMasterDataAuditLog({
      actor_id: req.user.id,
      target_type: MASTER_AUDIT_TARGETS.ORGANIZATION,
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

  const before = await orgs.findById(id);
  const updated = await orgs.softDeleteOrganization(id);
  if (!updated) {
    if (!before) return notFound(res);
    return conflict(res, 'organization ถูกปิดใช้งานอยู่แล้ว');
  }
  await createMasterDataAuditLog({
    actor_id: req.user.id,
    target_type: MASTER_AUDIT_TARGETS.ORGANIZATION,
    target_id: id,
    target_key: updated.code,
    action: MASTER_AUDIT_ACTIONS.SOFT_DELETE,
    before: { is_active: before.is_active },
    after: { is_active: updated.is_active },
    ...auditMetaFromReq(req),
  });
  res.json(updated);
}
