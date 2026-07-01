import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// MinIO ใช้ S3-compatible API → ใช้ AWS SDK v3 ตรง ๆ
//
// ✦ แยก endpoint 2 ตัวเพื่อแก้ปัญหา "browser มองไม่เห็น http://minio:9000"
//   - S3_ENDPOINT         = ใช้โดย backend คุยกับ MinIO ภายใน (เช่น http://minio:9000)
//   - S3_PUBLIC_ENDPOINT  = host ที่ embed ลงใน presigned URL ให้ browser เปิดได้
//                            (เช่น http://localhost:9000 ใน dev,
//                             https://files.msu.ac.th ใน production)
//   ถ้าไม่ตั้ง S3_PUBLIC_ENDPOINT จะ fallback มาใช้ S3_ENDPOINT (เคสที่รัน backend
//   บน host เดียวกับ user เช่น dev บน laptop)

const ENDPOINT = process.env.S3_ENDPOINT || 'http://localhost:9000';
const PUBLIC_ENDPOINT = process.env.S3_PUBLIC_ENDPOINT || ENDPOINT;
const REGION = process.env.S3_REGION || 'us-east-1';
export const S3_BUCKET = process.env.S3_BUCKET || 'msuactivity-files';

const credentials = {
  accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
  secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
};
const forcePathStyle =
  (process.env.S3_FORCE_PATH_STYLE || 'true').toLowerCase() === 'true';

// internal client — ใช้ทำงานกับ MinIO ตรง ๆ (put/get/delete)
export const s3 = new S3Client({
  endpoint: ENDPOINT,
  region: REGION,
  credentials,
  forcePathStyle,
});

// public client — ใช้ "เฉพาะ" generate presigned URL เพื่อให้ host ใน URL = public endpoint
//   ถ้า public = internal ก็ reuse client ตัวเดียวกัน (ไม่สิ้นเปลือง)
const s3Public =
  PUBLIC_ENDPOINT === ENDPOINT
    ? s3
    : new S3Client({
        endpoint: PUBLIC_ENDPOINT,
        region: REGION,
        credentials,
        forcePathStyle,
      });

// upload buffer ไป S3 — return ผลลัพธ์ basic
//   cacheControl (optional) → embed เป็น metadata ของ object; MinIO ส่งกลับใน GET header
//     ใช้กับรูปที่ key เป็น content-addressed (UUID) → ตั้ง immutable ได้ปลอดภัย
export async function putObject({ key, body, contentType, cacheControl }) {
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...(cacheControl ? { CacheControl: cacheControl } : {}),
    }),
  );
  return { key, bucket: S3_BUCKET };
}

// ดึง object เป็น Buffer (ใช้ตอน generate thumbnail จากรูปต้นฉบับ)
export async function getObjectBuffer(key) {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
  );
  return Buffer.from(await res.Body.transformToByteArray());
}

// เช็คว่า object มีอยู่ไหม (HeadObject) — return true/false (ไม่ throw ตอน 404)
export async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') {
      return false;
    }
    throw err;
  }
}

// window (ms) ที่ round เวลา signing ลง เพื่อให้ presigned URL "คงที่" ภายในช่วงเดียวกัน
//   ผล: request หลายครั้งในชั่วโมงเดียวกันได้ URL เดียวเป๊ะ (X-Amz-Date/Signature เท่ากัน)
//        → browser cache โดน (เดิม URL เปลี่ยนทุก request → ดาวน์โหลดรูปซ้ำทุกครั้ง)
const PRESIGN_WINDOW_MS = 60 * 60 * 1000; // 1 ชม.

// presigned GET URL — ให้ frontend ดึงรูป (bucket private, ไม่เปิด public)
//   ใช้ s3Public เพื่อให้ host ใน URL = S3_PUBLIC_ENDPOINT (browser เปิดได้)
//   ★ signingDate ถูก round ลงต้นชั่วโมง → URL เสถียรทั้งชั่วโมงนั้น (cacheable)
//   expiresIn วินาที (default 7200 = 2 ชม.) — ต้อง > window เพื่อให้ URL ต้นช่วงยังไม่หมดอายุ
export async function getPresignedGetUrl(key, expiresIn = 2 * 3600) {
  const bucketedMs =
    Math.floor(Date.now() / PRESIGN_WINDOW_MS) * PRESIGN_WINDOW_MS;
  const cmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
  return getSignedUrl(s3Public, cmd, {
    expiresIn,
    signingDate: new Date(bucketedMs),
  });
}

// best-effort delete — orphan cleanup
export async function deleteObject(key) {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  } catch (err) {
    console.warn(`[s3] delete failed for ${key}: ${err.message}`);
  }
}
