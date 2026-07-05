import { claimBatch, markSent, markFailed } from '../models/email-outbox.model.js';
import { sendMail } from '../utils/mailer.js';

// ── email worker — poll email_outbox แล้วส่งจริงด้วย mailer ────────
//   รัน "instance เดียว" (คุมด้วย EMAIL_WORKER_ENABLED) กันส่งซ้ำตอน scale หลาย process
//   - claimBatch ใช้ FOR UPDATE SKIP LOCKED → ปลอดภัยแม้เผลอรันหลายตัว
//   - ส่งพลาด → retry/backoff (exponential, เพดาน 1 ชม.) จนครบ max_attempts → FAILED

const POLL_MS = Number(process.env.EMAIL_WORKER_POLL_MS) || 5_000;
const BATCH_SIZE = Number(process.env.EMAIL_WORKER_BATCH) || 10;
const BACKOFF_CAP_S = 3_600;

let timer = null;
let running = false;

// ประมวลผล 1 รอบ (claim batch → ส่ง → mark) — export ไว้ให้เทสต์เรียกตรงได้
export async function processOnce() {
  if (running) return; // กัน overlap ถ้ารอบก่อนยังไม่เสร็จ
  running = true;
  try {
    const batch = await claimBatch(BATCH_SIZE);
    for (const row of batch) {
      try {
        await sendMail({
          to: row.to_email,
          subject: row.subject,
          html: row.body_html,
          text: row.body_text,
        });
        await markSent(row.id);
      } catch (err) {
        const backoff = Math.min(60 * 2 ** row.attempts, BACKOFF_CAP_S);
        const failed = await markFailed(
          row.id,
          err?.message ?? String(err),
          row.attempts,
          row.max_attempts,
          backoff,
        );
        console.warn(
          `[email-worker] send failed id=${row.id} (${failed ? 'FAILED' : `retry in ${backoff}s`}): ${err?.message}`,
        );
      }
    }
  } catch (err) {
    console.error('[email-worker] tick error:', err?.message ?? err);
  } finally {
    running = false;
  }
}

export function startEmailWorker() {
  if (timer) return;
  console.log(`[email-worker] started (poll ${POLL_MS}ms, batch ${BATCH_SIZE})`);
  timer = setInterval(processOnce, POLL_MS);
  if (timer.unref) timer.unref(); // ไม่ block process exit
}

export function stopEmailWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
