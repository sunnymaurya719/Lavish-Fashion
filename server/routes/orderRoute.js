import express from 'express';
import {
    allOrders,
    placeOrderCOD,
    placeOrderRazorpay,
    placeOrderStripe,
    previewCheckoutPricing,
    updateOrderStatus,
    userOrders,
    verifyRazorpay,
    verifyStripe
} from '../controllers/orderController.js';
import adminAuth from '../middleware/adminAuth.js';
import authUser from '../middleware/auth.js';
import validateRequest from '../middleware/validateRequest.js';
import {
    orderCreateSchema,
    orderPricingPreviewSchema,
    orderStatusSchema,
    razorpayVerifySchema,
    stripeVerifySchema
} from '../validation/schemas.js';

const orderRouter = express.Router();

//Admin features
orderRouter.post('/list', adminAuth,allOrders);
orderRouter.post('/status',adminAuth,validateRequest(orderStatusSchema),updateOrderStatus);



//Payment Features

orderRouter.post('/preview',authUser,validateRequest(orderPricingPreviewSchema),previewCheckoutPricing);
orderRouter.post('/place',authUser,validateRequest(orderCreateSchema),placeOrderCOD);
orderRouter.post('/stripe',authUser,validateRequest(orderCreateSchema),placeOrderStripe);
orderRouter.post('/razorpay',authUser,validateRequest(orderCreateSchema),placeOrderRazorpay);



//User Features
orderRouter.post('/userorders',authUser,userOrders);

//Verify payment
orderRouter.post('/verifyStripe',authUser,validateRequest(stripeVerifySchema),verifyStripe);
orderRouter.post('/verifyRazorpay',authUser,validateRequest(razorpayVerifySchema),verifyRazorpay);

export default orderRouter;
