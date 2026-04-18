import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import userRouter from './routes/userRoute.js';
import productRouter from './routes/productRoute.js';
import cartRouter from './routes/cartRoute.js';
import orderRouter from './routes/orderRoute.js';
import couponRouter from './routes/couponRoute.js';
import customerRouter from './routes/customerRoute.js';
import dashboardRouter from './routes/dashboardRoute.js';
import loyaltyRouter from './routes/loyaltyRoute.js';
import marketingRouter from './routes/marketingRoute.js';
import reviewRouter from './routes/reviewRoute.js';
import realtimeRouter from './routes/realtimeRoute.js';
import systemRouter from './routes/systemRoute.js';
import fitRouter from './routes/fitRoute.js';
import testRouter from './routes/testRoute.js';
import webhookRouter from './routes/webhookRoute.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import requestLogger from './middleware/requestLogger.js';

const normalizeOrigin = (value) => String(value || '').trim().replace(/\/$/, '');
const isValidWebUrl = (value) => /^https?:\/\/.+/i.test(normalizeOrigin(value));
const getJsonBodyLimitBytes = () => {
    const configuredBodyScanBytes = Number(process.env.BODY_SCAN_MAX_IMAGE_BYTES || 1200000);
    const bodyScanSafeBytes =
        Number.isFinite(configuredBodyScanBytes) && configuredBodyScanBytes > 0
            ? Math.ceil(configuredBodyScanBytes * 1.4)
            : 1_680_000;

    return Math.max(1_000_000, bodyScanSafeBytes);
};

const buildCorsOptions = () => {
    const envOrigins = [
        process.env.CLIENT_URL,
        process.env.ADMIN_URL,
        process.env.FRONTEND_URL,
        ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : [])
    ];

    const allowedOrigins = [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:5174',
        'http://127.0.0.1:5174',
        'https://lavishfashion.vercel.app',
        'https://lavishfashionadmin.vercel.app',
        ...envOrigins
    ]
        .map(normalizeOrigin)
        .filter(isValidWebUrl);

    const allowedOriginSet = new Set(allowedOrigins);

    return {
        origin: (origin, callback) => {
            if (!origin || allowedOriginSet.has(normalizeOrigin(origin))) {
                return callback(null, true);
            }

            return callback(new Error('CORS not allowed from this origin'));
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Requested-With',
            'token',
            'stripe-signature',
            'x-razorpay-signature',
            'x-api-key',
            'idempotency-key',
            'x-request-id'
        ],
        credentials: true,
        maxAge: 86400
    };
};

const createApp = () => {
    const app = express();
    const corsOptions = buildCorsOptions();

    app.disable('x-powered-by');
    app.set('trust proxy', 1);

    app.use(helmet());
    app.use(compression({ threshold: 1024, level: 6 }));
    app.use(requestLogger);
    app.use(cors(corsOptions));
    app.options(/.*/, cors(corsOptions));

    app.use('/api/webhooks', webhookRouter);

    const apiRateLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 300,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            message: 'Too many requests. Please retry later.'
        }
    });

    app.use('/api', apiRateLimiter);
    app.use(express.json({ limit: getJsonBodyLimitBytes() }));

    app.use('/api/system', systemRouter);
    app.use('/api/test', testRouter);
    app.use('/api/fit', fitRouter);
    app.use('/api/realtime', realtimeRouter);
    app.use('/api/user',userRouter);
    app.use('/api/admin/dashboard', dashboardRouter);
    app.use('/api/customers', customerRouter);
    app.use('/api/coupon', couponRouter);
    app.use('/api/loyalty', loyaltyRouter);
    app.use('/api/marketing', marketingRouter);
    app.use('/api/product',productRouter);
    app.use('/api/review', reviewRouter);
    app.use('/api/cart',cartRouter);
    app.use('/api/order',orderRouter);
    app.use('/api/orders', orderRouter);

    app.get('/health', (req, res) => {
        res.status(200).json({
            success: true,
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        });
    });

    app.get('/',(req,res) => {
        res.send('API working');
    });

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
};

export default createApp;
