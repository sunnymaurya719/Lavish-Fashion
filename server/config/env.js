import logger from './logger.js';

const normalizeEnvValue = (value) => String(value || '').trim();
const isFeatureEnabled = (value) => ['1', 'true', 'yes', 'on'].includes(normalizeEnvValue(value).toLowerCase());

const requiredEnvVars = [
    'MONGODB_URI',
    'JWT_SECRET',
    'ADMIN_EMAIL',
    'ADMIN_PASSWORD',
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_TEMPLATE_ORDER_PLACED',
    'WHATSAPP_TEMPLATE_OUT_FOR_DELIVERY',
    'WHATSAPP_TEMPLATE_DELIVERED',
    'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    'WHATSAPP_APP_SECRET'
];

const optionalButRecommendedEnvVars = [
    'CLOUDINARY_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_SECRET_KEY',
    'CLIENT_URL',
    'ADMIN_URL',
    'FRONTEND_URL',
    'CORS_ORIGINS',
    'GOOGLE_CLIENT_ID',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'LOYALTY_ORDER_POINTS_DIVISOR',
    'REVIEW_REWARD_POINTS',
    'REFERRAL_REWARD_REFERRER',
    'REFERRAL_REWARD_NEW_USER',
    'LOYALTY_POINT_VALUE',
    'LOYALTY_MIN_REDEEM_POINTS',
    'LOYALTY_MAX_REDEEM_SHARE',
    'LOYALTY_MAX_REDEEM_POINTS_PER_ORDER',
    'LOYALTY_MAX_REDEEM_POINTS_PER_PRODUCT',
    'MARKETING_EMAIL_MODE',
    'MARKETING_EMAIL_PROVIDER',
    'MARKETING_FROM_EMAIL',
    'MARKETING_REPLY_TO_EMAIL',
    'RESEND_API_KEY',
    'WHATSAPP_TEMPLATE_LANGUAGE_CODE',
    'WHATSAPP_GRAPH_API_VERSION',
    'WHATSAPP_DEFAULT_COUNTRY_CODE',
    'WHATSAPP_NOTIFICATION_LOCK_TTL_MS',
    'WHATSAPP_MAX_RETRIES',
    'CRON_SECRET',
    'SHIPROCKET_ENABLED',
    'SHIPROCKET_WEBHOOK_API_KEY',
    'SHIPROCKET_WEBHOOK_DRAIN_BATCH_SIZE',
    'SHIPROCKET_WEBHOOK_DRAIN_TIME_BUDGET_MS',
    'SHIPROCKET_WEBHOOK_DRAIN_LOCK_TTL_MS',
    'SHIPROCKET_WEBHOOK_PROCESSING_STALE_AFTER_MS',
    'FIT_ASSISTANT_ENABLED',
    'FIT_CAMERA_ENABLED',
    'FIT_ENABLE_PERCENT',
    'FIT_CONFIDENCE_MIN',
    'ML_SERVICE_URL',
    'ML_SERVICE_TIMEOUT_MS',
    'ML_SERVICE_SHARED_SECRET',
    'REDIS_URL',
    'FIT_CACHE_TTL_SECONDS',
    'FIT_SCAN_SESSION_TTL_SECONDS',
    'BODY_SCAN_MAX_IMAGE_BYTES'
];

const urlEnvVars = ['CLIENT_URL', 'ADMIN_URL', 'FRONTEND_URL', 'ML_SERVICE_URL'];
const isValidWebUrl = (value) => /^https?:\/\/.+/i.test(String(value || '').trim());

const validateEnvironment = () => {
    const missingVars = requiredEnvVars.filter((envName) => !process.env[envName]);
    const shiprocketRequiredEnvVars = [
        'SHIPROCKET_EMAIL',
        'SHIPROCKET_PASSWORD',
        'SHIPROCKET_BASE_URL',
        'SHIPROCKET_PICKUP_LOCATION'
    ];
    const shiprocketEnabled = isFeatureEnabled(process.env.SHIPROCKET_ENABLED);

    if (missingVars.length > 0) {
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    if (shiprocketEnabled) {
        const missingShiprocketVars = shiprocketRequiredEnvVars.filter((envName) => !normalizeEnvValue(process.env[envName]));

        if (missingShiprocketVars.length > 0) {
            throw new Error(`Missing required Shiprocket environment variables: ${missingShiprocketVars.join(', ')}`);
        }
    }

    const missingOptionalVars = optionalButRecommendedEnvVars.filter((envName) => !process.env[envName]);
    if (missingOptionalVars.length > 0) {
        logger.warn(
            { missingOptionalVars },
            'Optional environment variables are missing. Some payment, media, loyalty, marketing, fit-assistant, ML, cache, or cross-origin features may be unavailable.'
        );
    }

    const invalidUrlEnvVars = urlEnvVars.filter((envName) => {
        const value = process.env[envName];
        return value && !isValidWebUrl(value);
    });

    if (invalidUrlEnvVars.length > 0) {
        logger.warn(
            { invalidUrlEnvVars },
            'Some configured URL environment variables are not valid http/https URLs and will be ignored for public bootstrap metadata, CORS allowlists, or service integration calls.'
        );
    }

    if (!shiprocketEnabled) {
        logger.info('Shiprocket integration is disabled via SHIPROCKET_ENABLED');
    }
};

export default validateEnvironment;
