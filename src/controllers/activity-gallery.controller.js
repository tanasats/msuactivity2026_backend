import crypto from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import * as gallery from '../models/activity-gallery.model.js';
import { findById as findActivity } from '../models/faculty-activity.model.js';
import { deleteObject, getPresignedGetUrl, putObject } from '../utils/s3.js';

// gallery rules:
//   - mime: jpg / png / webp (image only)
//   - max size: 5 MB
//   - max count: 10 รูป/กิจกรรม
//   - status: WORK เท่านั้น (กิจกรรมที่กำลังดำเนินการ)
//   - manageable: เฉพาะผู้สร้าง (created_by = self)
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_COUNT = 10;
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MUTABLE_STATUSES = new Set(['WORK']);

function err(res, status, message) {
  return res.status(status).json({ status: 'error', message });
}

// ตรวจ activity exists + เป็นเจ้าของ + status WORK
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
  if (activity.created_by !== req.user.id) {
    err(res, 403, 'จัดการรูปประกอบได้เฉพาะผู้สร้างกิจกรรม');
    return null;
  }
  if (!MUTABLE_STATUSES.has(activity.status)) {
    err(
      res,
      409,
      `เพิ่ม/ลบรูปประกอบได้เฉพาะตอนกิจกรรมอยู่ในสถานะ "ดำเนินการ" (WORK)`,
    );
    return null;
  }
  return { activity, activityId };
}

// แปะ presigned URL ทุกแถว
async function decorateUrls(rows) {
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      url: await getPresignedGetUrl(r.storage_key),
    })),
  );
}

// GET /api/faculty/activities/:id/gallery
// เปิดให้ faculty staff คณะเดียวกันดูได้ (ไม่ต้องเป็น owner)
export async function list(req, res) {
  const activityId = Number(req.params.id);
  if (!Number.isInteger(activityId) || activityId < 1)
    return err(res, 400, 'invalid activity id');
  const activity = await findActivity(activityId);
  if (!activity) return err(res, 404, 'activity not found');
  if (activity.created_by_faculty_id !== req.user.faculty_id)
    return err(res, 403, 'ไม่มีสิทธิ์เข้าถึงกิจกรรมนี้');

  const rows = await gallery.listGallery(activityId);
  const items = await decorateUrls(rows);
  res.json({ items });
}

// POST /api/faculty/activities/:id/gallery — multipart: file
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
  const existingCount = await gallery.countGallery(ctx.activityId);
  if (existingCount >= MAX_COUNT) {
    return err(
      res,
      409,
      `รูปประกอบต่อกิจกรรมเกิน ${MAX_COUNT} รูป — ลบรูปเก่าก่อน`,
    );
  }

  // detect mime จาก magic bytes (ไม่ trust client)
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_MIMES.has(detected.mime)) {
    return err(res, 400, 'ไฟล์ต้องเป็น JPG, PNG หรือ WebP เท่านั้น');
  }
  const ext = EXT_BY_MIME[detected.mime];
  const key = `gallery/${crypto.randomUUID()}.${ext}`;

  try {
    await putObject({ key, body: buffer, contentType: detected.mime });
  } catch (e) {
    console.error('[gallery upload] s3 put failed', e);
    return err(res, 502, 'อัปโหลดไม่สำเร็จ — ลองใหม่อีกครั้ง');
  }

  let row;
  try {
    row = await gallery.createGallery({
      activity_id: ctx.activityId,
      filename: originalname,
      mime_type: detected.mime,
      size_bytes: size,
      storage_key: key,
      uploaded_by: req.user.id,
    });
  } catch (dbErr) {
    deleteObject(key); // cleanup orphan
    throw dbErr;
  }

  const url = await getPresignedGetUrl(key);
  res.status(201).json({ ...row, url });
}

// DELETE /api/faculty/activities/:id/gallery/:fileId
export async function remove(req, res) {
  const ctx = await ensureMutable(req, res);
  if (!ctx) return;

  const fileId = Number(req.params.fileId);
  if (!Number.isInteger(fileId) || fileId < 1) return err(res, 400, 'invalid file id');

  // ตรวจว่ารูปอยู่ใน activity จริง (กัน leak ผ่าน id ของกิจกรรมอื่น)
  const existing = await gallery.findGalleryById(ctx.activityId, fileId);
  if (!existing) return err(res, 404, 'รูปประกอบไม่พบ');

  const deleted = await gallery.deleteGallery(fileId);
  if (!deleted) return err(res, 404, 'รูปประกอบไม่พบ');

  // best-effort delete object ใน MinIO
  deleteObject(deleted.storage_key);
  res.status(204).end();
}
