import { pool, query } from '../db/index.js';

// ── activity_interests model ─────────────────────────────────────
//   ทุก mutation ใช้ transaction เพื่อ sync counter ใน activities.interested_count
//   list query: JOIN activities + filter เฉพาะ active status (WORK/COMPLETED)

// เพิ่ม interest — กลับ true ถ้าเพิ่งเพิ่ม, false ถ้ามีอยู่แล้ว
export async function addInterest(userId, activityId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insRes = await client.query(
      `INSERT INTO activity_interests (user_id, activity_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, activity_id) DO NOTHING
       RETURNING user_id`,
      [userId, activityId],
    );
    if (insRes.rowCount === 0) {
      // มีอยู่แล้ว — ไม่ต้อง increment counter
      await client.query('COMMIT');
      return false;
    }
    await client.query(
      `UPDATE activities SET interested_count = interested_count + 1
        WHERE id = $1`,
      [activityId],
    );
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ลบ interest — กลับ true ถ้าลบจริง, false ถ้าไม่มีอยู่แล้ว
export async function removeInterest(userId, activityId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const delRes = await client.query(
      `DELETE FROM activity_interests
        WHERE user_id = $1 AND activity_id = $2`,
      [userId, activityId],
    );
    if (delRes.rowCount === 0) {
      await client.query('COMMIT');
      return false;
    }
    await client.query(
      `UPDATE activities SET interested_count = GREATEST(interested_count - 1, 0)
        WHERE id = $1`,
      [activityId],
    );
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// คืน list activity_ids ที่ user สนใจ — ใช้ตอน detail page เช็ค is_interested_by_me
export async function listInterestedActivityIds(userId) {
  const { rows } = await query(
    `SELECT activity_id FROM activity_interests WHERE user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.activity_id);
}

// list interests ของนิสิต พร้อมข้อมูลกิจกรรม (สำหรับ dashboard)
//   filter: เฉพาะกิจกรรมที่ user ยังสนใจอยู่ + ที่ activity ยังอยู่
//   sort: ล่าสุดก่อน
export async function listInterestsForUser(userId, { limit = 50 } = {}) {
  const { rows } = await query(
    `SELECT
       ai.activity_id,
       ai.created_at AS interested_at,
       a.code, a.title, a.location,
       a.start_at, a.end_at,
       a.registration_open_at, a.registration_close_at,
       a.hours, a.loan_hours,
       a.capacity, a.registered_count,
       a.status,
       a.academic_year, a.semester,
       a.interested_count, a.view_count,
       cat.code AS category_code, cat.name AS category_name,
       o.code AS organization_code, o.name AS organization_name
     FROM activity_interests ai
     JOIN activities a ON a.id = ai.activity_id
     JOIN activity_categories cat ON cat.id = a.category_id
     JOIN organizations o ON o.id = a.organization_id
     WHERE ai.user_id = $1
     ORDER BY ai.created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

// increment view count — เรียกจาก public detail page (ผ่าน POST /activities/:id/view)
//   ไม่ใช้ tx — เป็น hot path + ค่าไม่กระทบ business logic ถ้าหายไป 1 view
export async function incrementViewCount(activityId) {
  const { rowCount } = await query(
    `UPDATE activities SET view_count = view_count + 1 WHERE id = $1`,
    [activityId],
  );
  return rowCount > 0;
}
