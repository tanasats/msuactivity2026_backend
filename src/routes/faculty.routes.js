import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import {
  stats,
  academicYears,
  list,
  detail,
  create,
  update,
  updateLimited,
  submit,
  complete,
} from '../controllers/faculty-activity.controller.js';
import { scan } from '../controllers/check-in.controller.js';
import { uploadPoster } from '../controllers/upload.controller.js';
import {
  list as listDocs,
  upload as uploadDoc,
  patch as patchDoc,
  remove as removeDoc,
} from '../controllers/activity-document.controller.js';
import {
  list as listGallery,
  upload as uploadGallery,
  remove as removeGallery,
} from '../controllers/activity-gallery.controller.js';
import {
  list as listRegistrations,
  approve as approveRegistration,
  cancel as cancelRegistration,
  evaluate as evaluateRegistration,
  bulkAdd as bulkAddRegistrations,
  bulkEvaluate as bulkEvaluateRegistrations,
  bulkParticipantRole as bulkParticipantRoleRegistrations,
  staffCheckIn as staffCheckInRegistrations,
} from '../controllers/faculty-registration.controller.js';

// multer in-memory — ขนาดไฟล์เพดาน 6 MB (poster spec 5 MB) เพื่อเผื่อ overhead
const posterUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
});

// document spec 20 MB + เผื่อ overhead เป็น 22 MB
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 22 * 1024 * 1024 },
});

// gallery (รูปประกอบ) spec 5 MB + เผื่อ overhead เป็น 6 MB
const galleryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
});

// endpoints สำหรับ faculty_staff (admin/super_admin เข้าได้ด้วย — ใช้ดูข้ามคณะภายหลัง)
const router = Router();

router.use(requireAuth);
router.use(requireRole('faculty_staff', 'admin', 'super_admin'));

router.get('/stats', asyncHandler(stats));
router.get('/academic-years', asyncHandler(academicYears));
router.get('/activities', asyncHandler(list));
router.get('/activities/:id', asyncHandler(detail));
router.post('/activities', asyncHandler(create));
router.patch('/activities/:id', asyncHandler(update));
router.patch('/activities/:id/limited', asyncHandler(updateLimited));
router.post('/activities/:id/submit', asyncHandler(submit));
router.post('/activities/:id/complete', asyncHandler(complete));
router.post('/activities/:id/check-in', asyncHandler(scan));
router.post(
  '/uploads/poster',
  posterUpload.single('poster'),
  asyncHandler(uploadPoster),
);

// activity documents (เอกสารประกอบ kind=DOCUMENT)
router.get('/activities/:id/documents', asyncHandler(listDocs));
router.post(
  '/activities/:id/documents',
  documentUpload.single('file'),
  asyncHandler(uploadDoc),
);
router.patch(
  '/activities/:id/documents/:fileId',
  asyncHandler(patchDoc),
);
router.delete(
  '/activities/:id/documents/:fileId',
  asyncHandler(removeDoc),
);

// activity gallery (รูปประกอบ kind=GALLERY) — เพิ่ม/ลบเฉพาะ status=WORK + max 10 รูป
router.get('/activities/:id/gallery', asyncHandler(listGallery));
router.post(
  '/activities/:id/gallery',
  galleryUpload.single('file'),
  asyncHandler(uploadGallery),
);
router.delete(
  '/activities/:id/gallery/:fileId',
  asyncHandler(removeGallery),
);

// registrations management (เจ้าหน้าที่คณะดู/อนุมัติ/ยกเลิก)
router.get(
  '/activities/:id/registrations',
  asyncHandler(listRegistrations),
);
router.post(
  '/activities/:id/registrations/:regId/approve',
  asyncHandler(approveRegistration),
);
router.post(
  '/activities/:id/registrations/:regId/cancel',
  asyncHandler(cancelRegistration),
);
router.post(
  '/activities/:id/registrations/:regId/evaluate',
  asyncHandler(evaluateRegistration),
);
router.post(
  '/activities/:id/registrations/bulk-evaluate',
  asyncHandler(bulkEvaluateRegistrations),
);
router.post(
  '/activities/:id/registrations/staff-check-in',
  asyncHandler(staffCheckInRegistrations),
);
router.post(
  '/activities/:id/registrations/bulk-add',
  asyncHandler(bulkAddRegistrations),
);
router.post(
  '/activities/:id/registrations/bulk-participant-role',
  asyncHandler(bulkParticipantRoleRegistrations),
);

export default router;
