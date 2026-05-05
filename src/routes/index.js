import { Router } from 'express';
import healthRoutes from './health.routes.js';
import helloRoutes from './hello.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/hello', helloRoutes);

export default router;
