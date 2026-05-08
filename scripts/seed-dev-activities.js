// Dev seed: สร้างกิจกรรมตัวอย่างสำหรับทดสอบ landing page (idempotent)
// รัน: `npm run seed:dev`
// ลบของเก่าที่ seed นี้สร้าง (อ้างอิงจาก dummy user) แล้ว insert ใหม่ — ไม่กระทบข้อมูล production
//
// สร้าง:
//   - 1 dummy faculty_staff user (สำหรับ created_by)
//   - 6 activities: 3 เปิดรับสมัคร + 3 กำลังจะมา (registration ยังไม่เปิด)
//   - 2 activities ที่จบไปแล้ว (COMPLETED) + registrations + attendances → ป้อนตัวเลข stats
//   - กิจกรรมที่ flag seed_registered_count: ใส่ REGISTERED rows + qr_token เพื่อ demo flow check-in
//
// faculties มาจาก migration #012 (master จริงของ มมส) — seed ไม่ต้อง insert/CHECK เอง

import crypto from 'node:crypto';
import 'dotenv/config';
import { pool, query } from '../src/db/index.js';
import { getCurrentAcademicYearBE } from '../src/utils/academic-year.js';
import { putObject } from '../src/utils/s3.js';

// Tiny 1x1 PNG (placeholder) — base64 ของ 1×1 transparent PNG
// ใช้สำหรับ seed demo เพื่อให้ activity ทุกตัวมี poster ทดสอบ flow ได้
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12NgYGAAAAAEAAGjChXjAAAAAElFTkSuQmCC',
  'base64',
);

const DUMMY_EMAIL = 'dev-seed@msu.ac.th';
const ACADEMIC_YEAR = getCurrentAcademicYearBE();
const SEMESTER = 2;

// dummy user สังกัดคณะวิทยาการสารสนเทศ (code '12', id=11) — ใช้สำหรับ seed activity.faculty_id
const DUMMY_FACULTY_ID = 11;

async function ensureDummyUser() {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [DUMMY_EMAIL]);
  if (rows[0]) {
    // ensure faculty_id ตั้งไว้ — ถ้า null ให้ update เป็น default
    if (rows[0].faculty_id == null) {
      await query('UPDATE users SET faculty_id = $1 WHERE id = $2', [
        DUMMY_FACULTY_ID,
        rows[0].id,
      ]);
      rows[0].faculty_id = DUMMY_FACULTY_ID;
    }
    return rows[0];
  }
  const { rows: inserted } = await query(
    `INSERT INTO users (email, full_name, role, status, faculty_id)
     VALUES ($1, $2, 'faculty_staff', 'active', $3)
     RETURNING *`,
    [DUMMY_EMAIL, 'Dev Seed Faculty Staff', DUMMY_FACULTY_ID],
  );
  console.log(`  + created dummy user id=${inserted[0].id}`);
  return inserted[0];
}

async function lookupRefs() {
  const [orgs, cats, skills, faculties] = await Promise.all([
    query('SELECT id, code FROM organizations ORDER BY code'),
    query('SELECT id, code FROM activity_categories ORDER BY code'),
    query('SELECT id, code FROM skills ORDER BY code'),
    query('SELECT id, code FROM faculties ORDER BY code'),
  ]);
  return {
    orgs: Object.fromEntries(orgs.rows.map((r) => [r.code, r.id])),
    cats: Object.fromEntries(cats.rows.map((r) => [String(r.code), r.id])),
    skills: Object.fromEntries(skills.rows.map((r) => [r.code, r.id])),
    faculties: Object.fromEntries(faculties.rows.map((r) => [r.code, r.id])),
  };
}

async function cleanPreviousSeed(userId) {
  // ลบลูกหลานก่อน (FK RESTRICT)
  await query(
    `DELETE FROM attendances
       WHERE registration_id IN (
         SELECT r.id FROM registrations r
           JOIN activities a ON a.id = r.activity_id
          WHERE a.created_by = $1
       )`,
    [userId],
  );
  await query(
    `DELETE FROM registrations
       WHERE activity_id IN (SELECT id FROM activities WHERE created_by = $1)`,
    [userId],
  );
  // m2m tables CASCADE on activity delete แล้ว
  await query('DELETE FROM activities WHERE created_by = $1', [userId]);
}

const day = (n) => 1000 * 60 * 60 * 24 * n;
const hour = (n) => 1000 * 60 * 60 * n;
const now = () => new Date();
const offset = (ms) => new Date(now().getTime() + ms);

