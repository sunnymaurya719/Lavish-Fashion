import mongoose from 'mongoose';
import logger from './logger.js';

let listenersAttached = false;

const buildMongoUri = () => {
    const baseUri = String(process.env.MONGODB_URI || '').trim().replace(/\/$/, '');
    return `${baseUri}/LavishFashion`;
};

const attachConnectionListeners = () => {
    if (listenersAttached) {
        return;
    }

    listenersAttached = true;

    mongoose.connection.on('connected', () => logger.info('Database connected successfully'));
    mongoose.connection.on('error', (error) => {
        logger.error({ err: error }, 'MongoDB connection error');
    });
    mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB connection lost');
    });
};

const connectDB = async () => {
    try {
        attachConnectionListeners();
        await mongoose.connect(buildMongoUri(), {
            serverSelectionTimeoutMS: 10000
        });
        return mongoose.connection;
    }
    catch(error){
        logger.error({ err: error }, 'MongoDB failed to connect during startup');
        throw error;
    }
};


export default connectDB;

