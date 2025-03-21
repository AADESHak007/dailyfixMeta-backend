import express from 'express';
import * as instagramController from '../controllers/instagramController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(protect);

// Type-safe middleware creator
const createHandler = (handler: Function) => {
  return (req: express.Request, res: express.Response) => {
    return handler(req, res);
  };
};

// Instagram routes
router.post('/connect', createHandler(instagramController.connectToInstagram));
router.post('/send-curl', createHandler(instagramController.sendCurlCommand));
router.post('/send-structured-curl', createHandler(instagramController.sendStructuredCurlCommand));
router.get('/login-url', createHandler(instagramController.getLoginUrl));
router.get('/status', createHandler(instagramController.checkInstagramStatus));
router.post('/disconnect', createHandler(instagramController.disconnectFromInstagram));

export default router;