import { pool, query } from '../db/index.js';

// ── message threads (faculty ↔ admin) ────────────────────────────

// เปิด thread ใหม่ + ข้อความแรก (transaction) — คืน { thread, message }
export async function createThread({ subject, body, createdBy, facultyId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: tr } = await client.query(
      `INSERT INTO message_threads (subject, created_by, faculty_id)
       VALUES ($1, $2, $3)
       RETURNING id, subject, status, created_by, created_at, last_message_at`,
      [subject, createdBy, facultyId ?? null],
    );
    const thread = tr[0];
    const { rows: mr } = await client.query(
      `INSERT INTO thread_messages (thread_id, sender_id, body)
       VALUES ($1, $2, $3) RETURNING id, thread_id, sender_id, body, created_at`,
      [thread.id, createdBy, body],
    );
    await client.query('COMMIT');
    return { thread, message: mr[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// เพิ่มข้อความ + sync last_message_at (โพสต์ใน thread ที่ RESOLVED = reopen อัตโนมัติ)
//   คืน { message, thread } (thread มี subject/created_by/status ไว้ทำ notification)
export async function addMessage({ threadId, senderId, body }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: mr } = await client.query(
      `INSERT INTO thread_messages (thread_id, sender_id, body)
       VALUES ($1, $2, $3) RETURNING id, thread_id, sender_id, body, created_at`,
      [threadId, senderId, body],
    );
    const { rows: tr } = await client.query(
      `UPDATE message_threads
          SET last_message_at = now(),
              updated_at      = now(),
              status = CASE WHEN status = 'RESOLVED' THEN 'OPEN' ELSE status END
        WHERE id = $1
        RETURNING id, subject, created_by, status`,
      [threadId],
    );
    await client.query('COMMIT');
    return { message: mr[0], thread: tr[0] ?? null };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// unread expression (ต่อ user) — reuse ใน list
const UNREAD_EXPR = `(tr.last_read_at IS NULL OR t.last_message_at > tr.last_read_at)`;

// thread ของ faculty คนนี้ (ที่ตัวเองเปิด)
export async function listForFaculty(userId) {
  const { rows } = await query(
    `SELECT t.id, t.subject, t.status, t.last_message_at, t.created_at,
            ${UNREAD_EXPR} AS unread
       FROM message_threads t
       LEFT JOIN thread_reads tr ON tr.thread_id = t.id AND tr.user_id = $1
      WHERE t.created_by = $1
      ORDER BY t.last_message_at DESC`,
    [userId],
  );
  return rows;
}

// inbox ของ admin — ทุก thread (OPEN ก่อน), filter status/q, unread ต่อ admin คนนี้
export async function listForAdmin(adminId, { status = null, q = null, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [adminId];
  if (status === 'OPEN' || status === 'RESOLVED') {
    params.push(status);
    where.push(`t.status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(t.subject ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit, offset);
  const { rows } = await query(
    `SELECT t.id, t.subject, t.status, t.last_message_at, t.created_at,
            t.created_by, u.full_name AS creator_name, u.faculty_name AS creator_faculty,
            ${UNREAD_EXPR} AS unread
       FROM message_threads t
       JOIN users u ON u.id = t.created_by
       LEFT JOIN thread_reads tr ON tr.thread_id = t.id AND tr.user_id = $1
       ${whereSql}
      ORDER BY CASE t.status WHEN 'OPEN' THEN 0 ELSE 1 END, t.last_message_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

// thread เดี่ยว (+ ชื่อผู้เปิด)
export async function getThread(threadId) {
  const { rows } = await query(
    `SELECT t.id, t.subject, t.status, t.created_by, t.faculty_id,
            t.last_message_at, t.created_at, t.resolved_at,
            u.full_name AS creator_name, u.faculty_name AS creator_faculty
       FROM message_threads t
       JOIN users u ON u.id = t.created_by
      WHERE t.id = $1`,
    [threadId],
  );
  return rows[0] ?? null;
}

// ข้อความในบทสนทนา (+ ชื่อ/role ผู้ส่ง เพื่อจัด bubble ซ้าย/ขวา)
export async function getMessages(threadId) {
  const { rows } = await query(
    `SELECT m.id, m.sender_id, m.body, m.created_at,
            u.full_name AS sender_name, u.role AS sender_role
       FROM thread_messages m
       JOIN users u ON u.id = m.sender_id
      WHERE m.thread_id = $1
      ORDER BY m.created_at ASC`,
    [threadId],
  );
  return rows;
}

// mark thread ว่าอ่านแล้ว (ต่อ user) — upsert last_read_at = now
export async function markRead(threadId, userId) {
  await query(
    `INSERT INTO thread_reads (thread_id, user_id, last_read_at)
     VALUES ($1, $2, now())
     ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = now()`,
    [threadId, userId],
  );
}

// ปิด thread (admin) — เฉพาะที่ยัง OPEN; คืน row ถ้าเปลี่ยนจริง
export async function resolve(threadId, adminId) {
  const { rows } = await query(
    `UPDATE message_threads
        SET status = 'RESOLVED', resolved_by = $2, resolved_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'OPEN'
      RETURNING id, status`,
    [threadId, adminId],
  );
  return rows[0] ?? null;
}

// นับ thread ที่ยังไม่อ่าน (badge) — faculty: ของตัวเอง / admin: ทั้งหมด
export async function countUnread(userId, { adminScope = false } = {}) {
  const scope = adminScope ? '' : 'AND t.created_by = $1';
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n
       FROM message_threads t
       LEFT JOIN thread_reads tr ON tr.thread_id = t.id AND tr.user_id = $1
      WHERE ${UNREAD_EXPR} ${scope}`,
    [userId],
  );
  return rows[0].n;
}
