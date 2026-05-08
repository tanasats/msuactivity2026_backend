import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import {
  academicYears,
  cancel,
  myRegistrations,
  register,
  stats,
} from '../controllers/student-registration.controller.js';
import {
  list as listPhotos,
  upload as uploadPhoto,
  remove as removePhoto,
} from '../controllers/registration-photo.controller.js';

// multer in-memory — เพดานเผื่อ overhead 6 MB (spec รูป 5 MB)
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
});

// endpoints สำหรับ role student เท่านั้น
const router = Router();

router.use(requireAuth);
router.use(requireRole('student'));

router.get('/stats', asyncHandler(stats));
router.get('/academic-years', asyncHandler(academicYears));
router.get('/registrations', asyncHandler(myRegistrations));
router.post('/registrations', asyncHandler(register));
router.post('/registrations/:id/cancel', asyncHandler(cancel));

// registration photos — หลักฐานการเข้าร่วมกิจกรรม (เฉพาะที่ evaluation_status='PASSED')
router.get(
  '/registrations/:regId/photos',
  asyncHandler(listPhotos),
);
router.post(
  '/registrations/:regId/photos',
  photoUpload.single('photo'),
  asyncHandler(uploadPhoto),
);
router.delete(
  '/registrations/:regId/photos/:photoId',
  asyncHandler(removePhoto),
);

export default router;
