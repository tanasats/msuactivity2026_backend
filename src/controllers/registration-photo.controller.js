import crypto from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import {
  countByRegistration,
  deletePhoto,
  findPhoto,
  findRegistrationContext,
  insertPhoto,
  listByRegistration,
} from '../models/registration-photo.model.js';
import {
  deleteObject,
  getPresignedGetUrl,
  putObject,
} from '../utils/s3.js';

// rules:
//   - max 5 photos ต่อ registration
//   - max 5 MB ต่อรูป
//   - mime: jpg/png/webp (ตรวจจาก magic bytes ไม่ trust client)
//   - เพิ่ม/ลบได้เฉพาะนิสิตเจ้าของ registration ที่ evaluation_status='PASSED'
const MAX_PHOTOS_PER_REGISTRATION = 5;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function err(res, status, message) {
  return res.status(status).json({ status: 'error', message });
}

// helper: ตรวจสิทธิ์การจัดการรูปของ registration นี้ (เจ้าของ + PASSED)
//   คืน registration ถ้า OK, ส่ง response error + return null ถ้าไม่ผ่าน
async function ensureOwnerAndPassed(req, res) {
  const regId = Number(req.params.regId);
  if (!Number.isInteger(regId) || regId < 1) {
    err(res, 400, 'invalid registration id');
    return null;
  }
  const reg = await findRegistrationContext(regId);
  if (!reg) {
    err(res, 404, 'registration not found');
    return null;
  }
  if (reg.user_id !== req.user.id) {
    err(res, 403, 'จัดการรูปได้เฉพาะ registration ของท่านเอง');
    return null;
  }
  if (reg.evaluation_status !== 'PASSED') {
    err(
      res,
      409,
      'เพิ่มรูปได้เฉพาะกิจกรรมที่ได้รับการประเมินผ่านแล้วเท่านั้น',
    );
    return null;
  }
  return reg;
}

// helper: เติม url presigned ใส่ทุกรูป
async function decoratePhotos(photos) {
  return Promise.all(
    photos.map(async (p) => ({
      ...p,
      url: await getPresignedGetUrl(p.storage_key),
    })),
  );
}

// GET /api/student/registrations/:regId/photos
export async function list(req, res) {
  const regId = Number(req.params.regId);
  if (!Number.isInteger(regId) || regId < 1) return err(res, 400, 'invalid registration id');
  const reg = await findRegistrationContext(regId);
  if (!reg) return err(res, 404, 'registration not found');
  if (reg.user_id !== req.user.id)
    return err(res, 403, 'ดูรูปได้เฉพาะ registration ของท่านเอง');

  const photos = await listByRegistration(regId);
  res.json({ items: await decoratePhotos(photos) });
}

// POST /api/student/registrations/:regId/photos
//   field: 'photo' (multipart/form-data)
export async function upload(req, res) {
  const reg = await ensureOwnerAndPassed(req, res);
  if (!reg) return;

  if (!req.file) return err(res, 400, 'ไม่พบไฟล์ใน field "photo"');
  const { buffer, originalname, size } = req.file;
  if (size <= 0 || size > PHOTO_MAX_BYTES) {
    return err(
      res,
      400,
      `ขนาดไฟล์ต้องไม่เกิน ${Math.round(PHOTO_MAX_BYTES / 1024 / 1024)} MB`,
    );
  }

  // detect mime จาก magic bytes (ไม่ trust client mime)
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_MIMES.has(detected.mime)) {
    return err(res, 400, 'ไฟล์ต้องเป็น JPG, PNG หรือ WebP เท่านั้น');
  }

  // ตรวจ limit ≤ 5
  const currentCount = await countByRegistration(reg.registration_id);
  if (currentCount >= MAX_PHOTOS_PER_REGISTRATION) {
    return err(
      res,
      409,
      `เพิ่มรูปได้ไม่เกิน ${MAX_PHOTOS_PER_REGISTRATION} รูปต่อกิจกรรม`,
    );
  }

  // upload S3 + insert DB
  const ext = EXT_BY_MIME[detected.mime];
  const key = `registration-photos/${reg.registration_id}/${crypto.randomUUID()}.${ext}`;
  try {
    await putObject({ key, body: buffer, contentType: detected.mime });
  } catch (e) {
    console.error('[photo upload] s3 put failed', e);
    return err(res, 502, 'อัปโหลดไฟล์ไม่สำเร็จ — ลองใหม่อีกครั้ง');
  }

  let photo;
  try {
    photo = await insertPhoto({
      registrationId: reg.registration_id,
      storageKey: key,
      filename: originalname,
      mimeType: detected.mime,
      sizeBytes: size,
    });
  } catch (e) {
    // insert ล้ม → ลบไฟล์ที่ upload ไป (กัน orphan)
    deleteObject(key);
    throw e;
  }

  res.status(201).json({
    ...photo,
    url: await getPresignedGetUrl(photo.storage_key),
  });
}

// DELETE /api/student/registrations/:regId/photos/:photoId
export async function remove(req, res) {
  const reg = await ensureOwnerAndPassed(req, res);
  if (!reg) return;

  const photoId = Number(req.params.photoId);
  if (!Number.isInteger(photoId) || photoId < 1)
    return err(res, 400, 'invalid photo id');

  const photo = await findPhoto(photoId);
  if (!photo) return err(res, 404, 'photo not found');
  if (photo.registration_id !== reg.registration_id)
    return err(res, 400, 'รูปนี้ไม่ใช่ของกิจกรรมนี้');
  if (photo.user_id !== req.user.id)
    return err(res, 403, 'ลบได้เฉพาะรูปของท่านเอง');

  const key = await deletePhoto(photoId);
  if (key) deleteObject(key); // best-effort
  res.json({ status: 'ok', deleted_id: photoId });
}
