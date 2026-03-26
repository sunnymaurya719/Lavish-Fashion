import logger from './logger.js';

const requiredEnvVars = ['MONGODB_URI', 'JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'];

const optionalButRecommendedEnvVars = [
    'CLOUDINARY_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_SECRET_KEY',
    'CLIENT_URL',
    'ADMIN_URL',
    'FRONTEND_URL',
    'CORS_ORIGINS',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
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
    'RESEND_API_KEY'
];

const urlEnvVars = ['CLIENT_URL', 'ADMIN_URL', 'FRONTEND_URL'];
const isValidWebUrl = (value) => /^https?:\/\/.+/i.test(String(value || '').trim());

const validateEnvironment = () => {
    const missingVars = requiredEnvVars.filter((envName) => !process.env[envName]);

    if (missingVars.length > 0) {
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    const missingOptionalVars = optionalButRecommendedEnvVars.filter((envName) => !process.env[envName]);
    if (missingOptionalVars.length > 0) {
        logger.warn(
            { missingOptionalVars },
            'Optional environment variables are missing. Some payment, media, loyalty, marketing, or cross-origin features may be unavailable.'
        );
    }

    const invalidUrlEnvVars = urlEnvVars.filter((envName) => {
        const value = process.env[envName];
        return value && !isValidWebUrl(value);
    });

    if (invalidUrlEnvVars.length > 0) {
        logger.warn(
            { invalidUrlEnvVars },
            'Some configured URL environment variables are not valid http/https URLs and will be ignored for public bootstrap metadata or CORS allowlists.'
        );
    }
};

export default validateEnvironment;
