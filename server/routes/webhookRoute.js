import express from 'express';
import { handleRazorpayWebhook, handleStripeWebhook } from '../controllers/orderController.js';

const webhookRouter = express.Router();

webhookRouter.post('/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);
webhookRouter.post('/razorpay', express.raw({ type: 'application/json' }), handleRazorpayWebhook);

export default webhookRouter;