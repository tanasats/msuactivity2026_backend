import {
  computeEligibility,
  createRequest,
  findMyRequest,
  listMyRequests,
} from '../models/student-certificate.model.js';
import { getActiveRule } from '../models/cert-requirement.model.js';
import { emit } from '../services/notification.service.js';

function err(res, status, message, extra = {}) {
  return res.status(status).json({ status: 'error', message, ...extra });
}

// GET /api/student/certificates/eligibility
//   นิสิตดูสถานะของตัวเอง — ไม่ว่าจะผ่านหรือไม่ — พร้อม breakdown 3 ข้อ + รายกิจกรรม
export async function eligibility(req, res) {
  const rule = await getActiveRule();
  if (!rule) {
    return err(res, 503, 'ระบบยังไม่ได้กำหนดเกณฑ์การออก transcript');
  }
  const data = await computeEligibility(req.user.id, rule);
  res.json(data);
}

// POST /api/student/certificates/request
//   นิสิตขอ certificate — เช็ค eligibility อีกครั้งฝั่ง backend แบบ atomic
//   precondition: ไม่มี request ค้างใน REQUESTED|APPROVED
const REASON_MESSAGE = {
  NOT_ELIGIBLE:
    'ยังไม่ผ่านเกณฑ์ขอ transcript — โปรดเข้าร่วมกิจกรรมเพิ่ม',
  PENDING_EXISTS:
    'มีคำขออยู่ระหว่างดำเนินการแล้ว — รอให้ admin ตรวจสอบก่อน',
  NO_RULE:
    'ระบบยังไม่ได้กำหนดเกณฑ์การออก transcript',
};

export async function requestCertificate(req, res) {
  const result = await createRequest(req.user.id);
  if (!result.ok) {
    const status = result.reason === 'NO_RULE' ? 503 : 409;
    return err(res, status, REASON_MESSAGE[result.reason], {
      reason: result.reason,
    });
  }
  emit('certificate.requested', { certificate: { id: result.certificate.id } });
  res.status(201).json({ status: 'ok', certificate: result.certificate });
}

// GET /api/student/certificates
//   ประวัติคำขอของตัวเอง
export async function listMine(req, res) {
  const items = await listMyRequests(req.user.id);
  res.json({ items });
}

// GET /api/student/certificates/:id
//   ดูรายละเอียดคำขอ 1 ใบ
export async function detailMine(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');
  const cert = await findMyRequest(req.user.id, id);
  if (!cert) return err(res, 404, 'certificate not found');
  res.json(cert);
}
