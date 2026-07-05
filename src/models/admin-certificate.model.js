import { pool, query } from '../db/index.js';

// ── admin certificate model ──────────────────────────────────────
// admin/super_admin ดูแล queue + เปลี่ยน lifecycle
//   REQUESTED → admin approve  → APPROVED
//   REQUESTED → admin reject   → REJECTED + rejected_reason
//   APPROVED  → admin issue    → ISSUED + document_no + pdf_storage_key
//
// audit:
//   embed ใน certificates row อยู่แล้ว (reviewed_by + reviewed_at + issued_at)

// list ทุก request — รองรับ filter status + search (user email/name/msu_id) + pagination
export async function listAllRequests({
  status = null,
  search = null,
  limit = 50,
  offset = 0,
} = {}) {
  const where = ['1=1'];
  const params = [];

  if (status) {
    params.push(status);
    where.push(`c.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(
      `(u.email ILIKE $${params.length}
        OR u.full_name ILIKE $${params.length}
        OR u.msu_id ILIKE $${params.length})`,
    );
  }

  const whereSql = where.join(' AND ');

  const countRes = await query(
    `SELECT COUNT(*)::int AS total
       FROM certificates c
       JOIN users u ON u.id = c.user_id
      WHERE ${whereSql}`,
    params,
  );
  const total = countRes.rows[0].total;

  params.push(limit);
  params.push(offset);
  const { rows } = await query(
    `SELECT c.id,
            c.user_id,
            c.status,
            c.total_hours_at_request,
            c.requested_at,
            c.reviewed_at,
            c.reviewed_by,
            c.rejected_reason,
            c.issued_at,
            c.document_no,
            c.pdf_storage_key,
            u.email          AS user_email,
            u.full_name      AS user_full_name,
            u.msu_id         AS user_msu_id,
            u.faculty_name   AS user_faculty_name,
            rb.full_name     AS reviewed_by_name
       FROM certificates c
       JOIN users u                ON u.id = c.user_id
       LEFT JOIN users rb          ON rb.id = c.reviewed_by
      WHERE ${whereSql}
      ORDER BY
        -- REQUESTED ก่อน (admin ต้องดูสุด); ISSUED ท้ายสุด
        CASE c.status
          WHEN 'REQUESTED' THEN 0
          WHEN 'APPROVED'  THEN 1
          WHEN 'REJECTED'  THEN 2
          WHEN 'ISSUED'    THEN 3
          ELSE 4
        END,
        c.requested_at DESC, c.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows, total };
}

// ดึง 1 request พร้อมข้อมูล user (สำหรับ admin detail / action precheck)
export async function findById(id) {
  const { rows } = await query(
    `SELECT c.*,
            u.email        AS user_email,
            u.full_name    AS user_full_name,
            u.msu_id       AS user_msu_id,
            u.faculty_name AS user_faculty_name,
            rb.full_name   AS reviewed_by_name
       FROM certificates c
       JOIN users u                ON u.id = c.user_id
       LEFT JOIN users rb          ON rb.id = c.reviewed_by
      WHERE c.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// approve: REQUESTED → APPROVED
// คืน: updated row | null ถ้า precondition ไม่ตรง (ไม่ใช่ REQUESTED)
export async function approveRequest(id, actorId) {
  const { rows } = await query(
    `UPDATE certificates
        SET status      = 'APPROVED',
            reviewed_by = $2,
            reviewed_at = now(),
            updated_at  = now()
      WHERE id = $1 AND status = 'REQUESTED'
      RETURNING id, user_id, status, reviewed_at`,
    [id, actorId],
  );
  return rows[0] ?? null;
}

// reject: REQUESTED → REJECTED + reason
export async function rejectRequest(id, reason, actorId) {
  const { rows } = await query(
    `UPDATE certificates
        SET status          = 'REJECTED',
            reviewed_by     = $2,
            reviewed_at     = now(),
            rejected_reason = $3,
            updated_at      = now()
      WHERE id = $1 AND status = 'REQUESTED'
      RETURNING id, user_id, status, reviewed_at, rejected_reason`,
    [id, actorId, reason],
  );
  return rows[0] ?? null;
}

// issue: APPROVED → ISSUED + document_no + (optional) pdf_storage_key
//   transaction เพราะ document_no มี UNIQUE — ถ้า duplicate ต้อง rollback ส่ง 409
// คืน:
//   updated row
//   { duplicate_doc: true }   ถ้า document_no ซ้ำ
//   null                      ถ้า precondition ไม่ตรง (ไม่ใช่ APPROVED หรือ id ไม่มี)
export async function issueRequest(id, { document_no, pdf_storage_key = null }, actorId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let updated;
    try {
      const { rows } = await client.query(
        `UPDATE certificates
            SET status          = 'ISSUED',
                issued_at       = now(),
                document_no     = $2,
                pdf_storage_key = $3,
                -- ถ้าตอน approve ยังไม่ได้บันทึก reviewed_by — fallback ใช้ actor ปัจจุบัน
                reviewed_by     = COALESCE(reviewed_by, $4),
                reviewed_at     = COALESCE(reviewed_at, now()),
                updated_at      = now()
          WHERE id = $1 AND status = 'APPROVED'
          RETURNING id, user_id, status, issued_at, document_no`,
        [id, document_no, pdf_storage_key, actorId],
      );
      updated = rows[0] ?? null;
    } catch (e) {
      if (e?.code === '23505') {
        // unique violation บน document_no
        await client.query('ROLLBACK');
        return { duplicate_doc: true };
      }
      throw e;
    }
    await client.query('COMMIT');
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
