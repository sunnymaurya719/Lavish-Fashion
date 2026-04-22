import {
    getFitConfidenceMin,
    getFitRolloutPercent,
    isFitAssistantGloballyEnabled,
    isFitCameraGloballyEnabled
} from '../services/fitRuntimeService.js';
import { getGoogleClientId, isGoogleAuthConfigured } from '../services/googleAuthService.js';
import { probeMlServiceHealth } from '../services/mlGatewayService.js';
import { isShiprocketConfigured, isShiprocketEnabled } from '../config/shiprocket.js';
import auditLogModel from '../models/auditLogModel.js';
import {
    getPaymentSettings,
    updatePaymentSettings as persistPaymentSettings
} from '../services/paymentSettingsService.js';

const normalizeUrl = (value) => String(value || '').trim().replace(/\/$/, '');
const toPublicUrl = (value) => (/^https?:\/\/.+/i.test(normalizeUrl(value)) ? normalizeUrl(value) : '');

const isConfigured = (...values) => values.every((value) => Boolean(String(value || '').trim()));

const buildSystemBootstrap = async (req) => {
    const cloudinaryConfigured = isConfigured(
        process.env.CLOUDINARY_NAME,
        process.env.CLOUDINARY_API_KEY,
        process.env.CLOUDINARY_SECRET_KEY
    );
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
    const paymentSettings = await getPaymentSettings();

    return {
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
            codEnabled: Boolean(paymentSettings.codEnabled),
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
            razorpayEnabled,
            razorpayKeyId: razorpayEnabled ? String(process.env.RAZORPAY_KEY_ID || '').trim() : '',
            codEnabled: Boolean(paymentSettings.codEnabled)
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
    };
};

const getSystemBootstrap = async (req, res) => {
    const bootstrap = await buildSystemBootstrap(req);

    return res.status(200).json({
        success: true,
        bootstrap
    });
};

const getAdminPaymentSettings = async (req, res) => {
    const settings = await getPaymentSettings();

    return res.status(200).json({
        success: true,
        settings
    });
};

const writePaymentSettingsAuditLog = async ({ req, before, after }) => {
    try {
        await auditLogModel.create({
            actorId: req.admin?.id || null,
            actorEmail: req.admin?.email || '',
            actorRole: req.admin?.role || '',
            action: 'settings.payments.update',
            targetType: 'payment_settings',
            targetLabel: 'default',
            before,
            after,
            ip: req.ip || ''
        });
    } catch (error) {
        req.log?.warn({ err: error }, 'Failed to write payment settings audit log');
    }
};

const updateAdminPaymentSettings = async (req, res) => {
    const previousSettings = await getPaymentSettings();
    const nextSettings = await persistPaymentSettings({
        codEnabled: req.body.codEnabled,
        actor: req.admin
    });

    await writePaymentSettingsAuditLog({
        req,
        before: {
            codEnabled: previousSettings.codEnabled,
            source: previousSettings.source
        },
        after: {
            codEnabled: nextSettings.codEnabled,
            source: nextSettings.source
        }
    });

    return res.status(200).json({
        success: true,
        message: nextSettings.codEnabled
            ? 'Cash on Delivery is now available in checkout'
            : 'Cash on Delivery has been disabled for checkout',
        settings: nextSettings
    });
};

export {
    buildSystemBootstrap,
    getAdminPaymentSettings,
    getSystemBootstrap,
    updateAdminPaymentSettings
};
