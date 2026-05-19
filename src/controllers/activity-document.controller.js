import crypto from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import * as docs from '../models/activity-document.model.js';
import { findById as findActivity } from '../models/faculty-activity.model.js';
import { deleteObject, getPresignedGetUrl, putObject } from '../utils/s3.js';

// document rules (per memory project_files):
//   - mime: pdf, doc, docx, xls, xlsx
//   - max size: 20 MB
//   - max count: 20 ไฟล์/กิจกรรม
//   - status ของ activity ต้องเป็น DRAFT หรือ WORK
//   - เฉพาะผู้สร้าง (created_by = self)
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_COUNT = 20;
const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const EXT_BY_MIME = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};
const MUTABLE_STATUSES = new Set(['DRAFT', 'WORK']);

function err(res, status, message) {
  return res.status(status).json({ status: 'error', message });
}

// ตรวจ activity exists + เป็นเจ้าของ + status เปิดให้แก้
async function ensureMutable(req, res) {
  const activityId = Number(req.params.id);
  if (!Number.isInteger(activityId) || activityId < 1) {
    err(res, 400, 'invalid activity id');
    return null;
  }
  const activity = await findActivity(activityId);
  if (!activity) {
    err(res, 404, 'activity not found');
    return null;
  }
  if (activity.status === 'DELETED') {
    err(res, 409, 'กิจกรรมถูกลบแล้ว');
    return null;
  }
  if (activity.created_by !== req.user.id) {
    err(res, 403, 'จัดการเอกสารได้เฉพาะผู้สร้างกิจกรรม');
    return null;
  }
  if (!MUTABLE_STATUSES.has(activity.status)) {
    err(
      res,
      409,
      `สถานะ ${activity.status} ไม่อนุญาตให้จัดการเอกสาร (ต้องเป็น DRAFT หรือ WORK)`,
    );
    return null;
  }
  return { activity, activityId };
}

// แปะ presigned URL ทุกแถว — TTL 1 ชม.
async function decorateUrls(rows) {
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      url: await getPresignedGetUrl(r.storage_key),
    })),
  );
}

// GET /api/faculty/activities/:id/documents
// faculty staff คณะเดียวกันอ่านได้ — แต่ scope check ทำตรงนี้แบบเดียวกับ activity detail
export async function list(req, res) {
  const activityId = Number(req.params.id);
  if (!Number.isInteger(activityId) || activityId < 1)
    return err(res, 400, 'invalid activity id');
  const activity = await findActivity(activityId);
  if (!activity) return err(res, 404, 'activity not found');
  if (activity.created_by_faculty_id !== req.user.faculty_id)
    return err(res, 403, 'ไม่มีสิทธิ์เข้าถึงกิจกรรมนี้');

  const rows = await docs.listDocuments(activityId);
  const items = await decorateUrls(rows);
  res.json({ items });
}

// POST /api/faculty/activities/:id/documents
// multipart: file + display_name? + is_public?
export async function upload(req, res) {
  const ctx = await ensureMutable(req, res);
  if (!ctx) return;

  if (!req.file) return err(res, 400, 'ไม่พบไฟล์ใน field "file"');

  const { buffer, originalname, size } = req.file;
  if (size <= 0 || size > MAX_BYTES) {
    return err(
      res,
      400,
      `ขนาดไฟล์ต้องอยู่ระหว่าง 1 byte และ ${Math.round(MAX_BYTES / 1024 / 1024)} MB`,
    );
  }

  // count limit
  const existing = await docs.listDocuments(ctx.activityId);
  if (existing.length >= MAX_COUNT) {
    return err(res, 409, `เอกสารต่อกิจกรรมเกิน ${MAX_COUNT} ไฟล์ ลบอันเก่าก่อน`);
  }

  // detect mime จาก magic bytes
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_MIMES.has(detected.mime)) {
    return err(res, 400, 'อนุญาตเฉพาะไฟล์ PDF, DOC/DOCX, XLS/XLSX');
  }
  const ext = EXT_BY_MIME[detected.mime];
  const key = `documents/${crypto.randomUUID()}.${ext}`;

  try {
    await putObject({ key, body: buffer, contentType: detected.mime });
  } catch (e) {
    console.error('[doc upload] s3 put failed', e);
    return err(res, 502, 'อัปโหลดไม่สำเร็จ — ลองใหม่อีกครั้ง');
  }

  // optional display_name + is_public จาก body (multer ใส่ใน req.body จาก fields อื่นใน multipart)
  const displayName =
    typeof req.body?.display_name === 'string' && req.body.display_name.trim()
      ? req.body.display_name.trim()
      : null;
  const isPublic = req.body?.is_public === 'true' || req.body?.is_public === true;

  let row;
  try {
    row = await docs.createDocument({
      activity_id: ctx.activityId,
      filename: originalname,
      display_name: displayName,
      mime_type: detected.mime,
      size_bytes: size,
      storage_key: key,
      is_public: isPublic,
      uploaded_by: req.user.id,
    });
  } catch (dbErr) {
    deleteObject(key); // cleanup orphan
    throw dbErr;
  }

  const url = await getPresignedGetUrl(key);
  res.status(201).json({ ...row, url });
}

// PATCH /api/faculty/activities/:id/documents/:fileId
// body: { display_name?: string|null, is_public?: boolean }
export async function patch(req, res) {
  const ctx = await ensureMutable(req, res);
  if (!ctx) return;

  const fileId = Number(req.params.fileId);
  if (!Number.isInteger(fileId) || fileId < 1) return err(res, 400, 'invalid file id');

  const existing = await docs.findDocumentById(ctx.activityId, fileId);
  if (!existing) return err(res, 404, 'เอกสารไม่พบ');

  const { display_name, is_public } = req.body || {};

  // validation
  let nextDisplayName;
  if (display_name !== undefined) {
    if (display_name === null) {
      nextDisplayName = null;
    } else if (typeof display_name === 'string') {
      const trimmed = display_name.trim();
      nextDisplayName = trimmed === '' ? null : trimmed;
    } else {
      return err(res, 400, 'display_name ต้องเป็น string หรือ null');
    }
  }
  if (is_public !== undefined && typeof is_public !== 'boolean') {
    return err(res, 400, 'is_public ต้องเป็น boolean');
  }

  const updated = await docs.updateDocument(fileId, {
    display_name: nextDisplayName,
    is_public,
  });
  const url = await getPresignedGetUrl(updated.storage_key);
  res.json({ ...updated, url });
}

// DELETE /api/faculty/activities/:id/documents/:fileId
export async function remove(req, res) {
  const ctx = await ensureMutable(req, res);
  if (!ctx) return;

  const fileId = Number(req.params.fileId);
  if (!Number.isInteger(fileId) || fileId < 1) return err(res, 400, 'invalid file id');

  const deleted = await docs.deleteDocument(fileId);
  if (!deleted) return err(res, 404, 'เอกสารไม่พบ');

  // best-effort delete object ใน MinIO หลัง DB row หาย
  deleteObject(deleted.storage_key);
  res.status(204).end();
}
