import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import {
  list,
  getOne,
  getAuditLog,
  updateRole,
  updateFaculty,
  updateStatus,
} from '../controllers/user-admin.controller.js';

// endpoints จัดการ users — เฉพาะ super_admin
//   ไม่มี POST/DELETE: user สร้างผ่าน Google OAuth, ระงับด้วย status='disabled' แทนการลบ
const router = Router();

router.use(requireAuth);
router.use(requireRole('super_admin'));

router.get('/', asyncHandler(list));
router.get('/:id', asyncHandler(getOne));
router.get('/:id/audit', asyncHandler(getAuditLog));
router.patch('/:id/role', asyncHandler(updateRole));
router.patch('/:id/faculty', asyncHandler(updateFaculty));
router.patch('/:id/status', asyncHandler(updateStatus));

export default router;