// blueprint สำหรับ 8 กิจกรรม
function buildActivities(refs) {
  const ORG_A = refs.orgs.A001;
  const ORG_B001 = refs.orgs.B001;
  const ORG_B002 = refs.orgs.B002;
  const CAT_1 = refs.cats['1'];
  const CAT_2 = refs.cats['2'];
  const CAT_3 = refs.cats['3'];
  const CAT_4 = refs.cats['4'];

  return [
    // ── เปิดรับสมัคร (3) ──
    {
      title: 'อบรมการเขียน Resume สำหรับนิสิตปี 4',
      description:
        'workshop เตรียมความพร้อมก่อนสมัครงาน เน้นการเขียน resume และเตรียมตัวสัมภาษณ์',
      location: 'ห้องประชุม IT-202 คณะวิทยาการสารสนเทศ',
      organization_id: ORG_B001,
      category_id: CAT_1,
      hours: 2.5, // demo decimal

      capacity: 80,
      // window check-in กว้างเผื่อ demo (เปิดตอนนี้, ปิดอีก 30 วัน)
      check_in_opens_at: offset(-hour(1)),
      check_in_closes_at: offset(day(30)),
      registration_open_at: offset(-day(2)),
      registration_close_at: offset(day(7)),
      start_at: offset(day(10) + hour(9)),
      end_at: offset(day(10) + hour(12)),
      skills: ['S1', 'S2'],
      eligible_faculties: [],
      seed_registered_count: 10, // demo: ใส่ REGISTERED + qr_token 10 คน
    },
    {
      title: 'แข่งขันบาสเกตบอลภายใน รอบคัดเลือก',
      description: 'ทีมระดับคณะ แข่งขันรอบคัดเลือกเพื่อเข้ารอบกีฬามหาวิทยาลัย',
      location: 'อาคารพละศึกษา มมส',
      organization_id: ORG_B002,
      category_id: CAT_2,
      hours: 4,
      capacity: 120,
      check_in_opens_at: offset(-hour(1)),
      check_in_closes_at: offset(day(30)),
      registration_open_at: offset(-day(5)),
      registration_close_at: offset(day(3)),
      start_at: offset(day(14) + hour(13)),
      end_at: offset(day(14) + hour(17)),
      skills: ['S1', 'S5'],
      eligible_faculties: [],
      seed_registered_count: 8,
    },
    {
      title: 'จิตอาสาทำความสะอาดวัดสว่างวารี',
      description: 'กิจกรรมบำเพ็ญประโยชน์ ทำความสะอาดและทาสีศาลา',
      location: 'วัดสว่างวารี อ.กันทรวิชัย',
      organization_id: ORG_A,
      category_id: CAT_3,
      hours: 6,
      loan_hours: 6, // จิตอาสาเข้าเงื่อนไข กยศ

      capacity: 50,
      registration_open_at: offset(-day(1)),
      registration_close_at: offset(day(10)),
      start_at: offset(day(20) + hour(8)),
      end_at: offset(day(20) + hour(14)),
      skills: ['S1', 'S3'],
      eligible_faculties: ['12', '02'], // วิทยาการสารสนเทศ + วิทยาศาสตร์
    },

    // ── กำลังจะมา / ยังไม่เปิดรับสมัคร (3) ──
    {
      title: 'งานลอยกระทงและการประกวดนางนพมาศ',
      description: 'งานประจำปีของมหาวิทยาลัย รวมการแสดงและการประกวดศิลปวัฒนธรรม',
      location: 'หน้าอาคารบรมราชกุมารี',
      organization_id: ORG_A,
      category_id: CAT_4,
      hours: 5,
      capacity: 500,
      registration_open_at: offset(day(15)),
      registration_close_at: offset(day(35)),
      start_at: offset(day(40) + hour(17)),
      end_at: offset(day(40) + hour(22)),
      skills: ['S4'],
      eligible_faculties: [],
    },
    {
      title: 'สัมมนา Soft Skills สำหรับการทำงานในยุคดิจิทัล',
      description: 'วิทยากรจากภาคอุตสาหกรรม บรรยายเรื่องทักษะที่จำเป็นในศตวรรษที่ 21',
      location: 'หอประชุมเฉลิมพระเกียรติ',
      organization_id: ORG_B001,
      category_id: CAT_1,
      hours: 4,
      capacity: 200,
      registration_open_at: offset(day(20)),
      registration_close_at: offset(day(45)),
      start_at: offset(day(50) + hour(13)),
      end_at: offset(day(50) + hour(17)),
      skills: ['S2', 'S3', 'S4'],
      eligible_faculties: [],
    },
    {
      title: 'ค่ายผู้นำนิสิต รุ่นที่ 12',
      description: 'ค่ายอบรมพัฒนาภาวะผู้นำสำหรับนายกสโมสรและประธานชมรม',
      location: 'รีสอร์ทเขื่อนอุบลรัตน์ จ.ขอนแก่น',
      organization_id: ORG_B001,
      category_id: CAT_1,
      hours: 16,
      capacity: 60,
      registration_open_at: offset(day(7)),
      registration_close_at: offset(day(25)),
      start_at: offset(day(30) + hour(8)),
      end_at: offset(day(32) + hour(17)),
      skills: ['S1', 'S5'],
      eligible_faculties: [],
    },

    // ── จบไปแล้ว (2) — ใช้สร้าง stats ผู้เข้าร่วม + ชั่วโมง ──
    {
      title: 'ปฐมนิเทศนิสิตใหม่ ภาคต้น',
      description: 'งานต้อนรับนิสิตใหม่ทั้งมหาวิทยาลัย',
      location: 'หอประชุมใหญ่',
      organization_id: ORG_A,
      category_id: CAT_1,
      hours: 6,
      capacity: 5000,
      registration_open_at: offset(-day(120)),
      registration_close_at: offset(-day(95)),
      start_at: offset(-day(90) + hour(8)),
      end_at: offset(-day(90) + hour(14)),
      skills: ['S1'],
      eligible_faculties: [],
      status: 'COMPLETED',
      attended_count: 1200,
    },
    {
      title: 'แข่งขันกีฬาสีภายในคณะ',
      description: 'การแข่งขันกีฬาระหว่างสาขา',
      location: 'สนามกีฬากลาง',
      organization_id: ORG_B002,
      category_id: CAT_2,
      hours: 8,
      capacity: 800,
      registration_open_at: offset(-day(60)),
      registration_close_at: offset(-day(40)),
      start_at: offset(-day(35) + hour(8)),
      end_at: offset(-day(35) + hour(16)),
      skills: ['S1', 'S5'],
      eligible_faculties: [],
      status: 'COMPLETED',
      attended_count: 350,
    },
  ];
}

