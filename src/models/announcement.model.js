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
  a.created_by,
  a.updated_by,
  a.created_at,
  a.updated_at
`;

// public visible: is_active=true + within window (starts_at <= now < ends_at, NULL = unbounded)
//   เรียงให้ DANGER ขึ้นก่อน, แล้ว WARNING, แล้ว INFO; ภายในระดับเดียวกันเอา created_at DESC
export async function listVisible() {
  const { rows } = await query(
    `SELECT ${COLUMNS}
       FROM announcements a
      WHERE a.is_active = TRUE
        AND (a.starts_at IS NULL OR a.starts_at <= now())
        AND (a.ends_at   IS NULL OR a.ends_at   >  now())
      ORDER BY
        CASE a.severity
          WHEN 'DANGER'  THEN 0
          WHEN 'WARNING' THEN 1
          ELSE 2
        END,
        a.created_at DESC`,
  );
  return rows;
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

export async function createAnnouncement(payload, createdBy) {
  const { rows } = await query(
    `INSERT INTO announcements
       (kind, severity, title, body, link_url, link_label,
        starts_at, ends_at, is_active, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
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
