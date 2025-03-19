import express from 'express';
import { 
  connectToInstagram, 
  sendCurlCommand, 
  sendStructuredCurlCommand,
  getLoginUrl,
  checkInstagramStatus,
  disconnectFromInstagram
} from '../controllers/instagramController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(protect);

// Instagram routes
router.post('/connect', connectToInstagram);
router.post('/send-curl', sendCurlCommand);
router.post('/send-structured-curl', sendStructuredCurlCommand);
router.get('/login-url', getLoginUrl);
router.get('/status', checkInstagramStatus);
router.post('/disconnect', disconnectFromInstagram);

export default router;