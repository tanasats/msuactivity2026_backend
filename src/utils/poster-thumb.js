import sharp from 'sharp';
import { getObjectBuffer, putObject, objectExists } from './s3.js';

// สร้าง thumbnail ของโปสเตอร์แบบ lazy — เรียกครั้งแรกตอนกิจกรรมถูกแสดงบนการ์ด
//
// ทำไม lazy: หลีกเลี่ยง migration/แก้ฟอร์ม/backfill — thumb เกิดเองครั้งแรกที่ต้องใช้
//   แล้ว memoize ไว้ ครั้งถัดไปคืน key ทันที (self-healing กับโปสเตอร์เก่าที่อัปไว้ก่อนมีฟีเจอร์นี้)
//
// การ์ด landing กว้างจริง ~300–400px → ย่อเหลือ 640px (เผื่อ retina) + webp คุณภาพ 72
//   ลด bytes จากหลาย MB เหลือ ~30–60KB ต่อรูป

const THUMB_WIDTH = 640;
const THUMB_QUALITY = 72;
// content-addressed key (UUID เดิม) → ตั้ง immutable ยาว ๆ ได้ปลอดภัย
const THUMB_CACHE_CONTROL = 'public, max-age=604800, immutable';

// key ต้นฉบับ posters/<uuid>.<ext> → thumb posters/thumb/<uuid>.webp
function deriveThumbKey(posterKey) {
  const base = posterKey.replace(/^posters\//, '').replace(/\.[^.]+$/, '');
  return `posters/thumb/${base}.webp`;
}

// memo: posterKey → thumbKey ที่ยืนยันแล้วว่ามีอยู่ (คงอยู่ตลอดอายุ process)
const ready = new Map();
// dedupe งานที่กำลังสร้างอยู่ กัน request พร้อมกันสร้าง thumb เดียวกันซ้ำ
const inflight = new Map();

async function buildThumb(posterKey, thumbKey) {
  const src = await getObjectBuffer(posterKey);
  const webp = await sharp(src)
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer();
  await putObject({
    key: thumbKey,
    body: webp,
    contentType: 'image/webp',
    cacheControl: THUMB_CACHE_CONTROL,
  });
}

// คืน storage key ที่ควรใช้แสดงบนการ์ด
//   - สร้าง thumb ถ้ายังไม่มี, memoize ผลไว้
//   - ★ best-effort: ถ้าอะไรพัง (sharp/S3) → fallback คืน posterKey เดิม (รูปยังแสดงได้ แค่ใหญ่กว่า)
export async function getPosterThumbKey(posterKey) {
  if (!posterKey) return posterKey;
  if (ready.has(posterKey)) return ready.get(posterKey);
  if (inflight.has(posterKey)) return inflight.get(posterKey);

  const thumbKey = deriveThumbKey(posterKey);
  const task = (async () => {
    try {
      if (!(await objectExists(thumbKey))) {
        await buildThumb(posterKey, thumbKey);
      }
      ready.set(posterKey, thumbKey);
      return thumbKey;
    } catch (err) {
      console.warn(`[poster-thumb] fallback to original for ${posterKey}: ${err.message}`);
      return posterKey; // ไม่ memoize — ให้ retry รอบหน้า
    } finally {
      inflight.delete(posterKey);
    }
  })();

  inflight.set(posterKey, task);
  return task;
}
