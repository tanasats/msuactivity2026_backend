import { pool, query } from '../db/index.js';

// Scope ของ faculty_staff (hybrid):
//   - "เห็น" = activity ทุกตัวที่ faculty_id ตรงกับคณะของผู้ขอ
//   - "แก้ได้" = เฉพาะที่ created_by = ตัวเอง (เช็คใน controller)
//
// activity.faculty_id = snapshot ของ users.faculty_id ตอนสร้าง (denormalized
//   ตั้งแต่ migration #018) — ใช้ scope query เร็วโดยไม่ JOIN users

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
  a.capacity,
  a.registered_count,
  a.status,
  a.academic_year,
  a.semester,
  a.created_by,
  a.faculty_id,
  a.organization_id,
  a.category_id,
  a.loan_hours,
  a.budget_source,
  a.budget_requested,
  a.budget_actual,
  a.created_at,
  a.updated_at,
  c.code AS category_code,
  c.name AS category_name,
  o.code AS organization_code,
  o.name AS organization_name,
  u.full_name AS created_by_name
`;

const FROM_JOIN = `
  FROM activities a
  JOIN users u                ON u.id = a.created_by
  JOIN activity_categories c  ON c.id = a.category_id
  JOIN organizations o        ON o.id = a.organization_id
`;

// list: เห็นของคณะตัวเอง (โดย default) — filter ?mine=true เพื่อกรองเฉพาะของตัวเอง
//   academicYear (BE) optional → filter เฉพาะปีนั้น
export async function listByFaculty({
  facultyId,
  requesterId,
  status = null,
  mineOnly = false,
  academicYear = null,
  search = null,
  limit = 50,
} = {}) {
  const where = ['a.faculty_id = $1'];
  const params = [facultyId];

  if (status) {
    params.push(status);
    where.push(`a.status = $${params.length}`);
  }
  if (mineOnly) {
    params.push(requesterId);
    where.push(`a.created_by = $${params.length}`);
  }
  if (academicYear !== null) {
    params.push(academicYear);
    where.push(`a.academic_year = $${params.length}`);
  }
  if (search) {
    // ค้นในชื่อกิจกรรม + code (case-insensitive)
    params.push(`%${search.toLowerCase()}%`);
    where.push(
      `(LOWER(a.title) LIKE $${params.length} OR LOWER(COALESCE(a.code, '')) LIKE $${params.length})`,
    );
  }

  params.push(limit);

  const { rows } = await query(
    `SELECT ${SUMMARY_COLUMNS}
       ${FROM_JOIN}
      WHERE ${where.join(' AND ')}
      ORDER BY a.updated_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

// detail: full row + skills + eligible_faculties
// เฉพาะถ้าผู้ขอเห็นได้ (อยู่ในคณะเดียวกัน) — controller validate ก่อนเรียก
export async function findById(id) {
  const { rows } = await query(
    `SELECT ${SUMMARY_COLUMNS},
            a.description,
            a.approval_mode,
            a.check_in_opens_at,
            a.check_in_closes_at,
            a.rejection_reason,
            a.approved_at,
            a.approved_by,
            a.published_at,
            a.faculty_id AS created_by_faculty_id
       ${FROM_JOIN}
      WHERE a.id = $1`,
    [id],
  );
  const activity = rows[0];
  if (!activity) return null;

  const [skillsRes, facultiesRes, posterRes, docsRes] = await Promise.all([
    query(
      `SELECT s.id, s.code, s.name
         FROM activity_skills aks
         JOIN skills s ON s.id = aks.skill_id
        WHERE aks.activity_id = $1
        ORDER BY s.code`,
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
      `SELECT id, filename, mime_type, size_bytes, storage_key, uploaded_at
         FROM activity_files
        WHERE activity_id = $1 AND kind = 'POSTER'
        LIMIT 1`,
      [id],
    ),
    query(
      `SELECT id, filename, display_name, mime_type, size_bytes, storage_key,
              is_public, uploaded_at
         FROM activity_files
        WHERE activity_id = $1 AND kind = 'DOCUMENT'
        ORDER BY display_order ASC, uploaded_at ASC`,
      [id],
    ),
  ]);

  return {
    ...activity,
    skills: skillsRes.rows,
    eligible_faculties: facultiesRes.rows,
    poster: posterRes.rows[0] || null,
    documents: docsRes.rows,
  };
}

