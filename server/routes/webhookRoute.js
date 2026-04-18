import express from 'express';
import { handleRazorpayWebhook, handleStripeWebhook } from '../controllers/orderController.js';
import { handleShiprocketWebhook } from '../controllers/webhookController.js';
import {
    captureRawRequestBody,
    handleWhatsAppWebhookEvent,
    handleWhatsAppWebhookVerification
} from '../services/whatsappService.js';

const webhookRouter = express.Router();
const jsonWebhookBody = express.json({ limit: '256kb' });

webhookRouter.post('/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);
webhookRouter.post('/razorpay', express.raw({ type: 'application/json' }), handleRazorpayWebhook);
webhookRouter.post('/shiprocket', jsonWebhookBody, handleShiprocketWebhook);
webhookRouter.post('/tracking-events', jsonWebhookBody, handleShiprocketWebhook);
webhookRouter.get('/whatsapp', handleWhatsAppWebhookVerification);
webhookRouter.post(
    '/whatsapp',
    express.json({
        limit: '256kb',
        verify: captureRawRequestBody
    }),
    handleWhatsAppWebhookEvent
);

export default webhookRouter;
