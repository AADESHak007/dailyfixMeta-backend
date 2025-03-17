import { Router, RequestHandler } from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { getMatrixRooms, syncMatrixRooms } from '../controllers/matrixController.js';

const router = Router();

router.get('/rooms', protect, getMatrixRooms as RequestHandler);
router.post('/sync', protect, syncMatrixRooms as RequestHandler);

export default router;