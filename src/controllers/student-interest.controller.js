import {
  addInterest,
  removeInterest,
  listInterestedActivityIds,
  listInterestsForUser,
} from '../models/activity-interest.model.js';
import { findById as findActivity } from '../models/faculty-activity.model.js';

function err(res, status, message) {
  return res.status(status).json({ status: 'error', message });
}

function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// GET /api/student/interests
//   list กิจกรรมที่นิสิตคนนี้กด "สนใจ" — เรียง created_at DESC
//   ใช้ใน student dashboard section "กิจกรรมที่ฉันสนใจ"
export async function list(req, res) {
  const items = await listInterestsForUser(req.user.id);
  res.json({ items });
}

// GET /api/student/interests/ids
//   คืนเฉพาะ activity_id[] — frontend ใช้เช็ค is_interested_by_me บน detail/landing page
//   ครั้งเดียวพอ ไม่ต้อง fetch รายละเอียดกิจกรรม
export async function listIds(req, res) {
  const ids = await listInterestedActivityIds(req.user.id);
  res.json({ ids });
}

// POST /api/student/interests/:activityId
//   เพิ่ม interest — idempotent (กดซ้ำไม่นับซ้ำ)
export async function add(req, res) {
  const activityId = parseId(req.params.activityId);
  if (!activityId) return err(res, 400, 'invalid activity id');

  const activity = await findActivity(activityId);
  if (!activity) return err(res, 404, 'activity not found');

  const added = await addInterest(req.user.id, activityId);
  res.status(added ? 201 : 200).json({ status: 'ok', added });
}

// DELETE /api/student/interests/:activityId
//   ลบ interest — idempotent (ลบของที่ไม่มีก็ไม่ error)
export async function remove(req, res) {
  const activityId = parseId(req.params.activityId);
  if (!activityId) return err(res, 400, 'invalid activity id');

  const removed = await removeInterest(req.user.id, activityId);
  res.json({ status: 'ok', removed });
}
