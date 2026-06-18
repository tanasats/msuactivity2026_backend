import { query } from '../db/index.js';

// ── transcript model — ใบระเบียนกิจกรรมนิสิต (ทรานสคริปต์กิจกรรม) ──────────
//
// assemble ข้อมูลทั้งหมดที่ทรานสคริปต์ต้องใช้ "จากแหล่งเดียว" → แตกเป็น
// JSON (preview) / .docx (export) ได้โดยไม่เพี้ยนกัน
//
// กฎการนับ (เหมือนทั้งระบบ): registration ที่ status='ATTENDED' AND
//   evaluation_status='PASSED' เท่านั้น; กิจกรรมที่ถูกลบ (status='DELETED') ตัดออก
//
// สถานภาพในเอกสาร: A=LEADER (ผู้รับผิดชอบโครงการ), B=ORGANIZER (ผู้ดำเนินโครงการ),
//   C=PARTICIPANT (ผู้เข้าร่วมกิจกรรม)

// participant_role → ตัวอักษรสถานภาพในเอกสาร
const ROLE_TO_STATUS = {
  LEADER: 'A',
  ORGANIZER: 'B',
  PARTICIPANT: 'C',
};

// ── (A) รายชื่อนิสิตที่เข้าร่วมครบตามเกณฑ์ ──────────────────────────────
//
// "ครบเกณฑ์" = ผ่าน active cert rule ทั้ง 3 ข้อ (group A ≥ minA, group B ≥ minB,
//   ชั่วโมงรวม ≥ minHours) — คำนวณด้วย SQL aggregate + HAVING ในคิวรีเดียว
//
// filters: q (msu_id/name/email), facultyId
// return { items, total } — แต่ละ item แนบ latest certificate status (ถ้ามี)
export async function listEligibleStudents(rule, {
  q = null,
  facultyId = null,
  limit = 50,
  offset = 0,
} = {}) {
  const allPrefixes = [...rule.group_a_prefixes, ...rule.group_b_prefixes];

  const filters = ['u.role = $5', "u.status = 'active'"];
  // $1..$4 = rule arrays/counts; เริ่ม dynamic param ที่ $6
  const params = [
    rule.group_a_prefixes, // $1
    rule.group_b_prefixes, // $2
    allPrefixes, // $3
    rule.min_total_hours, // $4 (ใช้ใน HAVING)
    'student', // $5
  ];
  if (q) {
    params.push(`%${q}%`);
    filters.push(
      `(u.msu_id ILIKE $${params.length} OR u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`,
    );
  }
  if (facultyId !== null) {
    params.push(facultyId);
    filters.push(`u.faculty_id = $${params.length}`);
  }

  // ตัวคิวรี aggregate ที่ใช้ร่วมกันทั้ง count และ list (HAVING บังคับ 3 ข้อ)
  const eligibleCte = `
    SELECT u.id,
           u.msu_id,
           u.full_name,
           u.email,
           u.faculty_name,
           u.picture_url,
           COUNT(*) FILTER (WHERE LEFT(a.code, 1) = ANY($1::text[]))::int AS group_a_count,
           COUNT(*) FILTER (WHERE LEFT(a.code, 1) = ANY($2::text[]))::int AS group_b_count,
           COALESCE(SUM(a.hours), 0) AS total_hours
      FROM users u
      JOIN registrations r ON r.user_id = u.id
       AND r.status = 'ATTENDED'
       AND r.evaluation_status = 'PASSED'
      JOIN activities a ON a.id = r.activity_id
       AND a.status != 'DELETED'
       AND a.code IS NOT NULL
       AND LEFT(a.code, 1) = ANY($3::text[])
     WHERE ${filters.join(' AND ')}
     GROUP BY u.id
    HAVING COUNT(*) FILTER (WHERE LEFT(a.code, 1) = ANY($1::text[])) >= ${rule.group_a_min_activities}
       AND COUNT(*) FILTER (WHERE LEFT(a.code, 1) = ANY($2::text[])) >= ${rule.group_b_min_activities}
       AND COALESCE(SUM(a.hours), 0) >= $4
  `;

  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM (${eligibleCte}) e`,
    params,
  );
  const total = countRes.rows[0]?.total ?? 0;

  params.push(limit);
  params.push(offset);
  const { rows } = await query(
    `SELECT e.*,
            lc.status AS latest_cert_status,
            lc.requested_at AS latest_cert_requested_at
       FROM (${eligibleCte}) e
       LEFT JOIN LATERAL (
         SELECT status, requested_at
           FROM certificates c
          WHERE c.user_id = e.id
          ORDER BY c.requested_at DESC, c.id DESC
          LIMIT 1
       ) lc ON true
      ORDER BY e.full_name ASC, e.id ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows, total };
}

