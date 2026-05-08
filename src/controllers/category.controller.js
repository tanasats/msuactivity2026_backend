import * as cats from '../models/category.model.js';

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
  res.json(updated);
}

export async function softDelete(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const updated = await cats.softDeleteCategory(id);
  if (!updated) {
    const exists = await cats.findById(id);
    if (!exists) return notFound(res);
    return conflict(res, 'category ถูกปิดใช้งานอยู่แล้ว');
  }
  res.json(updated);
}
