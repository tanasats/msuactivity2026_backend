import {
  cancelMyRegistration,
  createRegistration,
  getStudentStats,
  listMyAcademicYears,
  listMyRegistrations,
} from '../models/student-registration.model.js';
import { listByRegistrations } from '../models/registration-photo.model.js';
import { getPresignedGetUrl } from '../utils/s3.js';
import { getCurrentAcademicYearBE } from '../utils/academic-year.js';

// helper: parse + validate academic_year query param (รับเฉพาะ พ.ศ. 4 หลัก)
function parseAcademicYear(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 2500 || n > 2700) return null;
  return n;
}

const REGISTER_ERROR_MESSAGE = {
  NOT_OPEN: 'กิจกรรมนี้ยังไม่เปิดให้สมัคร',
  NOT_YET_OPEN: 'ยังไม่ถึงเวลาเปิดรับสมัคร',
  CLOSED: 'ปิดรับสมัครแล้ว',
  FULL: 'จำนวนผู้สมัครเต็มแล้ว',
  NOT_ELIGIBLE: 'คณะของท่านไม่อยู่ในรายการที่กิจกรรมนี้รับสมัคร',
  ALREADY_REGISTERED: 'ท่านได้สมัครกิจกรรมนี้ไว้แล้ว',
};

export async function myRegistrations(req, res) {
  const academicYear = parseAcademicYear(req.query.academic_year);
  const items = await listMyRegistrations(req.user.id, academicYear);

  // แนบรูปหลักฐาน เฉพาะ registration ที่ evaluation_status='PASSED' (ที่เพิ่มรูปได้)
  //   - batch fetch + presigned URL ในรอบเดียว (กัน N+1)
  //   - กิจกรรมที่ยังไม่ PASSED → ส่ง [] เพื่อให้ frontend ไม่ต้องเช็ค null ซ้ำ
  const passedIds = items
    .filter((r) => r.evaluation_status === 'PASSED')
    .map((r) => r.registration_id);
  const photoMap = await listByRegistrations(passedIds);

  const enriched = await Promise.all(
    items.map(async (r) => {
      const photos = photoMap.get(r.registration_id) ?? [];
      const photosWithUrl = await Promise.all(
        photos.map(async (p) => ({
          ...p,
          url: await getPresignedGetUrl(p.storage_key),
        })),
      );
      return { ...r, photos: photosWithUrl };
    }),
  );

  res.json({ items: enriched, academic_year: academicYear });
}

export async function stats(req, res) {
  const academicYear = parseAcademicYear(req.query.academic_year);
  const data = await getStudentStats(req.user.id, academicYear);
  res.json({ ...data, academic_year: academicYear });
}

// GET /api/student/academic-years
//   คืน { current, available } ใช้ populate dropdown filter
//     current   = ปีการศึกษาปัจจุบัน (คำนวณจากวันที่)
//     available = ปีทั้งหมดที่นิสิตเคยมี registration + รวม current เผื่อยังไม่มีปีนี้
export async function academicYears(req, res) {
  const current = getCurrentAcademicYearBE();
  const fromDb = await listMyAcademicYears(req.user.id);
  const set = new Set(fromDb);
  set.add(current);
  const available = [...set].sort((a, b) => b - a);
  res.json({ current, available });
}

export async function cancel(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ status: 'error', message: 'invalid id' });
  }
  const result = await cancelMyRegistration(id, req.user.id);
  if (!result) {
    return res.status(409).json({
      status: 'error',
      message: 'ยกเลิกได้เฉพาะการสมัครที่อยู่ในสถานะ "รออนุมัติ" และเป็นของท่านเอง',
    });
  }
  res.json({ id: result.id, status: result.status });
}

export async function register(req, res) {
  const activityId = Number(req.body?.activity_id);
  if (!Number.isInteger(activityId) || activityId < 1) {
    return res
      .status(400)
      .json({ status: 'error', message: 'ระบุ activity_id ไม่ถูกต้อง' });
  }
  if (!req.user.faculty_id) {
    return res.status(403).json({
      status: 'error',
      message: 'บัญชีของท่านยังไม่ถูกผูกกับคณะ — โปรดติดต่อผู้ดูแลระบบ',
    });
  }

  const result = await createRegistration({
    userId: req.user.id,
    activityId,
    userFacultyId: req.user.faculty_id,
  });
  if (!result.ok) {
    return res.status(409).json({
      status: 'error',
      message: REGISTER_ERROR_MESSAGE[result.reason] ?? 'สมัครไม่สำเร็จ',
      reason: result.reason,
    });
  }
  res.status(201).json({ status: 'ok', registration: result.registration });
}
