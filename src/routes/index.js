import { Router } from 'express';
import healthRoutes from './health.routes.js';
import helloRoutes from './hello.routes.js';
import authRoutes from './auth.routes.js';
import organizationRoutes from './organization.routes.js';
import categoryRoutes from './category.routes.js';
import skillRoutes from './skill.routes.js';
import publicRoutes from './public.routes.js';
import facultyRoutes from './faculty.routes.js';
import facultiesRoutes from './faculties.routes.js';
import studentRoutes from './student.routes.js';
import adminRoutes from './admin.routes.js';
import userAdminRoutes from './user-admin.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/hello', helloRoutes);
router.use('/auth', authRoutes);
router.use('/public', publicRoutes);
router.use('/organizations', organizationRoutes);
router.use('/categories', categoryRoutes);
router.use('/skills', skillRoutes);
router.use('/faculties', facultiesRoutes);
router.use('/faculty', facultyRoutes);
router.use('/student', studentRoutes);
router.use('/admin', adminRoutes);
router.use('/users', userAdminRoutes);

export default router;
