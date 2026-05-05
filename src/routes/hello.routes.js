import { Router } from 'express';
import { hello } from '../controllers/hello.controller.js';

const router = Router();

router.get('/', hello);

export default router;
