import { query } from '../db/index.js';

// เลือกเฉพาะ field ที่ public เห็นได้ (ตาม spec จากผู้ใช้):
//   ชื่อ, รายละเอียด, สถานที่, วันจัด, วันรับสมัคร, จำนวนชั่วโมง,
//   จำนวนผู้สมัคร/ที่รับ, สถานะ, หมวด, หน่วยงาน, รูปโปสเตอร์
const SUMMARY_COLUMNS = `
  a.id,
  a.code,
  a.title,
  a.location,
  a.start_at,
  a.end_at,
  a.registration_open_at,
  a.registration_close_at,
  a.hours,
  a.loan_hours,
  a.capacity,
  a.registered_count,
  a.status,
  a.academic_year,
  a.semester,
  c.code AS category_code,
  c.name AS category_name,
  o.code AS organization_code,
  o.name AS organization_name,
  a.view_count,
  a.interested_count,
  poster.storage_key AS poster_storage_key,
  -- คณะที่เปิดรับ — [] = เปิดทุกคณะ (ดู memory: project_eligibility)
  --   ใช้บนการ์ด landing เพื่อบอก "ทุกคณะ / บางคณะ / เฉพาะคณะ"
  COALESCE(
    (SELECT json_agg(
              json_build_object('id', f.id, 'code', f.code, 'name', f.name)
              ORDER BY f.code
            )
       FROM activity_eligible_faculties ef
       JOIN faculties f ON f.id = ef.faculty_id
      WHERE ef.activity_id = a.id),
    '[]'
  ) AS eligible_faculties
`;

const FROM_JOIN = `
  FROM activities a
  JOIN activity_categories c ON c.id = a.category_id
  JOIN organizations       o ON o.id = a.organization_id
  LEFT JOIN activity_files poster
    ON poster.activity_id = a.id AND poster.kind = 'POSTER'
`;

