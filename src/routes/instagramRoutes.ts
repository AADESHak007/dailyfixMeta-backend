import express from 'express';
import * as instagramController from '../controllers/instagramController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Create a handler that catches errors
const createHandler = (fn: Function) => {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };
};

// Core Instagram routes - all protected by auth middleware
router.post('/connect', protect, createHandler(instagramController.connectToInstagram));
router.get('/status', protect, createHandler(instagramController.checkInstagramStatus));
router.post('/disconnect', protect, createHandler(instagramController.disconnectFromInstagram));
router.post('/curl', protect, createHandler(instagramController.sendCurlCommand));
router.get('/login-url', protect, createHandler(instagramController.getLoginUrl));

export default router;