async function insertActivity(userId, facultyId, blueprint, refs) {
  const status = blueprint.status || 'WORK';
  const { rows } = await query(
    `INSERT INTO activities (
       title, description, location,
       organization_id, category_id, created_by, faculty_id,
       academic_year, semester,
       hours, loan_hours, capacity,
       start_at, end_at,
       registration_open_at, registration_close_at,
       check_in_opens_at, check_in_closes_at,
       budget_source, budget_requested, budget_actual,
       status, published_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
       CASE WHEN $22::activity_status IN ('WORK','COMPLETED') THEN now() ELSE NULL END
     )
     RETURNING id`,
    [
      blueprint.title,
      blueprint.description,
      blueprint.location,
      blueprint.organization_id,
      blueprint.category_id,
      userId,
      facultyId,
      ACADEMIC_YEAR,
      SEMESTER,
      blueprint.hours,
      blueprint.loan_hours ?? 0,
      blueprint.capacity,
      blueprint.start_at,
      blueprint.end_at,
      blueprint.registration_open_at,
      blueprint.registration_close_at,
      blueprint.check_in_opens_at ?? null,
      blueprint.check_in_closes_at ?? null,
      blueprint.budget_source ?? 'งบกิจการนิสิต',
      blueprint.budget_requested ?? 5000,
      blueprint.budget_actual ?? null,
      status,
    ],
  );
  const activityId = rows[0].id;

  // skills
  for (const skillCode of blueprint.skills) {
    const skillId = refs.skills[skillCode];
    if (!skillId) throw new Error(`Skill not found: ${skillCode}`);
    await query(
      'INSERT INTO activity_skills (activity_id, skill_id) VALUES ($1,$2)',
      [activityId, skillId],
    );
  }
  // eligible faculties (ว่าง = ทุกคณะ)
  for (const facCode of blueprint.eligible_faculties || []) {
    const facId = refs.faculties[facCode];
    if (!facId) throw new Error(`Faculty not found: ${facCode}`);
    await query(
      'INSERT INTO activity_eligible_faculties (activity_id, faculty_id) VALUES ($1,$2)',
      [activityId, facId],
    );
  }

  // upload dummy poster ทุก activity — ใช้ 1×1 PNG เพื่อ verify flow landing/detail
  await seedPoster(activityId, userId);

  // ถ้าเป็น COMPLETED → fake registrations + attendances ตาม attended_count
  if (status === 'COMPLETED' && blueprint.attended_count) {
    await fakeAttendances(activityId, userId, blueprint.attended_count, blueprint.start_at);
  }

  // ถ้าเป็น WORK + flag seed_registered_count → ใส่ REGISTERED + qr_token เพื่อ demo flow check-in
  if (status === 'WORK' && blueprint.seed_registered_count) {
    await seedRegisteredWithQr(activityId, blueprint.seed_registered_count);
  }

  return activityId;
}