// ── (B/C) assemble ข้อมูลทรานสคริปต์ของนิสิต 1 คน ──────────────────────
//
// คืน null ถ้าไม่พบ user หรือไม่ใช่ role student
//   header     : ข้อมูลนิสิต (รวม field ที่กรอกเอง: major/degree/admission/ชื่ออังกฤษ)
//   years[]    : [{ academic_year, activities: [{code,title,hours,status_letter,skills[]}] }]
//   summary    : { total_hours, by_skill: [{code,name,hours}], top_skill }
//   org_leader_columns : หัวตาราง "ผู้นำองค์กรนิสิต" (ปล่อยว่างให้ admin กรอกมือ)
export async function getTranscriptData(userId) {
  const { rows: userRows } = await query(
    `SELECT id, msu_id, email, full_name, role,
            prefix_en, name_en, surname_en,
            faculty_name, major_name, degree_name, admission_date,
            picture_url
       FROM users
      WHERE id = $1`,
    [userId],
  );
  const user = userRows[0];
  if (!user || user.role !== 'student') return null;

  // activities ที่ผ่านแล้ว + per-activity skill codes (rollup ถึง parent S1..S5)
  const { rows: acts } = await query(
    `SELECT a.id            AS activity_id,
            a.code          AS activity_code,
            a.title         AS activity_title,
            a.academic_year,
            a.semester,
            a.hours,
            r.participant_role,
            COALESCE(
              ARRAY(
                SELECT DISTINCT COALESCE(sp.code, s.code)
                  FROM activity_skills aks
                  JOIN skills s       ON s.id = aks.skill_id
                  LEFT JOIN skills sp ON sp.id = s.parent_id
                 WHERE aks.activity_id = a.id
                 ORDER BY 1
              ),
              '{}'
            ) AS skill_codes
       FROM registrations r
       JOIN activities a ON a.id = r.activity_id
      WHERE r.user_id = $1
        AND r.status = 'ATTENDED'
        AND r.evaluation_status = 'PASSED'
        AND a.status != 'DELETED'
      ORDER BY a.academic_year DESC, a.start_at ASC, a.id ASC`,
    [userId],
  );

  // group → ปีการศึกษา (DESC) + แปลง role → A/B/C
  const yearMap = new Map();
  for (const a of acts) {
    if (!yearMap.has(a.academic_year)) yearMap.set(a.academic_year, []);
    yearMap.get(a.academic_year).push({
      activity_id: a.activity_id,
      code: a.activity_code,
      title: a.activity_title,
      semester: a.semester,
      hours: Number(a.hours),
      status_letter: ROLE_TO_STATUS[a.participant_role] ?? 'C',
      skills: a.skill_codes,
    });
  }
  const years = [...yearMap.entries()].map(([academic_year, activities]) => ({
    academic_year,
    activities,
  }));

  // summary: total hours + ชั่วโมงต่อทักษะ (นับชั่วโมงต่อทักษะ — กิจกรรมหนึ่งให้กับทุกทักษะที่ติด)
  let totalHours = 0;
  const skillHours = new Map(); // code → hours
  for (const a of acts) {
    totalHours += Number(a.hours);
    for (const code of a.skill_codes) {
      skillHours.set(code, (skillHours.get(code) ?? 0) + Number(a.hours));
    }
  }

  // เติมชื่อทักษะ (parent skills ที่ active) — เห็นครบ S1..S5 แม้ยังไม่มีชั่วโมง
  const { rows: skillRows } = await query(
    `SELECT code, name
       FROM skills
      WHERE parent_id IS NULL AND is_active = true
      ORDER BY code ASC`,
  );
  const bySkill = skillRows.map((s) => ({
    code: s.code,
    name: s.name,
    hours: skillHours.get(s.code) ?? 0,
  }));
  // ทักษะเด่น = ทักษะที่ได้ชั่วโมงมากสุด (>0)
  const topSkill = bySkill.reduce(
    (best, s) => (s.hours > (best?.hours ?? 0) ? s : best),
    null,
  );

  return {
    header: {
      id: user.id,
      msu_id: user.msu_id,
      email: user.email,
      full_name: user.full_name,
      name_en_full: [user.prefix_en, user.name_en, user.surname_en]
        .filter(Boolean)
        .join(' ') || null,
      prefix_en: user.prefix_en,
      name_en: user.name_en,
      surname_en: user.surname_en,
      faculty_name: user.faculty_name,
      major_name: user.major_name,
      degree_name: user.degree_name,
      admission_date: user.admission_date,
      picture_url: user.picture_url,
    },
    years,
    summary: {
      total_hours: totalHours,
      by_skill: bySkill,
      top_skill: topSkill,
    },
    // ผู้นำองค์กรนิสิต — ระบบยังไม่เก็บประวัติ; ส่งหัวคอลัมน์ให้ render เป็นตารางว่าง
    org_leader_columns: ['ปีการศึกษา', 'องค์กรนิสิต', 'ตำแหน่ง'],
  };
}

// ── อัปเดต academic profile (admin กรอกเองตอนออกทรานสคริปต์) ───────────────
//   อนุญาตเฉพาะ field ที่ส่งมา (partial) — undefined = ไม่แตะ
//   คืน updated row | null (ไม่พบ / ไม่ใช่ student)
const PROFILE_FIELDS = [
  'major_name',
  'degree_name',
  'admission_date',
  'prefix_en',
  'name_en',
  'surname_en',
];

export async function updateAcademicProfile(userId, fields) {
  const sets = [];
  const params = [userId];
  for (const key of PROFILE_FIELDS) {
    if (fields[key] === undefined) continue;
    params.push(fields[key] === '' ? null : fields[key]);
    sets.push(`${key} = $${params.length}`);
  }
  if (sets.length === 0) {
    // ไม่มีอะไรให้แก้ — คืน row ปัจจุบัน
    const { rows } = await query(
      `SELECT id, major_name, degree_name, admission_date,
              prefix_en, name_en, surname_en
         FROM users WHERE id = $1 AND role = 'student'`,
      [userId],
    );
    return rows[0] ?? null;
  }
  const { rows } = await query(
    `UPDATE users
        SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $1 AND role = 'student'
      RETURNING id, major_name, degree_name, admission_date,
                prefix_en, name_en, surname_en`,
    params,
  );
  return rows[0] ?? null;
}
