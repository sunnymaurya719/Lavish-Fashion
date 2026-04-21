import express from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { analyzeBody, getFitAnalytics, getFitInsights, listUserFitFeedback, recommendSize, submitFitFeedback } from '../controllers/fitController.js';
import adminAuth from '../middleware/adminAuth.js';
import authUser from '../middleware/auth.js';
import validateRequest from '../middleware/validateRequest.js';
import { fitBodyScanSchema, fitFeedbackSchema, fitInsightsParamsSchema, fitRecommendSchema } from '../validation/schemas.js';

const fitRouter = express.Router();

const extractRequestToken = (req) => {
    const header = req.headers?.authorization || '';
    if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
        return header.slice(7).trim();
    }
    const fallback = req.headers?.token;
    return typeof fallback === 'string' ? fallback.trim() : '';
};

// Per-user key when an Authorization token is present so a single account
// can't bypass per-IP throttles by switching networks. Falls back to IP.
const keyByUserOrIp = (req) => {
    const token = extractRequestToken(req);
    if (token && process.env.JWT_SECRET) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const userId = String(decoded?.id || '').trim();
            if (userId) return `user:${userId}`;
        } catch {
            // ignore — fall back to IP-based throttling
        }
    }
    return `ip:${req.ip || req.headers?.['x-forwarded-for'] || 'unknown'}`;
};

const buildLimiter = ({ max, message }) => rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByUserOrIp,
    message: { success: false, message }
});

const bodyScanRateLimiter = buildLimiter({
    max: 20,
    message: 'Too many body scan attempts. Please retry later.'
});

const recommendRateLimiter = buildLimiter({
    max: 60,
    message: 'Too many size recommendation requests. Please retry later.'
});

const feedbackRateLimiter = buildLimiter({
    max: 30,
    message: 'Too many feedback submissions. Please retry later.'
});

fitRouter.get('/admin/analytics', adminAuth, getFitAnalytics);
fitRouter.get('/feedback', authUser, listUserFitFeedback);
fitRouter.get('/insights/:productId', validateRequest(fitInsightsParamsSchema, 'params'), getFitInsights);
fitRouter.post('/recommend-size', recommendRateLimiter, validateRequest(fitRecommendSchema), recommendSize);
fitRouter.post('/body-scan', bodyScanRateLimiter, validateRequest(fitBodyScanSchema), analyzeBody);
fitRouter.post('/feedback', authUser, feedbackRateLimiter, validateRequest(fitFeedbackSchema), submitFitFeedback);

export default fitRouter;