// สร้าง dummy registrations + attendances โดยใช้ user_id ของ dummy user เพื่อ FK ผ่าน
// (ใน production จะมีหลาย user; แต่ stats นี้นับ DISTINCT user_id ดังนั้น 1 user → ผู้เข้าร่วม=1)
// เพื่อให้ stats สมจริง ให้ count ใน attendance ตรงกับ attended_count (ผู้เข้าร่วมทั้งหมด)
// แต่ DISTINCT user_id ก็ยังคงเป็น 1 ต่อ activity — จะออกมาน้อยลง
//
// แก้: สร้าง dummy student users หลายคน
async function fakeAttendances(activityId, dummyFacultyUserId, count, activityStartAt) {
  // หา/สร้าง dummy student pool (สูงสุด 50 user, recycle เพื่อกัน DB บวมเวลา seed ซ้ำ)
  const studentIds = [];
  for (let i = 1; i <= Math.min(count, 50); i += 1) {
    const email = `dev-seed-student-${i}@msu.ac.th`;
    const msuId = `99999999${String(i).padStart(3, '0')}`;
    const fullName = `Dev Seed Student ${i}`;
    const { rows } = await query(
      `INSERT INTO users (email, full_name, msu_id, role, status)
       VALUES ($1,$2,$3,'student','active')
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
      [email, fullName, msuId],
    );
    studentIds.push(rows[0].id);
  }

  // Update registered_count ให้ตรง count (ไม่ใช้ atomic counter เพราะนี่ seed)
  await query('UPDATE activities SET registered_count = $2 WHERE id = $1', [
    activityId,
    Math.min(count, 5000),
  ]);

  // เก็บ attendance ให้ unique user count = count (≤ 50 ต่อกิจกรรม seed นี้)
  for (const userId of studentIds) {
    const { rows: regRows } = await query(
      `INSERT INTO registrations (user_id, activity_id, status, registered_at, attended_at)
       VALUES ($1,$2,'ATTENDED',$3,$3) RETURNING id`,
      [userId, activityId, activityStartAt],
    );
    await query(
      `INSERT INTO attendances (registration_id, method, status, checked_in_at)
       VALUES ($1,'MANUAL_STAFF','VALID',$2)`,
      [regRows[0].id, activityStartAt],
    );
  }
}

// upload dummy 1×1 PNG ไป MinIO + insert activity_files row (POSTER)
async function seedPoster(activityId, userId) {
  const key = `posters/${crypto.randomUUID()}.png`;
  try {
    await putObject({ key, body: TINY_PNG, contentType: 'image/png' });
  } catch (err) {
    console.warn(`  [poster skip] activity #${activityId}: ${err.message}`);
    return;
  }
  await query(
    `INSERT INTO activity_files
       (activity_id, kind, filename, mime_type, size_bytes, storage_key, uploaded_by)
     VALUES ($1, 'POSTER', 'dev-seed-poster.png', 'image/png', $2, $3, $4)`,
    [activityId, TINY_PNG.length, key, userId],
  );
}

// ใส่ registrations status='REGISTERED' + qr_token (UUID จาก gen_random_uuid())
// reuse dummy student pool 1..count (ต้อง upsert เผื่อ pool ยังไม่มี)
async function seedRegisteredWithQr(activityId, count) {
  // ensure dummy students 1..count
  const studentIds = [];
  for (let i = 1; i <= count; i += 1) {
    const email = `dev-seed-student-${i}@msu.ac.th`;
    const msuId = `99999999${String(i).padStart(3, '0')}`;
    const fullName = `Dev Seed Student ${i}`;
    const { rows } = await query(
      `INSERT INTO users (email, full_name, msu_id, role, status)
       VALUES ($1,$2,$3,'student','active')
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
      [email, fullName, msuId],
    );
    studentIds.push(rows[0].id);
  }

  for (const userId of studentIds) {
    await query(
      `INSERT INTO registrations (user_id, activity_id, status, qr_token)
       VALUES ($1, $2, 'REGISTERED', gen_random_uuid())`,
      [userId, activityId],
    );
  }

  await query(
    'UPDATE activities SET registered_count = $2 WHERE id = $1',
    [activityId, count],
  );
}

async function main() {
  console.log(`▶ seeding dev activities for academic year ${ACADEMIC_YEAR}/${SEMESTER}...`);
  const dummyUser = await ensureDummyUser();
  console.log(`  cleanup previous seed for user_id=${dummyUser.id}`);
  await cleanPreviousSeed(dummyUser.id);

  const refs = await lookupRefs();
  const blueprints = buildActivities(refs);
  for (const bp of blueprints) {
    const id = await insertActivity(
      dummyUser.id,
      dummyUser.faculty_id,
      bp,
      refs,
    );
    console.log(`  + activity #${id}: ${bp.title} [${bp.status || 'WORK'}]`);
  }

  console.log(`✔ seeded ${blueprints.length} activities`);
}

main()
  .catch((err) => {
    console.error('seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
