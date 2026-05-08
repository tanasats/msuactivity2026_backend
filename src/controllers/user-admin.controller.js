import * as users from '../models/user-admin.model.js';
import * as audit from '../models/user-audit.model.js';
import * as refreshTokens from '../models/refresh-token.model.js';
import { findById as findFacultyById } from '../models/faculty.model.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function badRequest(res, message) {
  return res.status(400).json({ status: 'error', message });
}
function conflict(res, message) {
  return res.status(409).json({ status: 'error', message });
}
function notFound(res, message = 'user not found') {
  return res.status(404).json({ status: 'error', message });
}
function forbidden(res, message) {
  return res.status(403).json({ status: 'error', message });
}

function parseIntInRange(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    return null;
  }
  return n;
}

export async function list(req, res) {
  const limit = parseIntInRange(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = parseIntInRange(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  if (limit === null) return badRequest(res, `limit ต้องอยู่ระหว่าง 1–${MAX_LIMIT}`);
  if (offset === null) return badRequest(res, 'offset ต้องเป็น integer ≥ 0');

  const role = req.query.role?.trim() || null;
  if (role && !users.isValidRole(role)) {
    return badRequest(res, `role ไม่ถูกต้อง: ${role}`);
  }
  const status = req.query.status?.trim() || null;
  if (status && !users.isValidStatus(status)) {
    return badRequest(res, `status ไม่ถูกต้อง: ${status}`);
  }

  // faculty_id = 'null' เพื่อกรองเฉพาะ user ที่ยังไม่มี faculty
  let facultyId = req.query.faculty_id ?? null;
  if (facultyId !== null && facultyId !== 'null') {
    const n = Number(facultyId);
    if (!Number.isInteger(n) || n < 1) {
      return badRequest(res, 'faculty_id ต้องเป็น integer หรือ "null"');
    }
    facultyId = n;
  }

  const q = req.query.q?.trim() || null;

  const result = await users.listUsers({ q, role, facultyId, status, limit, offset });
  res.json({ ...result, limit, offset });
}

export async function getOne(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const item = await users.findById(id);
  if (!item) return notFound(res);
  res.json(item);
}

export async function getAuditLog(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const target = await users.findById(id);
  if (!target) return notFound(res);

  const items = await audit.listForTargetUser(id, { limit: 100 });
  res.json({ items });
}

// ── helpers ──────────────────────────────────────────────────────

// guard: ห้าม super_admin แก้ "ตัวเอง" — กัน lock-out + ผิดพลาดถาวร
function isSelfEdit(req, targetId) {
  return Number(req.user.id) === Number(targetId);
}

// guard: ห้ามทำให้ super_admin ที่ active เหลือ 0 คน
async function wouldRemoveLastSuperAdmin({ target, newRole, newStatus }) {
  // เปลี่ยนเป้าหมายไป "ไม่เป็น" super_admin ที่ active แล้ว
  const willStillBeActiveSuperAdmin =
    (newRole ?? target.role) === 'super_admin' &&
    (newStatus ?? target.status) === 'active';

  // ถ้าเป้าหมายไม่ใช่ active super_admin อยู่แล้ว ไม่กระทบ count
  const wasActiveSuperAdmin =
    target.role === 'super_admin' && target.status === 'active';

  if (!wasActiveSuperAdmin) return false;
  if (willStillBeActiveSuperAdmin) return false;

  const count = await users.countActiveSuperAdmins();
  return count <= 1;
}

function auditMeta(req) {
  return {
    ip: req.ip ?? null,
    user_agent: req.get('user-agent') ?? null,
  };
}

// ── PATCH /:id/role ──────────────────────────────────────────────

export async function updateRole(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const { role } = req.body ?? {};
  if (typeof role !== 'string' || !users.isValidRole(role)) {
    return badRequest(res, 'role ต้องเป็นค่าที่ระบบรู้จัก');
  }

  const target = await users.findById(id);
  if (!target) return notFound(res);

  if (isSelfEdit(req, id)) {
    return forbidden(res, 'ห้ามเปลี่ยน role ของตัวเอง');
  }
  if (target.role === role) {
    return res.json(target); // no-op
  }
  if (await wouldRemoveLastSuperAdmin({ target, newRole: role })) {
    return conflict(res, 'ห้ามลด role ของ super_admin คนสุดท้ายในระบบ');
  }

  const updated = await users.updateRole(id, role);

  await audit.createAuditLog({
    actor_id: req.user.id,
    target_user_id: id,
    action: audit.AUDIT_ACTIONS.ROLE_CHANGE,
    before: { role: target.role },
    after: { role },
    ...auditMeta(req),
  });

  res.json(updated);
}

// ── PATCH /:id/faculty ───────────────────────────────────────────

export async function updateFaculty(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const { faculty_id } = req.body ?? {};
  if (faculty_id !== null && (!Number.isInteger(faculty_id) || faculty_id < 1)) {
    return badRequest(res, 'faculty_id ต้องเป็น integer หรือ null');
  }

  const target = await users.findById(id);
  if (!target) return notFound(res);

  if (faculty_id !== null) {
    const fac = await findFacultyById(faculty_id);
    if (!fac) return badRequest(res, 'faculty_id ไม่พบในระบบ');
    if (!fac.is_active) return badRequest(res, 'faculty นี้ปิดใช้งานอยู่');
  }

  if (target.faculty_id === faculty_id) {
    return res.json(target);
  }

  const updated = await users.updateFacultyId(id, faculty_id);

  await audit.createAuditLog({
    actor_id: req.user.id,
    target_user_id: id,
    action: audit.AUDIT_ACTIONS.FACULTY_CHANGE,
    before: { faculty_id: target.faculty_id, faculty_name: target.faculty_name },
    after: { faculty_id: updated.faculty_id, faculty_name: updated.faculty_name },
    ...auditMeta(req),
  });

  res.json(updated);
}

// ── PATCH /:id/status ────────────────────────────────────────────

export async function updateStatus(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return badRequest(res, 'invalid id');

  const { status } = req.body ?? {};
  if (typeof status !== 'string' || !users.isValidStatus(status)) {
    return badRequest(res, 'status ต้องเป็น "active" หรือ "disabled"');
  }

  const target = await users.findById(id);
  if (!target) return notFound(res);

  if (isSelfEdit(req, id)) {
    return forbidden(res, 'ห้ามเปลี่ยน status ของตัวเอง');
  }
  if (target.status === status) {
    return res.json(target);
  }
  if (await wouldRemoveLastSuperAdmin({ target, newStatus: status })) {
    return conflict(res, 'ห้ามปิดบัญชี super_admin คนสุดท้ายในระบบ');
  }

  const updated = await users.updateStatus(id, status);

  // disable → revoke refresh tokens ทั้งหมด เพื่อตัด session ที่ค้าง
  // (access token เดิมยังใช้ได้สูงสุด 15 นาที — ยอมรับได้ตาม TTL ของ JWT)
  if (status === 'disabled') {
    await refreshTokens.revokeAllForUser(id);
  }

  await audit.createAuditLog({
    actor_id: req.user.id,
    target_user_id: id,
    action: audit.AUDIT_ACTIONS.STATUS_CHANGE,
    before: { status: target.status },
    after: { status },
    ...auditMeta(req),
  });

  res.json(updated);
}
