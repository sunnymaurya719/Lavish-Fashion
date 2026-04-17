import express from 'express';
import { handleRazorpayWebhook, handleShiprocketWebhook, handleStripeWebhook } from '../controllers/orderController.js';
import {
    captureRawRequestBody,
    handleWhatsAppWebhookEvent,
    handleWhatsAppWebhookVerification
} from '../services/whatsappService.js';

const webhookRouter = express.Router();

webhookRouter.post('/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);
webhookRouter.post('/razorpay', express.raw({ type: 'application/json' }), handleRazorpayWebhook);
webhookRouter.post('/shiprocket', express.json({ limit: '256kb' }), handleShiprocketWebhook);
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
