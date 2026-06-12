import {
  createRule,
  getActiveRule,
  listHistory,
} from '../models/cert-requirement.model.js';
import {
  createMasterDataAuditLog,
  MASTER_AUDIT_TARGETS,
  MASTER_AUDIT_ACTIONS,
} from '../models/master-data-audit.model.js';
import { auditMetaFromReq } from '../models/activity-audit.model.js';

function err(res, status, message) {
  return res.status(status).json({ status: 'error', message });
}

// validators
const PREFIX_REGEX = /^[A-Z]$/;

function validatePayload(body) {
  const errs = [];
  const ga = body?.group_a_prefixes;
  const gb = body?.group_b_prefixes;
  if (!Array.isArray(ga) || ga.length === 0) {
    errs.push('group_a_prefixes ต้องเป็น array ไม่ว่าง');
  } else if (!ga.every((p) => typeof p === 'string' && PREFIX_REGEX.test(p))) {
    errs.push('group_a_prefixes แต่ละค่าต้องเป็นตัวอักษรพิมพ์ใหญ่ตัวเดียว (A-Z)');
  }
  if (!Array.isArray(gb) || gb.length === 0) {
    errs.push('group_b_prefixes ต้องเป็น array ไม่ว่าง');
  } else if (!gb.every((p) => typeof p === 'string' && PREFIX_REGEX.test(p))) {
    errs.push('group_b_prefixes แต่ละค่าต้องเป็นตัวอักษรพิมพ์ใหญ่ตัวเดียว (A-Z)');
  }
  // ตรวจไม่ให้ prefix ซ้ำกันระหว่าง 2 กลุ่ม
  if (Array.isArray(ga) && Array.isArray(gb)) {
    const overlap = ga.filter((p) => gb.includes(p));
    if (overlap.length > 0) {
      errs.push(`prefix ห้ามซ้ำระหว่างกลุ่ม: ${overlap.join(', ')}`);
    }
  }
  const min_a = body?.group_a_min_activities;
  const min_b = body?.group_b_min_activities;
  const min_h = body?.min_total_hours;
  if (!Number.isInteger(min_a) || min_a < 1)
    errs.push('group_a_min_activities ต้องเป็น integer ≥ 1');
  if (!Number.isInteger(min_b) || min_b < 1)
    errs.push('group_b_min_activities ต้องเป็น integer ≥ 1');
  if (!Number.isInteger(min_h) || min_h < 1)
    errs.push('min_total_hours ต้องเป็น integer ≥ 1');
  // note ไม่บังคับ — slice ถ้ามี
  let note = null;
  if (typeof body?.note === 'string' && body.note.trim().length > 0) {
    note = body.note.trim().slice(0, 1000);
  }
  return { errs, sanitized: errs.length === 0 ? {
    group_a_prefixes: ga.map((p) => p.toUpperCase()),
    group_b_prefixes: gb.map((p) => p.toUpperCase()),
    group_a_min_activities: min_a,
    group_b_min_activities: min_b,
    min_total_hours: min_h,
    note,
  } : null };
}

// GET /api/admin/cert-requirements
//   active + history (เรียงใหม่ก่อน)
export async function get(req, res) {
  const [active, history] = await Promise.all([
    getActiveRule(),
    listHistory({ limit: 50 }),
  ]);
  res.json({ active, history });
}

// POST /api/admin/cert-requirements
//   super_admin only (gate ที่ route)
//   set old.effective_to + INSERT new + audit
export async function create(req, res) {
  const { errs, sanitized } = validatePayload(req.body);
  if (errs.length > 0) return err(res, 400, errs.join('; '));

  const result = await createRule(sanitized, req.user.id);

  // audit:
  //   ถ้ามี oldRule → UPDATE (snapshot before + after)
  //   ถ้าเป็นครั้งแรก → CREATE
  if (result.old) {
    await createMasterDataAuditLog({
      actor_id: req.user.id,
      target_type: MASTER_AUDIT_TARGETS.CERT_REQUIREMENT,
      target_id: result.new.id,
      action: MASTER_AUDIT_ACTIONS.UPDATE,
      before: {
        rule_id: result.old.id,
        group_a_prefixes: result.old.group_a_prefixes,
        group_b_prefixes: result.old.group_b_prefixes,
        group_a_min_activities: result.old.group_a_min_activities,
        group_b_min_activities: result.old.group_b_min_activities,
        min_total_hours: result.old.min_total_hours,
      },
      after: {
        rule_id: result.new.id,
        group_a_prefixes: result.new.group_a_prefixes,
        group_b_prefixes: result.new.group_b_prefixes,
        group_a_min_activities: result.new.group_a_min_activities,
        group_b_min_activities: result.new.group_b_min_activities,
        min_total_hours: result.new.min_total_hours,
      },
      note: sanitized.note,
      ...auditMetaFromReq(req),
    });
  } else {
    await createMasterDataAuditLog({
      actor_id: req.user.id,
      target_type: MASTER_AUDIT_TARGETS.CERT_REQUIREMENT,
      target_id: result.new.id,
      action: MASTER_AUDIT_ACTIONS.CREATE,
      after: {
        rule_id: result.new.id,
        group_a_prefixes: result.new.group_a_prefixes,
        group_b_prefixes: result.new.group_b_prefixes,
        group_a_min_activities: result.new.group_a_min_activities,
        group_b_min_activities: result.new.group_b_min_activities,
        min_total_hours: result.new.min_total_hours,
      },
      note: sanitized.note,
      ...auditMetaFromReq(req),
    });
  }

  res.status(201).json({ status: 'ok', rule: result.new });
}
