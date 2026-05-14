import {
  listMasterDataAudit,
  MASTER_AUDIT_TARGETS,
  MASTER_AUDIT_ACTIONS,
} from '../models/master-data-audit.model.js';

const VALID_TARGETS = new Set(Object.values(MASTER_AUDIT_TARGETS));
const VALID_ACTIONS = new Set(Object.values(MASTER_AUDIT_ACTIONS));

function badRequest(res, message) {
  return res.status(400).json({ status: 'error', message });
}

function parsePositiveInt(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// GET /api/admin/master-data-audit
//   query (ทุกตัว optional):
//     target_type=organization|category|skill|faculty|system_setting|announcement
//     target_id=<int>
//     target_key=<string>
//     action=create|update|soft_delete|restore|delete
//     actor_id=<int>
//     limit=<1..200> (default 50)
//     offset=<0..>   (default 0)
//
//   คืน { items, total } เพื่อให้ UI ทำ pagination
//   super_admin only (gate ที่ route)
export async function list(req, res) {
  const { target_type, target_id, target_key, action, actor_id } = req.query;

  if (target_type && !VALID_TARGETS.has(target_type)) {
    return badRequest(res, 'target_type ไม่ถูกต้อง');
  }
  if (action && !VALID_ACTIONS.has(action)) {
    return badRequest(res, 'action ไม่ถูกต้อง');
  }

  const targetIdNum = target_id !== undefined ? parsePositiveInt(target_id) : null;
  if (target_id !== undefined && target_id !== '' && targetIdNum === null) {
    return badRequest(res, 'target_id ต้องเป็น integer > 0');
  }
  const actorIdNum = actor_id !== undefined ? parsePositiveInt(actor_id) : null;
  if (actor_id !== undefined && actor_id !== '' && actorIdNum === null) {
    return badRequest(res, 'actor_id ต้องเป็น integer > 0');
  }

  let limit = Number.parseInt(req.query.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) limit = 50;
  if (limit > 200) limit = 200;

  let offset = Number.parseInt(req.query.offset, 10);
  if (!Number.isInteger(offset) || offset < 0) offset = 0;

  const result = await listMasterDataAudit({
    targetType: target_type || null,
    targetId: targetIdNum,
    targetKey: typeof target_key === 'string' && target_key ? target_key : null,
    action: action || null,
    actorId: actorIdNum,
    limit,
    offset,
  });

  res.json({
    items: result.items,
    total: result.total,
    limit,
    offset,
  });
}
