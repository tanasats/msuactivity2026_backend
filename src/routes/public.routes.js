import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { publicStats } from '../controllers/public-stats.controller.js';
import {
  list as listActivities,
  detail as activityDetail,
} from '../controllers/public-activity.controller.js';
import { listPublic as listAnnouncements } from '../controllers/announcement.controller.js';

// endpoint สำหรับ landing page — ไม่ต้อง auth
const router = Router();

router.get('/stats', asyncHandler(publicStats));
router.get('/activities', asyncHandler(listActivities));
router.get('/activities/:id', asyncHandler(activityDetail));
router.get('/announcements', asyncHandler(listAnnouncements));

export default router;
