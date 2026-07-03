import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { landingStats, publicStats } from '../controllers/public-stats.controller.js';
import {
  list as listActivities,
  detail as activityDetail,
  recordView as recordActivityView,
  search as searchActivities,
  calendar as calendarActivities,
} from '../controllers/public-activity.controller.js';
import { listPublic as listAnnouncements } from '../controllers/announcement.controller.js';
import { checkInDefaults } from '../controllers/system-setting.controller.js';
import { getPublicActive as getPublicCertRule } from '../controllers/cert-requirement.controller.js';

// endpoint สำหรับ landing page — ไม่ต้อง auth
const router = Router();

router.get('/stats', asyncHandler(publicStats));
router.get('/landing-stats', asyncHandler(landingStats));
router.get('/activities', asyncHandler(listActivities));
// search + calendar ต้องมาก่อน /:id ไม่งั้น "search"/"calendar" จะถูก parse เป็น id
router.get('/activities/search', asyncHandler(searchActivities));
router.get('/activities/calendar', asyncHandler(calendarActivities));
router.get('/activities/:id', asyncHandler(activityDetail));
router.post('/activities/:id/view', asyncHandler(recordActivityView));
router.get('/announcements', asyncHandler(listAnnouncements));
// config: ค่า default ช่วงเปิด-ปิดเช็คอิน (frontend activity form ใช้ auto-fill)
router.get('/check-in-defaults', asyncHandler(checkInDefaults));
// เกณฑ์การขอ transcript กิจกรรม (landing page โชว์เพื่อกระตุ้นนิสิต)
router.get('/cert-requirement', asyncHandler(getPublicCertRule));

export default router;
