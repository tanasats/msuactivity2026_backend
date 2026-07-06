import { query } from '../db/index.js';

const VALID_KINDS = Object.freeze(['BANNER', 'POPUP']);
const VALID_SEVERITIES = Object.freeze(['INFO', 'WARNING', 'DANGER']);

export function isValidKind(k) {
  return VALID_KINDS.includes(k);
}
export function isValidSeverity(s) {
  return VALID_SEVERITIES.includes(s);
}

const COLUMNS = `
  a.id,
  a.kind,
  a.severity,
  a.title,
  a.body,
  a.link_url,
  a.link_label,
  a.starts_at,
  a.ends_at,
  a.is_active,
  a.audience_roles,
  a.audience_faculty_ids,
  a.created_by,
  a.updated_by,
  a.created_at,
  a.updated_at
`;

const VISIBLE_WINDOW = `
  a.is_active = TRUE
  AND (a.starts_at IS NULL OR a.starts_at <= now())
  AND (a.ends_at   IS NULL OR a.ends_at   >  now())
`;
const VISIBLE_ORDER = `
  ORDER BY CASE a.severity WHEN 'DANGER' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END,
           a.created_at DESC
`;

// public (ไม่ล็อกอิน): เห็นเฉพาะประกาศ global — ทั้ง audience NULL (กัน leak ประกาศเจาะจง)
export async function listVisible() {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM announcements a
      WHERE ${VISIBLE_WINDOW}
        AND a.audience_roles IS NULL
        AND a.audience_faculty_ids IS NULL
      ${VISIBLE_ORDER}`,
  );
  return rows;
}

// visible สำหรับผู้ใช้ที่ล็อกอิน — เคารพ targeting (role/คณะ) ใช้ในกระดิ่ง
//   audience NULL = ทุกคน; ไม่งั้นต้องมี role/คณะ ของผู้ใช้อยู่ใน array (jsonb @>)
export async function listVisibleForUser(role, facultyId) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM announcements a
      WHERE ${VISIBLE_WINDOW}
        AND (a.audience_roles IS NULL OR a.audience_roles @> to_jsonb($1::text))
        AND (a.audience_faculty_ids IS NULL OR a.audience_faculty_ids @> to_jsonb($2::int))
      ${VISIBLE_ORDER}`,
    [role, facultyId ?? null],
  );
  return rows;
}

// ── read-state (broadcast) — ใช้ในกระดิ่งแจ้งเตือน ─────────────────

// id ประกาศที่ user อ่านแล้ว (จำกัดใน ids ที่ส่งมา = visible)
export async function getReadAnnouncementIds(userId, ids) {
  if (!ids?.length) return new Set();
  const { rows } = await query(
    `SELECT announcement_id FROM announcement_reads
      WHERE user_id = $1 AND announcement_id = ANY($2)`,
    [userId, ids],
  );
  return new Set(rows.map((r) => r.announcement_id));
}

// ทำเครื่องหมายอ่านประกาศ 1 รายการ — คืน true ถ้าเพิ่งอ่าน (idempotent)
export async function markAnnouncementRead(userId, announcementId) {
  const { rowCount } = await query(
    `INSERT INTO announcement_reads (user_id, announcement_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, announcementId],
  );
  return rowCount > 0;
}

// ทำเครื่องหมายอ่านประกาศหลายรายการ (visible ปัจจุบัน) — คืนจำนวนที่เพิ่งอ่าน
export async function markAnnouncementsRead(userId, ids) {
  if (!ids?.length) return 0;
  const values = ids.map((_, i) => `($1, $${i + 2})`).join(', ');
  const { rowCount } = await query(
    `INSERT INTO announcement_reads (user_id, announcement_id)
     VALUES ${values} ON CONFLICT DO NOTHING`,
    [userId, ...ids],
  );
  return rowCount;
}

// admin list — ทุกประกาศพร้อมชื่อผู้สร้าง
export async function listAll({ limit = 100, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT ${COLUMNS}, u.full_name AS created_by_name
       FROM announcements a
       JOIN users u ON u.id = a.created_by
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows;
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT ${COLUMNS}, u.full_name AS created_by_name
       FROM announcements a
       JOIN users u ON u.id = a.created_by
      WHERE a.id = $1`,
    [id],
  );
  return rows[0] || null;
}

// jsonb helper — null/undefined → NULL (ทุกคน), array → JSON string
const jsonbOrNull = (v) => (Array.isArray(v) && v.length ? JSON.stringify(v) : null);

export async function createAnnouncement(payload, createdBy) {
  const { rows } = await query(
    `INSERT INTO announcements
       (kind, severity, title, body, link_url, link_label,
        starts_at, ends_at, is_active, audience_roles, audience_faculty_ids,
        created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $12)
     RETURNING id`,
    [
      payload.kind,
      payload.severity,
      payload.title ?? null,
      payload.body,
      payload.link_url ?? null,
      payload.link_label ?? null,
      payload.starts_at ?? null,
      payload.ends_at ?? null,
      payload.is_active ?? true,
      jsonbOrNull(payload.audience_roles),
      jsonbOrNull(payload.audience_faculty_ids),
      createdBy,
    ],
  );
  return rows[0].id;
}

const PATCH_FIELDS = [
  'kind',
  'severity',
  'title',
  'body',
  'link_url',
  'link_label',
  'starts_at',
  'ends_at',
  'is_active',
];
const PATCH_NULLABLE = new Set([
  'title',
  'link_url',
  'link_label',
  'starts_at',
  'ends_at',
]);

export async function updateAnnouncement(id, payload, updatedBy) {
  const sets = [];
  const params = [id, updatedBy];
  for (const f of PATCH_FIELDS) {
    const v = payload[f];
    if (v === undefined) continue;
    if (v === null && !PATCH_NULLABLE.has(f)) continue;
    params.push(v);
    sets.push(`${f} = $${params.length}`);
  }
  // audience (jsonb) — array=เจาะจง, []/null=ทุกคน (NULL); undefined=ไม่แก้
  for (const f of ['audience_roles', 'audience_faculty_ids']) {
    if (payload[f] === undefined) continue;
    params.push(jsonbOrNull(payload[f]));
    sets.push(`${f} = $${params.length}::jsonb`);
  }
  if (sets.length === 0) return findById(id);
  const { rows } = await query(
    `UPDATE announcements
        SET ${sets.join(', ')},
            updated_by = $2,
            updated_at = now()
      WHERE id = $1
      RETURNING id`,
    params,
  );
  return rows[0] ? findById(rows[0].id) : null;
}

export async function deleteAnnouncement(id) {
  const { rows } = await query(
    `DELETE FROM announcements WHERE id = $1 RETURNING id`,
    [id],
  );
  return rows[0] || null;
}
