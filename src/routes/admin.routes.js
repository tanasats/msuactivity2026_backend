import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import {
  academicYears,
  adminEdit,
  approve,
  auditLog,
  bulkApprove,
  bulkReject,
  deleteImpact,
  detail,
  list,
  reject,
  restore,
  setCreator,
  setStatus,
  softDelete,
  stats,
} from '../controllers/admin-activity.controller.js';
import {
  list as listSettings,
  update as updateSetting,
} from '../controllers/system-setting.controller.js';
import {
  listAdmin as listAnnouncements,
  getOne as getAnnouncement,
  create as createAnnouncement,
  update as updateAnnouncement,
  remove as removeAnnouncement,
} from '../controllers/announcement.controller.js';
import {
  listStudents,
  studentDetail,
  studentRegistrationsCsv,
  listRegistrations,
  registrationsCsv,
  cancelRegistration as adminCancelRegistration,
  cancelCheckIn as adminCancelCheckIn,
  revertEval as adminRevertEval,
  registrationAuditLog,
} from '../controllers/admin-student.controller.js';
import {
  bulkAdd as bulkAddRegistration,
  bulkApprove as bulkApproveRegistration,
  bulkCheckIn as bulkCheckInRegistration,
  bulkEvaluate as bulkEvaluateRegistration,
  bulkParticipantRole as bulkParticipantRoleRegistration,
} from '../controllers/admin-registration.controller.js';
import { list as listMasterDataAudit } from '../controllers/master-data-audit.controller.js';
import {
  approve as approveCertificate,
  detail as certificateDetail,
  issue as issueCertificate,
  list as listCertificates,
  reject as rejectCertificate,
} from '../controllers/admin-certificate.controller.js';
import {
  listEligible as listEligibleStudents,
  transcriptData,
  patchAcademicProfile,
  transcriptDocx,
} from '../controllers/admin-transcript.controller.js';
import {
  create as createCertRule,
  get as getCertRules,
} from '../controllers/cert-requirement.controller.js';
import { sendTestEmail } from '../controllers/notification.controller.js';

// endpoints สำหรับ admin / super_admin: บริหารจัดการกิจกรรมข้ามคณะ
const router = Router();

router.use(requireAuth);
router.use(requireRole('admin', 'super_admin'));

router.get('/stats', asyncHandler(stats));
router.get('/academic-years', asyncHandler(academicYears));
router.get('/activities', asyncHandler(list));
router.post('/activities/bulk-approve', asyncHandler(bulkApprove));
router.post('/activities/bulk-reject', asyncHandler(bulkReject));
router.get('/activities/:id', asyncHandler(detail));
router.get('/activities/:id/audit', asyncHandler(auditLog));
router.patch('/activities/:id', asyncHandler(adminEdit));
router.post('/activities/:id/approve', asyncHandler(approve));
router.post('/activities/:id/reject', asyncHandler(reject));
// per-route guard: super_admin only — override state machine
router.patch(
  '/activities/:id/status',
  requireRole('super_admin'),
  asyncHandler(setStatus),
);
// per-route guard: super_admin only — โอน ownership ของกิจกรรม
router.patch(
  '/activities/:id/creator',
  requireRole('super_admin'),
  asyncHandler(setCreator),
);

// soft delete + restore (super_admin only)
//   - delete-impact: preview ผลกระทบก่อน confirm (จำนวนนิสิต / ชั่วโมงที่จะหาย)
//   - soft-delete:   status → DELETED + เก็บ previous_status ไว้ restore
//   - restore:       กู้คืน status เดิม
router.get(
  '/activities/:id/delete-impact',
  requireRole('super_admin'),
  asyncHandler(deleteImpact),
);
router.post(
  '/activities/:id/soft-delete',
  requireRole('super_admin'),
  asyncHandler(softDelete),
);
router.post(
  '/activities/:id/restore',
  requireRole('super_admin'),
  asyncHandler(restore),
);

// system settings — super_admin เท่านั้น (รวม academic_year, check-in window ฯลฯ)
router.get('/settings', requireRole('super_admin'), asyncHandler(listSettings));
router.put(
  '/settings/:key',
  requireRole('super_admin'),
  asyncHandler(updateSetting),
);

