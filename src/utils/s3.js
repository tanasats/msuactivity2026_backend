import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// MinIO ใช้ S3-compatible API → ใช้ AWS SDK v3 ตรง ๆ
// dev defaults ตรงกับ docker-compose.yml + .env.example

const ENDPOINT = process.env.S3_ENDPOINT || 'http://localhost:9000';
const REGION = process.env.S3_REGION || 'us-east-1';
export const S3_BUCKET = process.env.S3_BUCKET || 'msuactivity-files';

export const s3 = new S3Client({
  endpoint: ENDPOINT,
  region: REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  },
  forcePathStyle:
    (process.env.S3_FORCE_PATH_STYLE || 'true').toLowerCase() === 'true',
});

// upload buffer ไป S3 — return ผลลัพธ์ basic
export async function putObject({ key, body, contentType }) {
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return { key, bucket: S3_BUCKET };
}

// presigned GET URL — ให้ frontend ดึงรูป (bucket private, ไม่เปิด public)
// expiresIn วินาที (default 3600 = 1 ชม.)
export async function getPresignedGetUrl(key, expiresIn = 3600) {
  const cmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn });
}

// best-effort delete — orphan cleanup
export async function deleteObject(key) {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  } catch (err) {
    console.warn(`[s3] delete failed for ${key}: ${err.message}`);
  }
}
