import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import {
  academicYears,
  approve,
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

// announcements — admin + super_admin จัดการ (อ่านบน public endpoint)
router.get('/announcements', asyncHandler(listAnnouncements));
router.post('/announcements', asyncHandler(createAnnouncement));
router.get('/announcements/:id', asyncHandler(getAnnouncement));
router.patch('/announcements/:id', asyncHandler(updateAnnouncement));
router.delete('/announcements/:id', asyncHandler(removeAnnouncement));

export default router;
