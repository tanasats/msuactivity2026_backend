import { pruneReadOlderThan } from '../models/notification.model.js';

// ── retention worker — ลบ notification ที่อ่านแล้วและเก่ากว่า N วัน (default 90) ─
//   รันครั้งเดียวตอน start + วันละครั้ง; DELETE idempotent → รันหลาย instance ได้ปลอดภัย

const DAY_MS = 86_400_000;
const RETENTION_DAYS = Number(process.env.NOTIFICATION_RETENTION_DAYS) || 90;

let timer = null;

async function run() {
  try {
    const n = await pruneReadOlderThan(RETENTION_DAYS);
    if (n) console.log(`[retention] ลบ notification เก่า ${n} รายการ (> ${RETENTION_DAYS} วัน)`);
  } catch (err) {
    console.error('[retention] error:', err?.message ?? err);
  }
}

export function startRetentionWorker() {
  if (timer) return;
  run(); // ครั้งแรกตอน start
  timer = setInterval(run, DAY_MS);
  if (timer.unref) timer.unref();
  console.log(`[retention] started (${RETENTION_DAYS} วัน, รันวันละครั้ง)`);
}
