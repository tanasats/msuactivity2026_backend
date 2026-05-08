import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  requireAuth,
  requireRole,
  ACTIVE_ROLES,
} from '../middlewares/auth.middleware.js';
import {
  list,
  getOne,
  create,
  update,
  softDelete,
} from '../controllers/skill.controller.js';

const router = Router();

router.use(requireAuth);

router.get('/', requireRole(...ACTIVE_ROLES), asyncHandler(list));
router.get('/:id', requireRole(...ACTIVE_ROLES), asyncHandler(getOne));
router.post('/', requireRole('super_admin'), asyncHandler(create));
router.patch('/:id', requireRole('super_admin'), asyncHandler(update));
router.delete('/:id', requireRole('super_admin'), asyncHandler(softDelete));

export default router;
