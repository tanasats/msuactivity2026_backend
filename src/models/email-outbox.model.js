import { query } from '../db/index.js';

// ── email_outbox model ───────────────────────────────────────────

// enqueue หลายฉบับ — กันซ้ำด้วย dedupe_key (unique) → ON CONFLICT DO NOTHING
//   rows: [{ eventType, toUserId, toEmail, subject, bodyHtml, bodyText,
//            relatedActivityId, relatedRegistrationId, dedupeKey }]
export async function enqueueMany(rows) {
  if (!rows?.length) return 0;
  const cols = [
    'event_type',
    'to_user_id',
    'to_email',
    'subject',
    'body_html',
    'body_text',
    'related_activity_id',
    'related_registration_id',
    'dedupe_key',
  ];
  const values = [];
  const params = [];
  rows.forEach((r, i) => {
    const base = i * cols.length;
    values.push(`(${cols.map((_, j) => `$${base + j + 1}`).join(', ')})`);
    params.push(
      r.eventType,
      r.toUserId ?? null,
      r.toEmail,
      r.subject,
      r.bodyHtml,
      r.bodyText ?? null,
      r.relatedActivityId ?? null,
      r.relatedRegistrationId ?? null,
      r.dedupeKey ?? null,
    );
  });
  const { rowCount } = await query(
    `INSERT INTO email_outbox (${cols.join(', ')})
     VALUES ${values.join(', ')}
     ON CONFLICT (dedupe_key) DO NOTHING`,
    params,
  );
  return rowCount;
}

// claim งานที่ถึงเวลาส่ง — atomic ด้วย FOR UPDATE SKIP LOCKED (รองรับหลาย worker)
//   PENDING + next_attempt_at <= now → set SENDING → คืน row ให้ worker ส่ง
export async function claimBatch(limit = 10) {
  const { rows } = await query(
    `UPDATE email_outbox
        SET status = 'SENDING', updated_at = now()
      WHERE id IN (
        SELECT id FROM email_outbox
         WHERE status = 'PENDING' AND next_attempt_at <= now()
         ORDER BY next_attempt_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, event_type, to_user_id, to_email, subject, body_html, body_text,
                attempts, max_attempts`,
    [limit],
  );
  return rows;
}

export async function markSent(id) {
  await query(
    `UPDATE email_outbox SET status = 'SENT', sent_at = now(), updated_at = now()
      WHERE id = $1`,
    [id],
  );
}

// ส่งพลาด — attempts++; ครบ max → FAILED, ไม่งั้นกลับเป็น PENDING + เลื่อน next_attempt_at (backoff)
export async function markFailed(id, error, attempts, maxAttempts, backoffSeconds) {
  const nextAttempts = attempts + 1;
  const failed = nextAttempts >= maxAttempts;
  await query(
    `UPDATE email_outbox
        SET status         = $2,
            attempts       = $3,
            last_error     = $4,
            next_attempt_at = now() + ($5 || ' seconds')::interval,
            updated_at     = now()
      WHERE id = $1`,
    [id, failed ? 'FAILED' : 'PENDING', nextAttempts, String(error).slice(0, 2000), backoffSeconds],
  );
  return failed;
}
