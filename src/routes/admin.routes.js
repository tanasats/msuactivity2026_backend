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

export default router;