// list (filter: 'open' | 'upcoming' | null=all WORK)
//   open     = status WORK + อยู่ใน registration window
//   upcoming = status WORK + start_at > now()
//   คืน { items, total } — total = จำนวนทั้งหมดที่ตรง filter (ไม่จำกัด limit)
//   รองรับ offset เพื่อแบ่งหน้า/โหลดเพิ่ม (หน้า /activities)
export async function listPublicActivities({ filter = null, limit = 12, offset = 0 } = {}) {
  const where = ["a.status = 'WORK'"];
  if (filter === 'open') {
    where.push('now() BETWEEN a.registration_open_at AND a.registration_close_at');
  } else if (filter === 'upcoming') {
    // "กำลังจะเปิดรับสมัคร" = ยังไม่ถึงวันเปิดรับสมัคร (now < registration_open_at)
    //   → โดยนัยแล้วยังไม่อยู่ในช่วงรับสมัคร → ไม่ทับซ้อนกับ open (open ต้อง now >= open_at)
    where.push('now() < a.registration_open_at');
  }
  const whereSql = where.join(' AND ');

  // เรียงให้กิจกรรมที่ใกล้เริ่มก่อน + ปิดรับสมัครใกล้กว่ามาก่อน
  const orderBy =
    filter === 'open'
      ? 'a.registration_close_at ASC'
      : 'a.start_at ASC';

  const [listRes, countRes] = await Promise.all([
    query(
      `SELECT ${SUMMARY_COLUMNS}
         ${FROM_JOIN}
        WHERE ${whereSql}
        ORDER BY ${orderBy}
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    // count ไม่ต้อง join — filter อ้างเฉพาะคอลัมน์ของ activities a
    query(`SELECT COUNT(*)::int AS total FROM activities a WHERE ${whereSql}`),
  ]);
  return { items: listRes.rows, total: countRes.rows[0].total };
}

// public search: WORK + COMPLETED ทุกปี + match q บน title/code/location/organization
//   - filter ที่ status เข้ม กัน leak DRAFT/PENDING ไม่ตั้งใจ
//   - title/code ใช้ trigram GIN index → ILIKE เร็ว
//   - location/organization name ใช้ ILIKE ปกติ (น้อย row พอรับได้)
//   - เรียงให้ "ตรงกับ title มากสุด" ก่อน (similarity desc) — ใช้ pg_trgm operator <->
//   - tie-break: WORK ก่อน COMPLETED, แล้ว created_at DESC (กิจกรรมล่าสุดก่อน)
export async function searchPublicActivities(q, limit = 20) {
  const pattern = `%${q}%`;
  const { rows } = await query(
    `SELECT ${SUMMARY_COLUMNS}
       ${FROM_JOIN}
      WHERE a.status IN ('WORK','COMPLETED')
        AND (
          a.title ILIKE $1
          OR a.code::text ILIKE $1
          OR a.location ILIKE $1
          OR o.name ILIKE $1
        )
      ORDER BY
        -- ตรงกับ title มากสุดก่อน (lower similarity = ใกล้กว่า)
        similarity(a.title, $2) DESC,
        CASE a.status WHEN 'WORK' THEN 0 ELSE 1 END,
        a.created_at DESC
      LIMIT $3`,
    [pattern, q, limit],
  );
  return rows;
}

// calendar: กิจกรรม (WORK + COMPLETED) ที่ช่วงวันจัด [start_at, end_at] คาบเกี่ยวกับ [from, to)
//   payload เบา — ไม่มี poster/presign (ปฏิทิน landing เรียกบ่อยตอนเลื่อนเดือน)
//   overlap: start_at < to AND end_at >= from
export async function listActivitiesForCalendar({ from, to }) {
  const { rows } = await query(
    `SELECT a.id, a.code, a.title, a.start_at, a.end_at,
            a.capacity, a.registered_count,
            a.registration_open_at, a.registration_close_at,
            c.code AS category_code, c.name AS category_name,
            -- คณะที่เปิดรับ ([] = ทุกคณะ) — panel ใต้ปฏิทินใช้แสดง scope เหมือนการ์ด
            COALESCE(
              (SELECT json_agg(
                        json_build_object('id', f.id, 'code', f.code, 'name', f.name)
                        ORDER BY f.code
                      )
                 FROM activity_eligible_faculties ef
                 JOIN faculties f ON f.id = ef.faculty_id
                WHERE ef.activity_id = a.id),
              '[]'
            ) AS eligible_faculties
       FROM activities a
       JOIN activity_categories c ON c.id = a.category_id
      WHERE a.status IN ('WORK','COMPLETED')
        AND a.start_at < $2
        AND a.end_at   >= $1
      ORDER BY a.start_at ASC`,
    [from, to],
  );
  return rows;
}

// detail: WORK + COMPLETED — ให้ public ดูข้อมูลกิจกรรมที่จบไปแล้วได้
//   (DELETED ตัดออกอัตโนมัติเพราะไม่อยู่ใน whitelist)
export async function getPublicActivityDetail(id) {
  const { rows } = await query(
    `SELECT ${SUMMARY_COLUMNS},
            a.description
       ${FROM_JOIN}
      WHERE a.id = $1 AND a.status IN ('WORK','COMPLETED')`,
    [id],
  );
  const activity = rows[0];
  if (!activity) return null;

  const [skillsRes, posterRes, docsRes] = await Promise.all([
    query(
      `SELECT s.id, s.code, s.name,
              s.parent_id,
              p.code AS parent_code, p.name AS parent_name
         FROM activity_skills aks
         JOIN skills s      ON s.id = aks.skill_id
         LEFT JOIN skills p ON p.id = s.parent_id
        WHERE aks.activity_id = $1
        ORDER BY COALESCE(p.code, s.code), s.code`,
      [id],
    ),
    query(
      `SELECT id, filename, mime_type, size_bytes, storage_key
         FROM activity_files
        WHERE activity_id = $1 AND kind = 'POSTER'
        LIMIT 1`,
      [id],
    ),
    // เอกสารประกอบ — เฉพาะ is_public=true
    query(
      `SELECT id, filename, display_name, mime_type, size_bytes, storage_key
         FROM activity_files
        WHERE activity_id = $1 AND kind = 'DOCUMENT' AND is_public = true
        ORDER BY display_order ASC, uploaded_at ASC`,
      [id],
    ),
  ]);

  return {
    ...activity, // eligible_faculties มากับ SUMMARY_COLUMNS แล้ว ([] = เปิดรับทุกคณะ)
    skills: skillsRes.rows,
    poster: posterRes.rows[0] || null,
    documents: docsRes.rows,
  };
}
