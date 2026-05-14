import * as skills from '../models/skill.model.js';
import {
  createMasterDataAuditLog,
  MASTER_AUDIT_TARGETS,
  MASTER_AUDIT_ACTIONS,
} from '../models/master-data-audit.model.js';
import {
  auditMetaFromReq,
  buildDiff,
} from '../models/activity-audit.model.js';

const SKILL_DIFF_FIELDS = ['code', 'name', 'is_active'];

// build target_key สำหรับ skill: parent → "S1", child → "2569/S1/K1"
function skillKey(s) {
  if (s.parent_id === null) return s.code;
  return `${s.academic_year}/${s.parent_code ?? s.parent_id}/${s.code}`;
}

// code format:
//   parent: S + digits (S1, S12, S123) — ตามแม่แบบเดิม
//   child:  อิสระ — super_admin ตั้งให้เข้าใจง่ายในปีนั้น ๆ (เช่น S1-K1, T01, A) จำกัด 1-20 char
const PARENT_CODE_REGEX = /^S\d{1,3}$/;
const CHILD_CODE_REGEX = /^[A-Za-z0-9._-]{1,20}$/;

function badRequest(res, message) {
  return res.status(400).json({ status: 'error', message });
}
function conflict(res, message) {
  return res.status(409).json({ status: 'error', message });
}
function notFound(res, message = 'skill not found') {
  return res.status(404).json({ status: 'error', message });
}

function parseBoolFlag(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function parseYear(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 2500 || n > 2700) return null;
  return n;
}

