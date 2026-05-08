import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import {
  getAuthUrl,
  googleCallback,
  refresh,
  logout,
  me,
} from '../controllers/auth.controller.js';

const router = Router();

router.get('/google/url', asyncHandler(getAuthUrl));
router.get('/google/callback', asyncHandler(googleCallback));
router.post('/refresh', asyncHandler(refresh));
router.post('/logout', asyncHandler(logout));
router.get('/me', requireAuth, asyncHandler(me));

export default router;
