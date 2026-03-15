import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import userRouter from './routes/userRoute.js';
import productRouter from './routes/productRoute.js';
import cartRouter from './routes/cartRoute.js';
import orderRouter from './routes/orderRoute.js';
import webhookRouter from './routes/webhookRoute.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import requestLogger from './middleware/requestLogger.js';

const normalizeOrigin = (value) => String(value || '').trim().replace(/\/$/, '');

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
        ...envOrigins
    ]
        .map(normalizeOrigin)
        .filter(Boolean);

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
            'token',
            'stripe-signature',
            'x-razorpay-signature',
            'idempotency-key',
            'x-request-id'
        ],
        credentials: true,
        maxAge: 86400
    };
};

const createApp = () => {
    const app = express();

    app.disable('x-powered-by');
    app.set('trust proxy', 1);

    app.use(helmet());
    app.use(compression());
    app.use(requestLogger);

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
    app.use(express.json({ limit: '1mb' }));
    app.use(cors(buildCorsOptions()));

    app.use('/api/user',userRouter);
    app.use('/api/product',productRouter);
    app.use('/api/cart',cartRouter);
    app.use('/api/order',orderRouter);

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