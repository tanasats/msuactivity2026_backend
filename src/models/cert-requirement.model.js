import { pool, query } from '../db/index.js';

// ── cert_requirements model — versioned rule สำหรับ certificate eligibility ─
//
// Active rule = row ที่ effective_to IS NULL (มีได้ row เดียว — partial unique บังคับ)
// History    = ทุก row เรียงตาม effective_from DESC
//
// Schema ดู migration 20260522000001_cert-requirements-rebuild.cjs

// ดึง rule ที่ใช้งานอยู่ — null ถ้ายังไม่เคย set (ไม่ควรเกิดหลัง seed migration)
export async function getActiveRule() {
  const { rows } = await query(
    `SELECT id,
            group_a_prefixes,
            group_b_prefixes,
            group_a_min_activities,
            group_b_min_activities,
            min_total_hours,
            effective_from,
            effective_to,
            note,
            created_by,
            created_at
       FROM cert_requirements
      WHERE effective_to IS NULL
      LIMIT 1`,
  );
  return rows[0] ?? null;
}

// สร้าง rule ใหม่ — set old.effective_to = today + INSERT row ใหม่ (atomic)
//   payload: {
//     group_a_prefixes, group_b_prefixes,
//     group_a_min_activities, group_b_min_activities,
//     min_total_hours,
//     note (optional)
//   }
//   actorId: super_admin id
//
// คืน: { old, new }  — เพื่อให้ controller log audit ทั้งคู่
export async function createRule(payload, actorId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. ปิด active เก่า (ถ้ามี) — set effective_to = today
    //    ใช้ FOR UPDATE กัน 2 super_admin save ชนกัน
    const { rows: oldRows } = await client.query(
      `SELECT id, group_a_prefixes, group_b_prefixes,
              group_a_min_activities, group_b_min_activities,
              min_total_hours, effective_from
         FROM cert_requirements
        WHERE effective_to IS NULL
        FOR UPDATE`,
    );
    const oldRule = oldRows[0] ?? null;
    if (oldRule) {
      await client.query(
        `UPDATE cert_requirements
            SET effective_to = current_date
          WHERE id = $1`,
        [oldRule.id],
      );
    }

    // 2. INSERT row ใหม่ — effective_from = today (default), effective_to = NULL
    const { rows: newRows } = await client.query(
      `INSERT INTO cert_requirements
         (group_a_prefixes, group_b_prefixes,
          group_a_min_activities, group_b_min_activities,
          min_total_hours, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, group_a_prefixes, group_b_prefixes,
                 group_a_min_activities, group_b_min_activities,
                 min_total_hours, effective_from, note, created_by, created_at`,
      [
        payload.group_a_prefixes,
        payload.group_b_prefixes,
        payload.group_a_min_activities,
        payload.group_b_min_activities,
        payload.min_total_hours,
        payload.note ?? null,
        actorId,
      ],
    );

    await client.query('COMMIT');
    return { old: oldRule, new: newRows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ประวัติทั้งหมด — ใหม่ก่อน
export async function listHistory({ limit = 50 } = {}) {
  const { rows } = await query(
    `SELECT r.id,
            r.group_a_prefixes,
            r.group_b_prefixes,
            r.group_a_min_activities,
            r.group_b_min_activities,
            r.min_total_hours,
            r.effective_from,
            r.effective_to,
            r.note,
            r.created_by,
            r.created_at,
            u.full_name AS created_by_name
       FROM cert_requirements r
       LEFT JOIN users u ON u.id = r.created_by
      ORDER BY r.effective_from DESC, r.id DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}
