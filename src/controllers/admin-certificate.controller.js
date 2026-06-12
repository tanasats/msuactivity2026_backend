import {
  approveRequest,
  findById,
  issueRequest,
  listAllRequests,
  rejectRequest,
} from '../models/admin-certificate.model.js';

const VALID_STATUSES = new Set(['REQUESTED', 'APPROVED', 'REJECTED', 'ISSUED']);

function err(res, status, message) {
  return res.status(status).json({ status: 'error', message });
}

function parsePosInt(raw, fallback = null) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

// GET /api/admin/certificates?status=&q=&limit=&offset=
//   admin queue — default sort: REQUESTED ก่อน, ในกลุ่มเดียวกันใหม่ก่อน
export async function list(req, res) {
  const status = req.query.status?.trim() || null;
  if (status && !VALID_STATUSES.has(status))
    return err(res, 400, 'invalid status');

  const search = req.query.q?.trim() || null;

  let limit = parsePosInt(req.query.limit, 50);
  if (!limit || limit < 1) limit = 50;
  if (limit > 200) limit = 200;

  const offset = parsePosInt(req.query.offset, 0) ?? 0;

  const out = await listAllRequests({ status, search, limit, offset });
  res.json({
    items: out.items,
    total: out.total,
    limit,
    offset,
    filters: { status, q: search },
  });
}

// GET /api/admin/certificates/:id
export async function detail(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');
  const cert = await findById(id);
  if (!cert) return err(res, 404, 'certificate not found');
  res.json(cert);
}

// POST /api/admin/certificates/:id/approve
//   admin/super_admin → REQUESTED → APPROVED
export async function approve(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');

  const updated = await approveRequest(id, req.user.id);
  if (!updated) {
    return err(
      res,
      409,
      'อนุมัติได้เฉพาะคำขอที่อยู่ในสถานะ "รอตรวจสอบ"',
    );
  }
  res.json({ status: 'ok', certificate: updated });
}

// POST /api/admin/certificates/:id/reject
//   body: { reason: string }
//   admin/super_admin → REQUESTED → REJECTED
export async function reject(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');

  const reasonRaw = req.body?.reason;
  if (typeof reasonRaw !== 'string' || reasonRaw.trim().length === 0) {
    return err(res, 400, 'ต้องระบุเหตุผลในการปฏิเสธ');
  }
  const reason = reasonRaw.trim().slice(0, 1000);

  const updated = await rejectRequest(id, reason, req.user.id);
  if (!updated) {
    return err(
      res,
      409,
      'ปฏิเสธได้เฉพาะคำขอที่อยู่ในสถานะ "รอตรวจสอบ"',
    );
  }
  res.json({ status: 'ok', certificate: updated });
}

// POST /api/admin/certificates/:id/issue
//   body: { document_no: string, pdf_storage_key?: string }
//   admin/super_admin → APPROVED → ISSUED
export async function issue(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return err(res, 400, 'invalid id');

  const docNoRaw = req.body?.document_no;
  if (typeof docNoRaw !== 'string' || docNoRaw.trim().length === 0) {
    return err(res, 400, 'ต้องระบุเลขที่เอกสาร');
  }
  const document_no = docNoRaw.trim().slice(0, 100);

  const pdfRaw = req.body?.pdf_storage_key;
  const pdf_storage_key =
    typeof pdfRaw === 'string' && pdfRaw.trim().length > 0
      ? pdfRaw.trim()
      : null;

  const result = await issueRequest(id, { document_no, pdf_storage_key }, req.user.id);
  if (!result) {
    return err(
      res,
      409,
      'ออกใบรับรองได้เฉพาะคำขอที่อยู่ในสถานะ "อนุมัติแล้ว"',
    );
  }
  if (result.duplicate_doc) {
    return err(res, 409, `เลขที่เอกสาร "${document_no}" ถูกใช้ไปแล้ว`);
  }
  res.json({ status: 'ok', certificate: result });
}
