import * as model from '../models/message-thread.model.js';
import { emit } from '../services/notification.service.js';

const preview = (s) => (s.length > 80 ? `${s.slice(0, 80)}…` : s);

function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
function readBody(raw, max = 2000) {
  return (typeof raw === 'string' ? raw.trim() : '').slice(0, max);
}

// ── faculty ─────────────────────────────────────────────────────

// POST /api/faculty/message-threads  { subject, body }
export async function facultyCreate(req, res) {
  const subject = readBody(req.body?.subject, 200);
  const body = readBody(req.body?.body);
  if (!subject) return res.status(400).json({ status: 'error', message: 'ต้องระบุหัวข้อ' });
  if (!body) return res.status(400).json({ status: 'error', message: 'ต้องระบุข้อความ' });

  const { thread, message } = await model.createThread({
    subject,
    body,
    createdBy: req.user.id,
    facultyId: req.user.faculty_id,
  });
  await model.markRead(thread.id, req.user.id); // ผู้เปิดถือว่าอ่านแล้ว
  emit('message.to_admins', {
    threadId: thread.id,
    subject,
    messageId: message.id,
    preview: preview(body),
  });
  res.status(201).json({ status: 'ok', thread_id: thread.id });
}

// GET /api/faculty/message-threads
export async function facultyList(req, res) {
  const items = await model.listForFaculty(req.user.id);
  res.json({ items });
}

// GET /api/faculty/message-threads/:id
export async function facultyGetThread(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ status: 'error', message: 'invalid id' });
  const thread = await model.getThread(id);
  if (!thread) return res.status(404).json({ status: 'error', message: 'ไม่พบบทสนทนา' });
  if (thread.created_by !== req.user.id) {
    return res.status(403).json({ status: 'error', message: 'ไม่มีสิทธิ์เข้าถึง' });
  }
  const messages = await model.getMessages(id);
  await model.markRead(id, req.user.id);
  res.json({ thread, messages });
}

// POST /api/faculty/message-threads/:id/messages  { body }
export async function facultyReply(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ status: 'error', message: 'invalid id' });
  const body = readBody(req.body?.body);
  if (!body) return res.status(400).json({ status: 'error', message: 'ต้องระบุข้อความ' });
  const thread = await model.getThread(id);
  if (!thread) return res.status(404).json({ status: 'error', message: 'ไม่พบบทสนทนา' });
  if (thread.created_by !== req.user.id) {
    return res.status(403).json({ status: 'error', message: 'ไม่มีสิทธิ์เข้าถึง' });
  }
  const { message } = await model.addMessage({ threadId: id, senderId: req.user.id, body });
  await model.markRead(id, req.user.id);
  emit('message.to_admins', {
    threadId: id,
    subject: thread.subject,
    messageId: message.id,
    preview: preview(body),
  });
  res.json({ status: 'ok' });
}

// ── admin / super_admin ─────────────────────────────────────────

// GET /api/admin/message-threads?status=&q=&limit=&offset=
export async function adminList(req, res) {
  const status = req.query.status === 'OPEN' || req.query.status === 'RESOLVED' ? req.query.status : null;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() || null : null;
  let limit = Number.parseInt(req.query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = 50;
  if (limit > 100) limit = 100;
  let offset = Number.parseInt(req.query.offset, 10);
  if (!Number.isInteger(offset) || offset < 0) offset = 0;
  const items = await model.listForAdmin(req.user.id, { status, q, limit, offset });
  res.json({ items });
}

// GET /api/admin/message-threads/:id
export async function adminGetThread(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ status: 'error', message: 'invalid id' });
  const thread = await model.getThread(id);
  if (!thread) return res.status(404).json({ status: 'error', message: 'ไม่พบบทสนทนา' });
  const messages = await model.getMessages(id);
  await model.markRead(id, req.user.id);
  res.json({ thread, messages });
}

// POST /api/admin/message-threads/:id/messages  { body }
export async function adminReply(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ status: 'error', message: 'invalid id' });
  const body = readBody(req.body?.body);
  if (!body) return res.status(400).json({ status: 'error', message: 'ต้องระบุข้อความ' });
  const thread = await model.getThread(id);
  if (!thread) return res.status(404).json({ status: 'error', message: 'ไม่พบบทสนทนา' });
  const { message } = await model.addMessage({ threadId: id, senderId: req.user.id, body });
  await model.markRead(id, req.user.id);
  emit('message.to_faculty', {
    threadId: id,
    subject: thread.subject,
    messageId: message.id,
    createdBy: thread.created_by,
    preview: preview(body),
  });
  res.json({ status: 'ok' });
}

// POST /api/admin/message-threads/:id/resolve
export async function adminResolve(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ status: 'error', message: 'invalid id' });
  const r = await model.resolve(id, req.user.id);
  if (!r) return res.status(409).json({ status: 'error', message: 'ปิดได้เฉพาะบทสนทนาที่ยังเปิดอยู่' });
  res.json({ status: 'ok' });
}
