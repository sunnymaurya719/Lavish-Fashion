import express from 'express';
import {
    getAdminPaymentSettings,
    getSystemBootstrap,
    updateAdminPaymentSettings
} from '../controllers/systemController.js';
import {
    handleShiprocketWebhookStatus,
    handleShiprocketWebhookDrainAdmin,
    handleShiprocketWebhookDrainCron
} from '../controllers/maintenanceController.js';
import { testShiprocketConnection } from '../controllers/orderController.js';
import adminAuth, { authorizePermissions } from '../middleware/adminAuth.js';
import validateRequest from '../middleware/validateRequest.js';
import { paymentSettingsUpdateSchema } from '../validation/schemas.js';

const systemRouter = express.Router();

systemRouter.get('/bootstrap', getSystemBootstrap);
systemRouter.get('/payments', adminAuth, authorizePermissions('settings.view'), getAdminPaymentSettings);
systemRouter.patch(
    '/payments',
    adminAuth,
    authorizePermissions('settings.update'),
    validateRequest(paymentSettingsUpdateSchema),
    updateAdminPaymentSettings
);
systemRouter.get('/shiprocket/test', adminAuth, testShiprocketConnection);
systemRouter.get('/shiprocket/webhook-status', adminAuth, handleShiprocketWebhookStatus);
systemRouter.get('/shiprocket/webhook-drain', handleShiprocketWebhookDrainCron);
systemRouter.post('/shiprocket/webhook-drain', adminAuth, handleShiprocketWebhookDrainAdmin);

export default systemRouter;
