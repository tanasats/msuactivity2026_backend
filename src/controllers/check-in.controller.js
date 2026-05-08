import {
  findActiveRegistrationByToken,
  getCheckInWindowDefaults,
  recordCheckIn,
} from '../models/check-in.model.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok(res, status, body) {
  return res.status(status).json(body);
}

export async function scan(req, res) {
  if (!req.user.faculty_id) {
    return ok(res, 403, {
      status: 'error',
      message: 'บัญชีของท่านยังไม่ถูกผูกกับคณะ — โปรดติดต่อผู้ดูแลระบบ',
    });
  }

  const activityId = Number(req.params.id);
  if (!Number.isInteger(activityId) || activityId < 1) {
    return ok(res, 400, { status: 'error', message: 'invalid activity id' });
  }

  const qrToken = (req.body?.qr_token || '').trim();
  if (!UUID_REGEX.test(qrToken)) {
    return ok(res, 400, {
      status: 'error',
      message: 'รูปแบบ QR token ไม่ถูกต้อง',
    });
  }

  const reg = await findActiveRegistrationByToken(qrToken);
  if (!reg) {
    return ok(res, 404, {
      status: 'error',
      message: 'ไม่พบการลงทะเบียนที่ตรงกับ QR นี้',
    });
  }

  // กันสแกนข้ามกิจกรรม — registration ต้องตรงกับ activity ที่ scanner เปิดอยู่
  if (reg.activity_id !== activityId) {
    return ok(res, 400, {
      status: 'error',
      message: `QR นี้เป็นของกิจกรรมอื่น (${reg.activity_title})`,
    });
  }

  // scope: เจ้าหน้าที่ต้องอยู่คณะเดียวกับผู้สร้างกิจกรรม
  if (reg.activity_owner_faculty_id !== req.user.faculty_id) {
    return ok(res, 403, {
      status: 'error',
      message: 'ไม่มีสิทธิ์เช็คอินกิจกรรมของคณะอื่น',
    });
  }

  if (reg.activity_status !== 'WORK' && reg.activity_status !== 'COMPLETED') {
    return ok(res, 409, {
      status: 'error',
      message: `กิจกรรมยังไม่อยู่ในสถานะที่เช็คอินได้ (status=${reg.activity_status})`,
    });
  }

  if (reg.registration_status === 'ATTENDED') {
    return ok(res, 409, {
      status: 'error',
      message: `${reg.student_name} ได้เช็คอินไปแล้ว`,
    });
  }
  if (reg.registration_status !== 'REGISTERED') {
    return ok(res, 409, {
      status: 'error',
      message: `การลงทะเบียนนี้ไม่อยู่ในสถานะที่เช็คอินได้ (${reg.registration_status})`,
    });
  }

  // ── window check ──
  const now = new Date();
  let windowOpens, windowCloses;
  if (reg.check_in_opens_at && reg.check_in_closes_at) {
    windowOpens = new Date(reg.check_in_opens_at);
    windowCloses = new Date(reg.check_in_closes_at);
  } else {
    const { beforeMinutes, afterMinutes } = await getCheckInWindowDefaults();
    windowOpens = new Date(
      new Date(reg.start_at).getTime() - beforeMinutes * 60 * 1000,
    );
    windowCloses = new Date(
      new Date(reg.end_at).getTime() + afterMinutes * 60 * 1000,
    );
  }
  if (now < windowOpens) {
    return ok(res, 409, {
      status: 'error',
      message: `ยังไม่ถึงเวลาเช็คอิน (เริ่ม ${windowOpens.toLocaleString('th-TH')})`,
    });
  }
  if (now > windowCloses) {
    return ok(res, 409, {
      status: 'error',
      message: `เลยเวลาเช็คอินแล้ว (ปิด ${windowCloses.toLocaleString('th-TH')})`,
    });
  }

  // ── record ──
  let result;
  try {
    result = await recordCheckIn({
      registrationId: reg.registration_id,
      checkedInBy: req.user.id,
    });
  } catch (err) {
    // unique partial index บน attendances กัน double check-in concurrent
    if (err?.code === '23505') {
      return ok(res, 409, {
        status: 'error',
        message: 'บันทึกการเช็คอินซ้ำ',
      });
    }
    throw err;
  }

  return ok(res, 200, {
    status: 'ok',
    student: { name: reg.student_name, msu_id: reg.msu_id },
    activity: { id: reg.activity_id, title: reg.activity_title },
    attendance: {
      id: result.attendanceId,
      checked_in_at: result.checkedInAt,
    },
  });
}