// นับ activities ของคณะแยกตาม status (สำหรับ overview)
// คืน object: { DRAFT: n, PENDING_APPROVAL: n, ... } — ทุก status enum
//   academicYear (BE) optional → filter เฉพาะปีนั้น (default: ทุกปี)
export async function countByStatus(facultyId, academicYear = null) {
  const params = [facultyId];
  let yearFilter = '';
  if (academicYear !== null) {
    params.push(academicYear);
    yearFilter = ` AND academic_year = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT status, COUNT(*)::int AS count
       FROM activities
      WHERE faculty_id = $1${yearFilter}
      GROUP BY status`,
    params,
  );
  // initial 0 ทุก status เพื่อ frontend อ่านได้สม่ำเสมอ
  const counts = {
    DRAFT: 0,
    PENDING_APPROVAL: 0,
    WORK: 0,
    COMPLETED: 0,
  };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

// แยกของตัวเอง (สำหรับ "งานของฉัน" section บน overview)
export async function countMineByStatus(requesterId, academicYear = null) {
  const params = [requesterId];
  let yearFilter = '';
  if (academicYear !== null) {
    params.push(academicYear);
    yearFilter = ` AND academic_year = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT status, COUNT(*)::int AS count
       FROM activities
      WHERE created_by = $1${yearFilter}
      GROUP BY status`,
    params,
  );
  const counts = {
    DRAFT: 0,
    PENDING_APPROVAL: 0,
    WORK: 0,
    COMPLETED: 0,
  };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

// คืนปีการศึกษาที่ใช้งานทั้งหมดในคณะ — เรียงล่าสุดก่อน
//   ใช้ populate dropdown ปีในหน้า dashboard ของเจ้าหน้าที่คณะ
export async function listAcademicYearsByFaculty(facultyId) {
  const { rows } = await query(
    `SELECT DISTINCT academic_year
       FROM activities
      WHERE faculty_id = $1
      ORDER BY academic_year DESC`,
    [facultyId],
  );
  return rows.map((r) => r.academic_year);
}

// ── write operations ─────────────────────────────────────────────

// fields ของ activities ที่ controller รับมาเขียน — exclude managed fields
// (id/code/created_by/registered_count/status/timestamps/approved/published/rejection)
const WRITABLE_FIELDS = [
  'title',
  'description',
  'location',
  'organization_id',
  'category_id',
  'academic_year',
  'semester',
  'hours',
  'loan_hours',
  'capacity',
  'start_at',
  'end_at',
  'registration_open_at',
  'registration_close_at',
  'approval_mode',
  'check_in_opens_at',
  'check_in_closes_at',
  'budget_source',
  'budget_requested',
  'budget_actual',
];

// helper: replace m2m table rows ภายใน transaction client
async function replaceM2m(client, table, activityId, key, valueColumn, values) {
  await client.query(`DELETE FROM ${table} WHERE activity_id = $1`, [activityId]);
  for (const v of values) {
    await client.query(
      `INSERT INTO ${table} (activity_id, ${valueColumn}) VALUES ($1, $2)`,
      [activityId, v],
    );
  }
}

// create: ทุก write ใน transaction (activity + m2m + poster file row)
// payload = { ...WRITABLE_FIELDS, skill_ids[], eligible_faculty_ids[],
//             poster: { storage_key, filename, mime_type, size_bytes } } (poster required)
// createdByFacultyId: snapshot ของ users.faculty_id ตอนสร้าง — ใช้ scope กิจกรรมระดับคณะ
export async function createActivity(payload, createdBy, createdByFacultyId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cols = ['created_by', 'faculty_id', ...WRITABLE_FIELDS];
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
    const values = [
      createdBy,
      createdByFacultyId,
      ...WRITABLE_FIELDS.map((f) => payload[f] ?? null),
    ];
    const { rows } = await client.query(
      `INSERT INTO activities (${cols.join(',')}) VALUES (${placeholders}) RETURNING id`,
      values,
    );
    const activityId = rows[0].id;

    await replaceM2m(
      client,
      'activity_skills',
      activityId,
      'skill_id',
      'skill_id',
      payload.skill_ids || [],
    );
    await replaceM2m(
      client,
      'activity_eligible_faculties',
      activityId,
      'faculty_id',
      'faculty_id',
      payload.eligible_faculty_ids || [],
    );

    // poster (required at create — controller validate ก่อน)
    await client.query(
      `INSERT INTO activity_files
         (activity_id, kind, filename, mime_type, size_bytes, storage_key, uploaded_by)
       VALUES ($1, 'POSTER', $2, $3, $4, $5, $6)`,
      [
        activityId,
        payload.poster.filename,
        payload.poster.mime_type,
        payload.poster.size_bytes,
        payload.poster.storage_key,
        createdBy,
      ],
    );

    await client.query('COMMIT');
    return activityId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// update: เปลี่ยน writable fields + replace m2m + (ถ้ามี) เปลี่ยน poster
// caller ต้อง validate ownership + status เปิดให้แก้ ก่อนเรียก
// คืน { oldPosterStorageKey } ถ้าเปลี่ยน poster — caller ใช้ลบออบเจ็กต์เก่าใน S3 (best-effort)
export async function updateActivity(id, payload, updatedBy) {
  const client = await pool.connect();
  let oldPosterStorageKey = null;
  try {
    await client.query('BEGIN');

    const setCols = WRITABLE_FIELDS.map((f, i) => `${f} = $${i + 2}`).join(',');
    const values = [id, ...WRITABLE_FIELDS.map((f) => payload[f] ?? null)];
    await client.query(
      `UPDATE activities SET ${setCols}, updated_at = now() WHERE id = $1`,
      values,
    );

    if (payload.skill_ids !== undefined) {
      await replaceM2m(
        client,
        'activity_skills',
        id,
        'skill_id',
        'skill_id',
        payload.skill_ids,
      );
    }
    if (payload.eligible_faculty_ids !== undefined) {
      await replaceM2m(
        client,
        'activity_eligible_faculties',
        id,
        'faculty_id',
        'faculty_id',
        payload.eligible_faculty_ids,
      );
    }

    // poster: ถ้าส่งใหม่ → DELETE old + INSERT (อ่าน old storage_key เพื่อ caller ลบ)
    //   ★ guard สำคัญ: ถ้า storage_key เดียวกับของเดิม (frontend ส่ง preview poster เดิมมา
    //     โดยไม่ได้เปลี่ยนรูป) → SKIP ทั้งหมด ไม่งั้น DELETE+INSERT จะทำให้ caller ลบ
    //     object ที่ DB ยังอ้างถึง = poster หายจาก MinIO
    if (payload.poster) {
      const { rows: oldRows } = await client.query(
        `SELECT storage_key FROM activity_files
          WHERE activity_id = $1 AND kind = 'POSTER'`,
        [id],
      );
      const oldKey = oldRows[0]?.storage_key ?? null;

      if (oldKey !== payload.poster.storage_key) {
        oldPosterStorageKey = oldKey;
        await client.query(
          `DELETE FROM activity_files WHERE activity_id = $1 AND kind = 'POSTER'`,
          [id],
        );
        await client.query(
          `INSERT INTO activity_files
             (activity_id, kind, filename, mime_type, size_bytes, storage_key, uploaded_by)
           VALUES ($1, 'POSTER', $2, $3, $4, $5, $6)`,
          [
            id,
            payload.poster.filename,
            payload.poster.mime_type,
            payload.poster.size_bytes,
            payload.poster.storage_key,
            updatedBy,
          ],
        );
      }
    }

    await client.query('COMMIT');
    return { oldPosterStorageKey };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// limited update — เจ้าหน้าที่คณะแก้ได้ตอน status='WORK' เฉพาะ field ที่ระบุ
//   columns: capacity, description, location, start_at, end_at,
//            registration_open_at, registration_close_at, approval_mode, budget_actual
//   m2m:     eligible_faculty_ids, skill_ids
//   - ตรวจ status='WORK' ใน UPDATE (atomicity)
//   - ตรวจ capacity >= registered_count ก่อน — กันผู้สมัครเกิน slot ใหม่
//   - replace m2m activity_eligible_faculties + activity_skills ใน transaction เดียว
//   - budget_actual: nullable (รอกรอกจริงหลังกิจกรรม) — pass null เพื่อ clear ได้
//   - approval_mode: AUTO | MANUAL (ตรวจที่ controller)
//   คืน { ok: true } | { ok: false, reason: 'NOT_WORK' | 'CAPACITY_TOO_LOW' | 'NOT_FOUND', current?: number }
const LIMITED_FIELDS = [
  'capacity',
  'description',
  'location',
  'start_at',
  'end_at',
  'registration_open_at',
  'registration_close_at',
  'approval_mode',
  'budget_actual',
];
// field ที่ยอมให้ pass null (clear ค่า) — ส่วนอื่น null จะถูก skip
const LIMITED_NULLABLE_FIELDS = new Set(['budget_actual']);

export async function updateActivityLimited(id, payload) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. ตรวจ status + อ่าน registered_count ปัจจุบัน (เพื่อ validate capacity)
    const { rows: cur } = await client.query(
      `SELECT status, registered_count FROM activities WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (cur.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'NOT_FOUND' };
    }
    if (cur[0].status !== 'WORK') {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'NOT_WORK' };
    }
    if (
      payload.capacity !== undefined &&
      payload.capacity !== null &&
      payload.capacity < cur[0].registered_count
    ) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        reason: 'CAPACITY_TOO_LOW',
        current: cur[0].registered_count,
      };
    }

    // 2. UPDATE เฉพาะ LIMITED_FIELDS (null อนุญาตเฉพาะ field ใน LIMITED_NULLABLE_FIELDS)
    const sets = [];
    const values = [id];
    for (const f of LIMITED_FIELDS) {
      const v = payload[f];
      if (v === undefined) continue;
      if (v === null && !LIMITED_NULLABLE_FIELDS.has(f)) continue;
      values.push(v);
      sets.push(`${f} = $${values.length}`);
    }
    if (sets.length > 0) {
      await client.query(
        `UPDATE activities SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
        values,
      );
    }

    // 3. replace m2m
    if (payload.eligible_faculty_ids !== undefined) {
      await replaceM2m(
        client,
        'activity_eligible_faculties',
        id,
        'faculty_id',
        'faculty_id',
        payload.eligible_faculty_ids,
      );
    }
    if (payload.skill_ids !== undefined) {
      await replaceM2m(
        client,
        'activity_skills',
        id,
        'skill_id',
        'skill_id',
        payload.skill_ids,
      );
    }

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// submit: DRAFT → PENDING_APPROVAL, clear rejection_reason
// (admin reject จะเปลี่ยน status กลับเป็น DRAFT + เก็บ rejection_reason — faculty ดูได้แล้วแก้ + resubmit)
// คืน updated row หรือ null ถ้า status ไม่ตรง precondition
export async function submitActivity(id) {
  const { rows } = await query(
    `UPDATE activities
        SET status = 'PENDING_APPROVAL',
            rejection_reason = NULL,
            updated_at = now()
      WHERE id = $1
        AND status = 'DRAFT'
      RETURNING id, status`,
    [id],
  );
  return rows[0] || null;
}

// complete: WORK → COMPLETED — ผู้สร้างปิดโครงการเองหลังกิจกรรมจบ
//   ตรวจ status='WORK' ตรงนี้ (atomic) — ownership/scope ตรวจใน controller layer
//   คืน updated row หรือ null ถ้า status ไม่ใช่ WORK (race หรือสถานะเปลี่ยนแล้ว)
export async function completeActivity(id) {
  const { rows } = await query(
    `UPDATE activities
        SET status = 'COMPLETED',
            updated_at = now()
      WHERE id = $1
        AND status = 'WORK'
      RETURNING id, status`,
    [id],
  );
  return rows[0] || null;
}

