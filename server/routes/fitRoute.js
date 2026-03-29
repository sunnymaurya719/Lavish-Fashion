import express from 'express';
import rateLimit from 'express-rate-limit';
import { analyzeBody, getFitAnalytics, getFitInsights, listUserFitFeedback, recommendSize, submitFitFeedback } from '../controllers/fitController.js';
import adminAuth from '../middleware/adminAuth.js';
import authUser from '../middleware/auth.js';
import validateRequest from '../middleware/validateRequest.js';
import { fitBodyScanSchema, fitFeedbackSchema, fitInsightsParamsSchema, fitRecommendSchema } from '../validation/schemas.js';

const fitRouter = express.Router();
const bodyScanRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many body scan attempts. Please retry later.'
    }
});

fitRouter.get('/admin/analytics', adminAuth, getFitAnalytics);
fitRouter.get('/feedback', authUser, listUserFitFeedback);
fitRouter.get('/insights/:productId', validateRequest(fitInsightsParamsSchema, 'params'), getFitInsights);
fitRouter.post('/recommend-size', validateRequest(fitRecommendSchema), recommendSize);
fitRouter.post('/body-scan', bodyScanRateLimiter, validateRequest(fitBodyScanSchema), analyzeBody);
fitRouter.post('/feedback', authUser, validateRequest(fitFeedbackSchema), submitFitFeedback);

export default fitRouter;
