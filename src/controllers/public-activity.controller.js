import {
  listPublicActivities,
  getPublicActivityDetail,
  searchPublicActivities,
} from '../models/public-activity.model.js';
import { getPresignedGetUrl } from '../utils/s3.js';

const ALLOWED_FILTERS = new Set(['open', 'upcoming']);
const MAX_LIMIT = 50;

export async function list(req, res) {
  const filterRaw = req.query.filter;
  const filter = ALLOWED_FILTERS.has(filterRaw) ? filterRaw : null;

  let limit = Number.parseInt(req.query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = 12;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const items = await listPublicActivities({ filter, limit });
  // แปะ presigned poster URL ทุก item แบบ parallel
  const decorated = await Promise.all(
    items.map(async (a) => {
      const { poster_storage_key, ...rest } = a;
      return {
        ...rest,
        poster_url: poster_storage_key
          ? await getPresignedGetUrl(poster_storage_key)
          : null,
      };
    }),
  );
  res.json({ items: decorated, filter, limit });
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
        poster_url: poster_storage_key
          ? await getPresignedGetUrl(poster_storage_key)
          : null,
      };
    }),
  );
  res.json({ items: decorated, q, limit });
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
