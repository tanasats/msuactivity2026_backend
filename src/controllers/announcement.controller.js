import * as ann from '../models/announcement.model.js';

const MAX_BODY = 4000;
const MAX_TITLE = 200;
const MAX_LINK = 500;
const MAX_LINK_LABEL = 100;

function err(res, status, message) {
  return res.status(status).json({ status: 'error', message });
}

function parseDateTime(v) {
  if (v === null || v === '' || v === undefined) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

// validate payload — return { ok:true, value } or { ok:false, message }
//   isCreate=true: required fields ต้องครบ
//   isCreate=false (patch): field ที่ undefined = ไม่แก้
function normalizePayload(body, isCreate) {
  const out = {};

  if (isCreate || body.kind !== undefined) {
    if (!ann.isValidKind(body.kind))
      return { ok: false, message: 'kind ต้องเป็น BANNER หรือ POPUP' };
    out.kind = body.kind;
  }

  if (isCreate || body.severity !== undefined) {
    const sev = body.severity ?? 'INFO';
    if (!ann.isValidSeverity(sev))
      return { ok: false, message: 'severity ต้องเป็น INFO/WARNING/DANGER' };
    out.severity = sev;
  }

  if (isCreate || body.body !== undefined) {
    if (typeof body.body !== 'string' || !body.body.trim())
      return { ok: false, message: 'body (เนื้อหา) ต้องไม่ว่าง' };
    if (body.body.length > MAX_BODY)
      return { ok: false, message: `body ยาวเกิน ${MAX_BODY} ตัวอักษร` };
    out.body = body.body.trim();
  }

  if (body.title !== undefined) {
    if (body.title === null || body.title === '') {
      out.title = null;
    } else if (typeof body.title !== 'string') {
      return { ok: false, message: 'title ต้องเป็น string หรือ null' };
    } else if (body.title.length > MAX_TITLE) {
      return { ok: false, message: `title ยาวเกิน ${MAX_TITLE} ตัวอักษร` };
    } else {
      out.title = body.title.trim() || null;
    }
  }

  if (body.link_url !== undefined) {
    if (body.link_url === null || body.link_url === '') {
      out.link_url = null;
    } else if (typeof body.link_url !== 'string') {
      return { ok: false, message: 'link_url ต้องเป็น string หรือ null' };
    } else if (body.link_url.length > MAX_LINK) {
      return { ok: false, message: `link_url ยาวเกิน ${MAX_LINK}` };
    } else if (!/^https?:\/\/|^\//.test(body.link_url.trim())) {
      return {
        ok: false,
        message: 'link_url ต้องขึ้นต้นด้วย http(s):// หรือ /',
      };
    } else {
      out.link_url = body.link_url.trim();
    }
  }

  if (body.link_label !== undefined) {
    if (body.link_label === null || body.link_label === '') {
      out.link_label = null;
    } else if (typeof body.link_label !== 'string') {
      return { ok: false, message: 'link_label ต้องเป็น string หรือ null' };
    } else if (body.link_label.length > MAX_LINK_LABEL) {
      return { ok: false, message: `link_label ยาวเกิน ${MAX_LINK_LABEL}` };
    } else {
      out.link_label = body.link_label.trim() || null;
    }
  }

  for (const f of ['starts_at', 'ends_at']) {
    if (body[f] !== undefined) {
      const parsed = parseDateTime(body[f]);
      if (parsed === undefined)
        return { ok: false, message: `${f} ไม่ใช่วันที่ที่ถูกต้อง` };
      out[f] = parsed;
    }
  }
  if (out.starts_at && out.ends_at && new Date(out.starts_at) >= new Date(out.ends_at)) {
    return { ok: false, message: 'starts_at ต้องอยู่ก่อน ends_at' };
  }

  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean')
      return { ok: false, message: 'is_active ต้องเป็น boolean' };
    out.is_active = body.is_active;
  }

  return { ok: true, value: out };
}

// ── PUBLIC ───────────────────────────────────────────────────────

// GET /api/public/announcements — visible เท่านั้น
export async function listPublic(req, res) {
  const items = await ann.listVisible();
  // ตัด field ที่ไม่จำเป็นต่อ public — กัน leak (created_by, updated_by, is_active เพราะกรองแล้ว)
  const sanitized = items.map((a) => ({
    id: a.id,
    kind: a.kind,
    severity: a.severity,
    title: a.title,
    body: a.body,
    link_url: a.link_url,
    link_label: a.link_label,
  }));
  res.json({ items: sanitized });
}

// ── ADMIN ────────────────────────────────────────────────────────

// GET /api/admin/announcements
export async function listAdmin(req, res) {
  const items = await ann.listAll({ limit: 200, offset: 0 });
  res.json({ items });
}

// GET /api/admin/announcements/:id
export async function getOne(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');
  const item = await ann.findById(id);
  if (!item) return err(res, 404, 'announcement not found');
  res.json(item);
}

// POST /api/admin/announcements
export async function create(req, res) {
  const v = normalizePayload(req.body || {}, true);
  if (!v.ok) return err(res, 400, v.message);
  const id = await ann.createAnnouncement(v.value, req.user.id);
  const created = await ann.findById(id);
  res.status(201).json(created);
}

// PATCH /api/admin/announcements/:id
export async function update(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');
  const existing = await ann.findById(id);
  if (!existing) return err(res, 404, 'announcement not found');

  const v = normalizePayload(req.body || {}, false);
  if (!v.ok) return err(res, 400, v.message);

  const updated = await ann.updateAnnouncement(id, v.value, req.user.id);
  res.json(updated);
}

// DELETE /api/admin/announcements/:id
export async function remove(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');
  const deleted = await ann.deleteAnnouncement(id);
  if (!deleted) return err(res, 404, 'announcement not found');
  res.status(204).end();
}
