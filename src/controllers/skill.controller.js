import * as skills from '../models/skill.model.js';

// รหัสทักษะตามแม่แบบ S1, S2, ... (memory: project_master_data) — ขยายเลขได้ ไม่จำกัดจำนวนหลัก
const CODE_REGEX = /^S\d{1,3}$/;

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

export async function list(req, res) {
  const isActive = parseBoolFlag(req.query.is_active);
  const q = req.query.q?.trim() || null;
  const items = await skills.listSkills({ isActive, q });
  res.json({ items });
}

export async function getOne(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');
  const item = await skills.findById(id);
  if (!item) return notFound(res);
  res.json(item);
}

export async function create(req, res) {
  const { code, name, is_active = true } = req.body ?? {};

  if (typeof code !== 'string' || !CODE_REGEX.test(code)) {
    return badRequest(res, 'code ต้องเป็นรูปแบบ S ตามด้วยตัวเลข (เช่น S1, S12)');
  }
  if (typeof name !== 'string' || !name.trim()) {
    return badRequest(res, 'name ต้องไม่ว่าง');
  }

  const dup = await skills.findByCode(code);
  if (dup) return conflict(res, `code "${code}" ซ้ำกับรายการที่มีอยู่`);

  const created = await skills.createSkill({
    code,
    name: name.trim(),
    is_active: !!is_active,
  });
  res.status(201).json(created);
}

export async function update(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const existing = await skills.findById(id);
  if (!existing) return notFound(res);

  const { code, name, is_active } = req.body ?? {};

  if (code !== undefined) {
    if (typeof code !== 'string' || !CODE_REGEX.test(code)) {
      return badRequest(res, 'code ต้องเป็นรูปแบบ S ตามด้วยตัวเลข');
    }
    if (code !== existing.code) {
      const dup = await skills.findByCode(code);
      if (dup) return conflict(res, `code "${code}" ซ้ำกับรายการที่มีอยู่`);
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
  res.json(updated);
}

export async function softDelete(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const updated = await skills.softDeleteSkill(id);
  if (!updated) {
    const exists = await skills.findById(id);
    if (!exists) return notFound(res);
    return conflict(res, 'skill ถูกปิดใช้งานอยู่แล้ว');
  }
  res.json(updated);
}
