import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  requireAuth,
  requireRole,
  ACTIVE_ROLES,
} from '../middlewares/auth.middleware.js';
import {
  create,
  getOne,
  list,
  softDelete,
  update,
} from '../controllers/faculty.controller.js';

// faculties — read สำหรับ ACTIVE_ROLES (dropdown), write สำหรับ super_admin เท่านั้น
const router = Router();

router.use(requireAuth);
router.get('/', requireRole(...ACTIVE_ROLES), asyncHandler(list));
router.get('/:id', requireRole(...ACTIVE_ROLES), asyncHandler(getOne));
router.post('/', requireRole('super_admin'), asyncHandler(create));
router.patch('/:id', requireRole('super_admin'), asyncHandler(update));
router.delete('/:id', requireRole('super_admin'), asyncHandler(softDelete));

export default router;
