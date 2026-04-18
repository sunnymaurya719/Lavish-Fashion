import express from 'express';
import { getSystemBootstrap } from '../controllers/systemController.js';
import {
    handleShiprocketWebhookStatus,
    handleShiprocketWebhookDrainAdmin,
    handleShiprocketWebhookDrainCron
} from '../controllers/maintenanceController.js';
import { testShiprocketConnection } from '../controllers/orderController.js';
import adminAuth from '../middleware/adminAuth.js';

const systemRouter = express.Router();

systemRouter.get('/bootstrap', getSystemBootstrap);
systemRouter.get('/shiprocket/test', adminAuth, testShiprocketConnection);
systemRouter.get('/shiprocket/webhook-status', adminAuth, handleShiprocketWebhookStatus);
systemRouter.get('/shiprocket/webhook-drain', handleShiprocketWebhookDrainCron);
systemRouter.post('/shiprocket/webhook-drain', adminAuth, handleShiprocketWebhookDrainAdmin);

export default systemRouter;
