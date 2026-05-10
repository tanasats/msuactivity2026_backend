import { query } from '../db/index.js';

// นิสิต MSU = อีเมลรหัสนิสิต 11 หลักเป๊ะ @msu.ac.th (เช่น 65010999001@msu.ac.th)
const STUDENT_EMAIL_REGEX = /^(\d{11})@msu\.ac\.th$/;

export async function findByEmail(email) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [
    email.toLowerCase(),
  ]);
  return rows[0] || null;
}

export async function findById(id) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function createUser({
  email,
  full_name,
  role,
  msu_id = null,
  faculty_id = null,
  google_sub = null,
  picture_url = null,
}) {
  // faculty_name derive จาก subquery — sync กับ faculty_id อัตโนมัติ
  const { rows } = await query(
    `INSERT INTO users
       (email, full_name, role, msu_id, faculty_id, faculty_name, google_sub, picture_url)
     VALUES ($1, $2, $3, $4, $5,
             (SELECT name FROM faculties WHERE id = $5),
             $6, $7)
     RETURNING *`,
    [email.toLowerCase(), full_name, role, msu_id, faculty_id, google_sub, picture_url],
  );
  return rows[0];
}

export async function updateGoogleProfile(id, { full_name, google_sub, picture_url }) {
  await query(
    `UPDATE users SET
       full_name   = COALESCE($2, full_name),
       google_sub  = COALESCE($3, google_sub),
       picture_url = COALESCE($4, picture_url)
     WHERE id = $1`,
    [id, full_name,google_sub, picture_url],
  );
}

export async function updateLastLogin(id) {
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [id]);
}

/**
 * บันทึกข้อมูลที่ดึงมาจาก ERP — เรียกเฉพาะ non-student
 * รับ data shape ตามที่ ERP ส่งคืน (snake_case ตาม API)
 */
export async function syncStaffProfileFromErp(userId, erpData) {
  await query(
    `UPDATE users SET
       staff_id            = $2,
       prefix_th           = $3,
       prefix_en           = $4,
       name_th             = $5,
       surname_th          = $6,
       name_en             = $7,
       surname_en          = $8,
       position_th         = $9,
       phone               = $10,
       erp_faculty_id      = $11,
       erp_faculty_name    = $12,
       erp_department_id   = $13,
       erp_department_name = $14,
       erp_program_id      = $15,
       erp_program_name    = $16,
       full_name           = COALESCE($17, full_name),
       erp_synced_at       = now()
     WHERE id = $1`,
    [
      userId,
      erpData.staffid ?? null,
      erpData.prefixfullname ?? null,
      erpData.prefixinitialseng ?? null,
      erpData.staffname ?? null,
      erpData.staffsurname ?? null,
      erpData.staffnameeng ?? null,
      erpData.staffsurnameeng ?? null,
      erpData.posnameth ?? null,
      erpData.staffphone1 ?? null,
      erpData.facultyid ?? null,
      erpData.facultyname ?? null,
      erpData.departmentid ?? null,
      erpData.departmentname ?? null,
      erpData.programid ?? null,
      erpData.programname ?? null,
      erpData.namefully ?? null,
    ],
  );
}

// คืน role default สำหรับ first login (อีเมลผ่าน hd=msu.ac.th แล้ว)
//   - 11-digit pattern  → 'student'
//   - อื่นๆ              → 'staff' (default ไม่มีสิทธิ์, รอ admin/super_admin promote)
export function detectRoleFromEmail(email) {
  return STUDENT_EMAIL_REGEX.test(email.toLowerCase()) ? 'student' : 'staff';
}

export function extractMsuId(email) {
  const match = email.toLowerCase().match(STUDENT_EMAIL_REGEX);
  return match ? match[1] : null;
}

// รหัสนิสิต 11 หลัก: ตำแหน่งที่ 5-6 (1-indexed) คือ "รหัสคณะ" ตรงกับ faculties.code
// เช่น 65010999001 → "01" = คณะมนุษยศาสตร์ฯ
export function extractFacultyCodeFromMsuId(msuId) {
  if (!msuId || msuId.length !== 11) return null;
  return msuId.slice(4, 6);
}

export async function findFacultyIdByCode(code) {
  if (!code) return null;
  const { rows } = await query('SELECT id FROM faculties WHERE code = $1', [code]);
  return rows[0]?.id ?? null;
}

// ค้น faculty ด้วยชื่อ (ใช้กับ erp_faculty_name ของบุคลากร)
//   - trim ทั้ง 2 ฝั่งเผื่อ ERP มี whitespace
//   - exact match (Thai matching ตรงเป๊ะ)
export async function findFacultyIdByName(name) {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const { rows } = await query(
    `SELECT id FROM faculties WHERE TRIM(name) = $1 LIMIT 1`,
    [trimmed],
  );
  return rows[0]?.id ?? null;
}

// set users.faculty_id + faculty_name พร้อมกัน (ใช้ตอน first-time map จาก ERP / msu_id)
//   faculty_name derive ผ่าน subquery — sync กับ faculty_id เสมอ
export async function setFacultyId(userId, facultyId) {
  await query(
    `UPDATE users
        SET faculty_id   = $2,
            faculty_name = (SELECT name FROM faculties WHERE id = $2)
      WHERE id = $1`,
    [userId, facultyId],
  );
}
