import logger from './logger.js';

const requiredEnvVars = ['MONGODB_URI', 'JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'];

const optionalButRecommendedEnvVars = [
    'CLOUDINARY_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_SECRET_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET'
];

const validateEnvironment = () => {
    const missingVars = requiredEnvVars.filter((envName) => !process.env[envName]);

    if (missingVars.length > 0) {
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    const missingOptionalVars = optionalButRecommendedEnvVars.filter((envName) => !process.env[envName]);
    if (missingOptionalVars.length > 0) {
        logger.warn(
            { missingOptionalVars },
            'Optional environment variables are missing. Some payment/media features may be unavailable.'
        );
    }
};

export default validateEnvironment;