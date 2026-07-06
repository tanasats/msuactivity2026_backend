import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import {
  list as listNotifications,
  markRead as markNotificationRead,
  markAllRead as markAllNotificationsRead,
  markAnnouncementReadCtrl,
  getPreferences,
  updatePreferences,
} from '../controllers/notification.controller.js';

// endpoint ส่วนตัวของผู้ใช้ที่ล็อกอินแล้ว (ทุก role รวม staff) — ไม่จำกัด role
const router = Router();
router.use(requireAuth);

router.get('/notifications', asyncHandler(listNotifications));
router.post('/notifications/read-all', asyncHandler(markAllNotificationsRead));
router.post('/notifications/:id/read', asyncHandler(markNotificationRead));
router.post('/announcements/:id/read', asyncHandler(markAnnouncementReadCtrl));

router.get('/notification-preferences', asyncHandler(getPreferences));
router.put('/notification-preferences', asyncHandler(updatePreferences));

export default router;
