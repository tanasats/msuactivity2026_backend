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
  poster.storage_key AS poster_storage_key
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
export async function listPublicActivities({ filter = null, limit = 12 } = {}) {
  const where = ["a.status = 'WORK'"];
  if (filter === 'open') {
    where.push('now() BETWEEN a.registration_open_at AND a.registration_close_at');
  } else if (filter === 'upcoming') {
    where.push('a.start_at > now()');
  }

  // เรียงให้กิจกรรมที่ใกล้เริ่มก่อน + ปิดรับสมัครใกล้กว่ามาก่อน
  const orderBy =
    filter === 'open'
      ? 'a.registration_close_at ASC'
      : 'a.start_at ASC';

  const { rows } = await query(
    `SELECT ${SUMMARY_COLUMNS}
       ${FROM_JOIN}
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT $1`,
    [limit],
  );
  return rows;
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

  const [skillsRes, facultiesRes, posterRes, docsRes] = await Promise.all([
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
      `SELECT f.id, f.code, f.name
         FROM activity_eligible_faculties ef
         JOIN faculties f ON f.id = ef.faculty_id
        WHERE ef.activity_id = $1
        ORDER BY f.code`,
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
    ...activity,
    skills: skillsRes.rows,
    eligible_faculties: facultiesRes.rows, // [] = เปิดรับทุกคณะ (ดู memory: project_eligibility)
    poster: posterRes.rows[0] || null,
    documents: docsRes.rows,
  };
}