function parseId(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseScope(raw) {
  if (raw === 'parent' || raw === 'child' || raw === 'all') return raw;
  return null;
}

// GET /api/skills
//   query:
//     scope=parent|child|all     (default 'all' — backward compat)
//     parent_id=<int>            กรอง child ของ parent นี้
//     academic_year=<BE>         กรอง child ของปี
//     is_active=true|false
//     q=<keyword>
//
//   หมายเหตุ: ActivityForm จะเรียก `?scope=child&academic_year=2569&is_active=true`
//   เพื่อรับเฉพาะ child ของปีนั้น (ใช้แสดง dropdown ทักษะที่จะได้รับ)
export async function list(req, res) {
  const isActive = parseBoolFlag(req.query.is_active);
  const q = req.query.q?.trim() || null;
  const scope = parseScope(req.query.scope) ?? 'all';
  const parentId = parseId(req.query.parent_id);
  const academicYear = parseYear(req.query.academic_year);

  const items = await skills.listSkills({
    scope,
    parentId,
    academicYear,
    isActive,
    q,
  });
  res.json({ items });
}

export async function getOne(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');
  const item = await skills.findById(id);
  if (!item) return notFound(res);
  res.json(item);
}

// POST /api/skills
//   body parent  = { code: 'S6', name: '...' }
//   body child   = { code, name, parent_id, academic_year }
export async function create(req, res) {
  const {
    code,
    name,
    parent_id,
    academic_year,
    is_active = true,
  } = req.body ?? {};

  if (typeof name !== 'string' || !name.trim()) {
    return badRequest(res, 'name ต้องไม่ว่าง');
  }

  // หา type จาก parent_id: ถ้าส่ง parent_id → child, ไม่ส่ง → parent
  const isChild =
    parent_id !== undefined && parent_id !== null && parent_id !== '';

  if (isChild) {
    const parentIdNum = Number(parent_id);
    if (!Number.isInteger(parentIdNum) || parentIdNum < 1) {
      return badRequest(res, 'parent_id ไม่ถูกต้อง');
    }
    const yearNum = parseYear(academic_year);
    if (yearNum === null) {
      return badRequest(res, 'academic_year ต้องเป็น พ.ศ. (เช่น 2569)');
    }
    if (typeof code !== 'string' || !CHILD_CODE_REGEX.test(code)) {
      return badRequest(
        res,
        'code ของ child ต้องเป็น A-Z/0-9/._- ยาว 1-20 ตัว',
      );
    }
    const parent = await skills.findById(parentIdNum);
    if (!parent) return badRequest(res, 'parent skill ไม่พบ');
    if (parent.parent_id !== null)
      return badRequest(res, 'parent_id ต้องชี้ไปที่รายการแม่ (root) เท่านั้น');
    if (!parent.is_active)
      return badRequest(res, 'parent skill ถูกปิดใช้งาน');

    const dup = await skills.findChildByKey({
      parentId: parentIdNum,
      academicYear: yearNum,
      code,
    });
    if (dup)
      return conflict(
        res,
        `code "${code}" ซ้ำใน parent นี้ ปี ${yearNum} แล้ว`,
      );

    const created = await skills.createSkill({
      code,
      name: name.trim(),
      parent_id: parentIdNum,
      academic_year: yearNum,
      is_active: !!is_active,
    });
    await createMasterDataAuditLog({
      actor_id: req.user.id,
      target_type: MASTER_AUDIT_TARGETS.SKILL,
      target_id: created.id,
      target_key: `${yearNum}/${parent.code}/${created.code}`,
      action: MASTER_AUDIT_ACTIONS.CREATE,
      after: {
        code: created.code,
        name: created.name,
        parent_id: created.parent_id,
        academic_year: created.academic_year,
        is_active: created.is_active,
      },
      note: 'child',
      ...auditMetaFromReq(req),
    });
    return res.status(201).json(created);
  }

  // parent
  if (typeof code !== 'string' || !PARENT_CODE_REGEX.test(code)) {
    return badRequest(res, 'code parent ต้องเป็นรูปแบบ S ตามด้วยตัวเลข (S1, S12)');
  }
  const dup = await skills.findParentByCode(code);
  if (dup) return conflict(res, `code "${code}" ซ้ำกับรายการแม่ที่มีอยู่`);

  const created = await skills.createSkill({
    code,
    name: name.trim(),
    parent_id: null,
    academic_year: null,
    is_active: !!is_active,
  });
  await createMasterDataAuditLog({
    actor_id: req.user.id,
    target_type: MASTER_AUDIT_TARGETS.SKILL,
    target_id: created.id,
    target_key: created.code,
    action: MASTER_AUDIT_ACTIONS.CREATE,
    after: {
      code: created.code,
      name: created.name,
      is_active: created.is_active,
    },
    note: 'parent',
    ...auditMetaFromReq(req),
  });
  res.status(201).json(created);
}

export async function update(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const existing = await skills.findById(id);
  if (!existing) return notFound(res);

  const { code, name, is_active } = req.body ?? {};
  const isChild = existing.parent_id !== null;

  if (code !== undefined) {
    if (typeof code !== 'string') {
      return badRequest(res, 'code ต้องเป็นตัวอักษร');
    }
    if (isChild) {
      if (!CHILD_CODE_REGEX.test(code))
        return badRequest(
          res,
          'code child ต้องเป็น A-Z/0-9/._- ยาว 1-20 ตัว',
        );
      if (code !== existing.code) {
        const dup = await skills.findChildByKey({
          parentId: existing.parent_id,
          academicYear: existing.academic_year,
          code,
        });
        if (dup)
          return conflict(
            res,
            `code "${code}" ซ้ำใน parent นี้ ปี ${existing.academic_year} แล้ว`,
          );
      }
    } else {
      if (!PARENT_CODE_REGEX.test(code))
        return badRequest(res, 'code parent ต้องเป็นรูปแบบ S ตามด้วยตัวเลข');
      if (code !== existing.code) {
        const dup = await skills.findParentByCode(code);
        if (dup) return conflict(res, `code "${code}" ซ้ำกับรายการแม่ที่มีอยู่`);
      }
    }
  }
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return badRequest(res, 'name ต้องไม่ว่าง');
  }
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    return badRequest(res, 'is_active ต้องเป็น boolean');
  }

  const updated = await skills.updateSkill(id, {
    code,
    name: name?.trim(),
    is_active,
  });
  const diff = buildDiff(existing, updated, SKILL_DIFF_FIELDS);
  if (diff) {
    const isRestore =
      diff.changed.includes('is_active') &&
      diff.before.is_active === false &&
      diff.after.is_active === true;
    await createMasterDataAuditLog({
      actor_id: req.user.id,
      target_type: MASTER_AUDIT_TARGETS.SKILL,
      target_id: id,
      target_key: skillKey({ ...updated, parent_code: existing.parent_code }),
      action: isRestore
        ? MASTER_AUDIT_ACTIONS.RESTORE
        : MASTER_AUDIT_ACTIONS.UPDATE,
      before: diff.before,
      after: diff.after,
      note: isChild ? 'child' : 'parent',
      ...auditMetaFromReq(req),
    });
  }
  res.json(updated);
}

export async function softDelete(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const before = await skills.findById(id);
  const updated = await skills.softDeleteSkill(id);
  if (!updated) {
    if (!before) return notFound(res);
    return conflict(res, 'skill ถูกปิดใช้งานอยู่แล้ว');
  }
  await createMasterDataAuditLog({
    actor_id: req.user.id,
    target_type: MASTER_AUDIT_TARGETS.SKILL,
    target_id: id,
    target_key: skillKey({ ...updated, parent_code: before.parent_code }),
    action: MASTER_AUDIT_ACTIONS.SOFT_DELETE,
    before: { is_active: before.is_active },
    after: { is_active: updated.is_active },
    note: before.parent_id === null ? 'parent' : 'child',
    ...auditMetaFromReq(req),
  });
  res.json(updated);
}
