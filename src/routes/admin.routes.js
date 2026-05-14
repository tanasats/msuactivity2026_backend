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
  detail,
  list,
  reject,
  setCreator,
  setStatus,
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
} from '../controllers/admin-student.controller.js';
import {
  bulkAdd as bulkAddRegistration,
  bulkApprove as bulkApproveRegistration,
  bulkEvaluate as bulkEvaluateRegistration,
  bulkParticipantRole as bulkParticipantRoleRegistration,
} from '../controllers/admin-registration.controller.js';
import { list as listMasterDataAudit } from '../controllers/master-data-audit.controller.js';

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
router.get('/students/:id', asyncHandler(studentDetail));
router.get('/students/:id/registrations.csv', asyncHandler(studentRegistrationsCsv));
router.get('/registrations', asyncHandler(listRegistrations));
router.get('/registrations.csv', asyncHandler(registrationsCsv));
router.post(
  '/registrations/:id/cancel',
  asyncHandler(adminCancelRegistration),
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

export default router;
