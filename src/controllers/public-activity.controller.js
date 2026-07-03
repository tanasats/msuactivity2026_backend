import {
  listPublicActivities,
  getPublicActivityDetail,
  searchPublicActivities,
  listActivitiesForCalendar,
} from '../models/public-activity.model.js';
import { incrementViewCount } from '../models/activity-interest.model.js';
import { getPresignedGetUrl } from '../utils/s3.js';
import { getPosterThumbKey } from '../utils/poster-thumb.js';

// การ์ด landing/ผลค้นหาแสดงรูปเล็ก → ใช้ thumbnail (webp ~640px) แทนไฟล์เต็ม
//   presign บน thumb key; ถ้าไม่มี poster → null
async function posterThumbUrl(posterStorageKey) {
  if (!posterStorageKey) return null;
  const thumbKey = await getPosterThumbKey(posterStorageKey);
  return getPresignedGetUrl(thumbKey);
}

const ALLOWED_FILTERS = new Set(['open', 'upcoming']);
const MAX_LIMIT = 50;

export async function list(req, res) {
  const filterRaw = req.query.filter;
  const filter = ALLOWED_FILTERS.has(filterRaw) ? filterRaw : null;

  let limit = Number.parseInt(req.query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = 12;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  let offset = Number.parseInt(req.query.offset, 10);
  if (!Number.isInteger(offset) || offset < 0) offset = 0;

  const { items, total } = await listPublicActivities({ filter, limit, offset });
  // แปะ presigned poster URL ทุก item แบบ parallel
  const decorated = await Promise.all(
    items.map(async (a) => {
      const { poster_storage_key, ...rest } = a;
      return {
        ...rest,
        poster_url: await posterThumbUrl(poster_storage_key),
      };
    }),
  );
  res.json({ items: decorated, filter, limit, offset, total });
}

// GET /api/public/activities/search?q=&limit=
//   - WORK + COMPLETED เท่านั้น (กัน leak DRAFT/PENDING)
//   - q ต้อง trim เกิน 1 ตัวอักษร — น้อยกว่านั้น ILIKE จะคืนผลเยอะเกิน + ไร้ประโยชน์
export async function search(req, res) {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2) return res.json({ items: [], q, limit: 0 });
  if (q.length > 200) {
    return res.status(400).json({ status: 'error', message: 'q ยาวเกิน 200' });
  }
  let limit = Number.parseInt(req.query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = 20;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const items = await searchPublicActivities(q, limit);
  const decorated = await Promise.all(
    items.map(async (a) => {
      const { poster_storage_key, ...rest } = a;
      return {
        ...rest,
        poster_url: await posterThumbUrl(poster_storage_key),
      };
    }),
  );
  res.json({ items: decorated, q, limit });
}

// GET /api/public/activities/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
//   ปฏิทินกิจกรรม landing — from inclusive, to EXCLUSIVE (client ส่งช่วง grid ที่มองเห็น + pad)
const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_MAX_DAYS = 92; // กันช่วงกว้างเกิน (client ขอทีละ ~1 เดือน + pad)

export async function calendar(req, res) {
  const { from, to } = req.query;
  if (!CALENDAR_DATE_RE.test(from ?? '') || !CALENDAR_DATE_RE.test(to ?? '')) {
    return res
      .status(400)
      .json({ status: 'error', message: 'from/to ต้องเป็นรูปแบบ YYYY-MM-DD' });
  }
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) {
    return res
      .status(400)
      .json({ status: 'error', message: 'ช่วงวันที่ไม่ถูกต้อง (to ต้องมากกว่า from)' });
  }
  if ((toMs - fromMs) / 86_400_000 > CALENDAR_MAX_DAYS) {
    return res
      .status(400)
      .json({ status: 'error', message: `ช่วงต้องไม่เกิน ${CALENDAR_MAX_DAYS} วัน` });
  }

  const items = await listActivitiesForCalendar({ from, to });
  res.json({ items, from, to });
}

export async function detail(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ status: 'error', message: 'invalid id' });
  }
  const activity = await getPublicActivityDetail(id);
  if (!activity) {
    return res.status(404).json({ status: 'error', message: 'activity not found' });
  }
  if (activity.poster?.storage_key) {
    activity.poster_url = await getPresignedGetUrl(activity.poster.storage_key);
  } else {
    activity.poster_url = null;
  }
  if (Array.isArray(activity.documents)) {
    activity.documents = await Promise.all(
      activity.documents.map(async (d) => ({
        ...d,
        url: await getPresignedGetUrl(d.storage_key),
      })),
    );
  }
  res.json(activity);
}

// POST /api/public/activities/:id/view
//   public — dedup ฝั่ง client ด้วย localStorage (1 view ต่อ session)
//   ไม่ตรวจ activity status เพราะอยากนับ view ของ COMPLETED ด้วยได้
export async function recordView(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ status: 'error', message: 'invalid id' });
  }
  const ok = await incrementViewCount(id);
  if (!ok) {
    return res.status(404).json({ status: 'error', message: 'activity not found' });
  }
  res.json({ status: 'ok' });
}
