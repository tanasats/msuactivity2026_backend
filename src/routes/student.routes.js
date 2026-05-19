import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireRole } from '../middlewares/auth.middleware.js';
import {
  academicYears,
  aggregateStats,
  cancel,
  myRegistrations,
  myRegistrationsCsv,
  register,
  stats,
} from '../controllers/student-registration.controller.js';
import {
  list as listPhotos,
  upload as uploadPhoto,
  remove as removePhoto,
} from '../controllers/registration-photo.controller.js';
import {
  list as listInterests,
  listIds as listInterestIds,
  add as addInterest,
  remove as removeInterestCtrl,
} from '../controllers/student-interest.controller.js';

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
router.get('/aggregate-stats', asyncHandler(aggregateStats));
router.get('/academic-years', asyncHandler(academicYears));
router.get('/registrations', asyncHandler(myRegistrations));
// .csv ต้องมาก่อน /:id ไม่งั้น Express จะแปล "registrations.csv" → :id="csv"
router.get('/registrations.csv', asyncHandler(myRegistrationsCsv));
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

// interests (กิจกรรมที่นิสิตกด "สนใจ" — bookmark)
router.get('/interests', asyncHandler(listInterests));
router.get('/interests/ids', asyncHandler(listInterestIds));
router.post('/interests/:activityId', asyncHandler(addInterest));
router.delete('/interests/:activityId', asyncHandler(removeInterestCtrl));

export default router;
