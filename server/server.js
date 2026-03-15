import 'dotenv/config'
import connectDB from './config/mongodb.js';
import connectCloudinary from './config/cloudinary.js';
import validateEnvironment from './config/env.js';
import logger from './config/logger.js';
import createApp from './app.js';

const port = process.env.PORT || 4000;

validateEnvironment();

//DB config
await connectDB();

//Cloudinary config
await connectCloudinary();

const app = createApp();

const server = app.listen(port, () => logger.info({ port }, `Listening on localhost:${port}`));

const shutdown = (signal) => {
    logger.info(`${signal} received. Shutting down gracefully...`);
    server.close(() => {
        logger.info('HTTP server closed.');
        process.exit(0);
    });

    setTimeout(() => {
        logger.error('Force shutdown after timeout.');
        process.exit(1);
    }, 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
