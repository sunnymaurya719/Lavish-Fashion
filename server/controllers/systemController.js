import {
    getFitConfidenceMin,
    getFitRolloutPercent,
    isFitAssistantGloballyEnabled,
    isFitCameraGloballyEnabled
} from '../services/fitRuntimeService.js';
import { getGoogleClientId, isGoogleAuthConfigured } from '../services/googleAuthService.js';
import { probeMlServiceHealth } from '../services/mlGatewayService.js';
import { isShiprocketConfigured, isShiprocketEnabled } from '../config/shiprocket.js';

const normalizeUrl = (value) => String(value || '').trim().replace(/\/$/, '');
const toPublicUrl = (value) => (/^https?:\/\/.+/i.test(normalizeUrl(value)) ? normalizeUrl(value) : '');

const isConfigured = (...values) => values.every((value) => Boolean(String(value || '').trim()));

const getSystemBootstrap = async (req, res) => {
    const cloudinaryConfigured = isConfigured(
        process.env.CLOUDINARY_NAME,
        process.env.CLOUDINARY_API_KEY,
        process.env.CLOUDINARY_SECRET_KEY
    );
    const stripeEnabled = isConfigured(process.env.STRIPE_SECRET_KEY, process.env.STRIPE_WEBHOOK_SECRET);
    const razorpayEnabled = isConfigured(process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET);
    const marketingEmailMode = String(process.env.MARKETING_EMAIL_MODE || 'simulation').trim().toLowerCase();
    const marketingEmailProvider = String(process.env.MARKETING_EMAIL_PROVIDER || 'resend').trim().toLowerCase();
    const fitAssistantEnabled = isFitAssistantGloballyEnabled();
    const fitCameraEnabled = isFitCameraGloballyEnabled();
    const fitRolloutPercent = getFitRolloutPercent();
    const fitConfidenceMin = getFitConfidenceMin();
    const mlServiceHealth = await probeMlServiceHealth({
        requestId: req.requestId,
        log: req.log
    });
    const googleAuthConfigured = isGoogleAuthConfigured();
    const mlServiceEnabled = Boolean(mlServiceHealth.configured);
    const redisConfigured = isConfigured(process.env.REDIS_URL);
    const shiprocketEnabled = isShiprocketEnabled();
    const shiprocketConfigured = isShiprocketConfigured();

    return res.status(200).json({
        success: true,
        bootstrap: {
            runtime: {
                environment: String(process.env.NODE_ENV || 'development').trim().toLowerCase(),
                uptimeSeconds: Number(process.uptime().toFixed(0)),
                timestamp: new Date().toISOString()
            },
            urls: {
                clientUrl: toPublicUrl(process.env.CLIENT_URL || process.env.FRONTEND_URL),
                adminUrl: toPublicUrl(process.env.ADMIN_URL),
                frontendUrl: toPublicUrl(process.env.FRONTEND_URL || process.env.CLIENT_URL)
            },
            features: {
                codEnabled: true,
                wishlistEnabled: true,
                googleAuthEnabled: googleAuthConfigured,
                loyaltyEnabled: true,
                loyaltyRedemptionEnabled: true,
                reviewsEnabled: true,
                reviewMediaEnabled: cloudinaryConfigured,
                fitAssistantEnabled,
                fitCameraEnabled,
                fitInsightsEnabled: fitAssistantEnabled,
                customerNotesEnabled: true,
                couponsEnabled: true,
                marketingEnabled: true,
                dashboardEnabled: true
            },
            payments: {
                stripeEnabled,
                razorpayEnabled,
                razorpayKeyId: razorpayEnabled ? String(process.env.RAZORPAY_KEY_ID || '').trim() : '',
                codEnabled: true
            },
            integrations: {
                cloudinaryConfigured,
                mlServiceEnabled,
                mlServiceHealthy: Boolean(mlServiceHealth.healthy),
                mlServiceReachable: Boolean(mlServiceHealth.reachable),
                mlServiceModelLoaded: Boolean(mlServiceHealth.modelLoaded),
                mlServiceModelVersion: mlServiceHealth.modelVersion || '',
                mlServiceHealthReason: mlServiceHealth.reason || '',
                mlServiceLatencyMs: mlServiceHealth.latencyMs,
                redisConfigured,
                shiprocketEnabled,
                shiprocketConfigured,
                marketingEmailMode,
                marketingEmailProvider,
                liveEmailEnabled: marketingEmailMode === 'live'
            },
            auth: {
                googleEnabled: googleAuthConfigured,
                googleClientId: googleAuthConfigured ? getGoogleClientId() : ''
            },
            rollout: {
                fitRolloutPercent,
                fitConfidenceMin
            }
        }
    });
};

export { getSystemBootstrap };
