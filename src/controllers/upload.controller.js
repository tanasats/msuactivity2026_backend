import crypto from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { putObject } from '../utils/s3.js';

// poster rules (ตาม memory project_files.md):
//   - mime: jpg/png/webp
//   - max size: 5 MB
//   - magic-byte check ไม่ trust client mime
const POSTER_MAX_BYTES = 5 * 1024 * 1024;
const POSTER_ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const POSTER_EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function uploadPoster(req, res) {
  if (!req.file) {
    return res
      .status(400)
      .json({ status: 'error', message: 'ไม่พบไฟล์ใน field "poster"' });
  }
  const { buffer, originalname, size } = req.file;

  if (size <= 0 || size > POSTER_MAX_BYTES) {
    return res.status(400).json({
      status: 'error',
      message: `ขนาดไฟล์ต้องอยู่ระหว่าง 1 byte และ ${Math.round(
        POSTER_MAX_BYTES / 1024 / 1024,
      )} MB`,
    });
  }

  // detect mime จาก magic bytes (ไม่ trust client)
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !POSTER_ALLOWED_MIMES.has(detected.mime)) {
    return res.status(400).json({
      status: 'error',
      message: 'ไฟล์ต้องเป็น JPG, PNG หรือ WebP เท่านั้น',
    });
  }

  const ext = POSTER_EXT_BY_MIME[detected.mime];
  const key = `posters/${crypto.randomUUID()}.${ext}`;

  try {
    await putObject({ key, body: buffer, contentType: detected.mime });
  } catch (err) {
    console.error('[upload poster] s3 put failed', err);
    return res.status(502).json({
      status: 'error',
      message: 'อัปโหลดไฟล์ไม่สำเร็จ — ลองใหม่อีกครั้ง',
    });
  }

  res.status(201).json({
    storage_key: key,
    filename: originalname,
    mime_type: detected.mime,
    size_bytes: size,
  });
}