// student participation tracking — admin + super_admin
//   - /students         : list นิสิต + summary stats (drill-down entry)
//   - /students/:id     : profile + aggregate stats + ทุก registration
//   - /students/:id/registrations.csv  : export ของนิสิตคนนั้น
//   - /registrations    : cross-browse registrations ข้ามนิสิต+กิจกรรม
//   - /registrations.csv: export ผลตาม filter
router.get('/students', asyncHandler(listStudents));
// ทรานสคริปต์กิจกรรม — ต้องมาก่อน /students/:id (กัน 'eligible' ถูกจับเป็น :id)
//   - /students/eligible                : รายชื่อนิสิตที่เข้าร่วมครบตามเกณฑ์
//   - /students/:id/transcript          : JSON ทรานสคริปต์ (preview)
//   - /students/:id/academic-profile    : PATCH สาขา/ปริญญา/วันรับเข้า/ชื่ออังกฤษ
//   - /students/:id/transcript.docx     : POST ดาวน์โหลด Word (รับ override จากฟอร์ม)
router.get('/students/eligible', asyncHandler(listEligibleStudents));
router.get('/students/:id', asyncHandler(studentDetail));
router.get('/students/:id/transcript', asyncHandler(transcriptData));
router.patch('/students/:id/academic-profile', asyncHandler(patchAcademicProfile));
router.post('/students/:id/transcript.docx', asyncHandler(transcriptDocx));
router.get('/students/:id/registrations.csv', asyncHandler(studentRegistrationsCsv));
router.get('/registrations', asyncHandler(listRegistrations));
router.get('/registrations.csv', asyncHandler(registrationsCsv));
// cancel registration — super_admin only (admin ห่าง context, เสี่ยง fraud)
//   อนุญาตเฉพาะ PENDING_APPROVAL + REGISTERED (ATTENDED ต้องผ่าน chain)
router.post(
  '/registrations/:id/cancel',
  requireRole('super_admin'),
  asyncHandler(adminCancelRegistration),
);
// audit timeline ของ registration เฉพาะ row — admin + super_admin (read-only)
router.get(
  '/registrations/:id/audit',
  asyncHandler(registrationAuditLog),
);
// ยกเลิกการเช็คอิน — super_admin only (admin ไม่ได้ — เสี่ยง fraud + ห่าง context)
router.post(
  '/registrations/:id/cancel-check-in',
  requireRole('super_admin'),
  asyncHandler(adminCancelCheckIn),
);
// ยกเลิกผลประเมิน (PASSED/FAILED → PENDING_EVAL) — super_admin only
router.post(
  '/registrations/:id/revert-evaluation',
  requireRole('super_admin'),
  asyncHandler(adminRevertEval),
);

// super_admin only — จัดการผู้สมัครรายกิจกรรม (cross-faculty) รับ msu_ids
//   admin เห็น stats ได้ (ผ่าน /admin/registrations) แต่ "เขียน" ไม่ได้
router.post(
  '/activities/:id/registrations/bulk-add',
  requireRole('super_admin'),
  asyncHandler(bulkAddRegistration),
);
router.post(
  '/activities/:id/registrations/bulk-approve',
  requireRole('super_admin'),
  asyncHandler(bulkApproveRegistration),
);
router.post(
  '/activities/:id/registrations/bulk-evaluate',
  requireRole('super_admin'),
  asyncHandler(bulkEvaluateRegistration),
);
router.post(
  '/activities/:id/registrations/bulk-check-in',
  requireRole('super_admin'),
  asyncHandler(bulkCheckInRegistration),
);
// เปลี่ยน participant_role — super_admin only (admin override ห้ามแก้สถานภาพ)
router.post(
  '/activities/:id/registrations/bulk-participant-role',
  requireRole('super_admin'),
  asyncHandler(bulkParticipantRoleRegistration),
);

// master_data audit viewer — super_admin only
//   query: target_type/target_id/target_key/action/actor_id/limit/offset
router.get(
  '/master-data-audit',
  requireRole('super_admin'),
  asyncHandler(listMasterDataAudit),
);

// announcements — admin + super_admin จัดการ (อ่านบน public endpoint)
router.get('/announcements', asyncHandler(listAnnouncements));
router.post('/announcements', asyncHandler(createAnnouncement));
router.get('/announcements/:id', asyncHandler(getAnnouncement));
router.patch('/announcements/:id', asyncHandler(updateAnnouncement));
router.delete('/announcements/:id', asyncHandler(removeAnnouncement));

// certificate (transcript กิจกรรม)
//   queue + lifecycle actions — admin + super_admin
//   rule editor — super_admin only
router.get('/certificates', asyncHandler(listCertificates));
router.get('/certificates/:id', asyncHandler(certificateDetail));
router.post('/certificates/:id/approve', asyncHandler(approveCertificate));
router.post('/certificates/:id/reject', asyncHandler(rejectCertificate));
router.post('/certificates/:id/issue', asyncHandler(issueCertificate));
// rule history — admin/super_admin อ่านได้; แก้ rule = super_admin only
router.get('/cert-requirements', asyncHandler(getCertRules));
router.post(
  '/cert-requirements',
  requireRole('super_admin'),
  asyncHandler(createCertRule),
);

// D3: ส่งเมลทดสอบ (ตรวจการเชื่อมต่อ SMTP)
router.post('/email/test', asyncHandler(sendTestEmail));

export default router;
