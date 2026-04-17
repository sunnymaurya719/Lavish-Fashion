import express from 'express';
import {
    allOrders,
    cancelUserOrder,
    getShiprocketOrderDetails,
    placeOrderCOD,
    placeOrderRazorpay,
    placeOrderStripe,
    previewCheckoutPricing,
    retryShiprocketSync,
    trackShiprocketOrder,
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
    orderCancelParamsSchema,
    orderPricingPreviewSchema,
    orderStatusSchema,
    razorpayVerifySchema,
    shiprocketOrderParamsSchema,
    stripeVerifySchema
} from '../validation/schemas.js';

const orderRouter = express.Router();

//Admin features
orderRouter.post('/list', adminAuth,allOrders);
orderRouter.post('/status',adminAuth,validateRequest(orderStatusSchema),updateOrderStatus);



//Payment Features

orderRouter.post('/preview',authUser,validateRequest(orderPricingPreviewSchema),previewCheckoutPricing);
orderRouter.post('/create',authUser,validateRequest(orderCreateSchema),placeOrderCOD);
orderRouter.post('/place',authUser,validateRequest(orderCreateSchema),placeOrderCOD);
orderRouter.post('/stripe',authUser,validateRequest(orderCreateSchema),placeOrderStripe);
orderRouter.post('/razorpay',authUser,validateRequest(orderCreateSchema),placeOrderRazorpay);



//User Features
orderRouter.post('/:orderId/cancel', authUser, validateRequest(orderCancelParamsSchema, 'params'), cancelUserOrder);
orderRouter.post('/userorders',authUser,userOrders);

//Shiprocket admin features
orderRouter.post('/:orderId/shiprocket/retry', adminAuth, validateRequest(shiprocketOrderParamsSchema, 'params'), retryShiprocketSync);
orderRouter.get('/:orderId/shiprocket', adminAuth, validateRequest(shiprocketOrderParamsSchema, 'params'), getShiprocketOrderDetails);
orderRouter.get('/:orderId/shiprocket/track', adminAuth, validateRequest(shiprocketOrderParamsSchema, 'params'), trackShiprocketOrder);

//Verify payment
orderRouter.post('/verifyStripe',authUser,validateRequest(stripeVerifySchema),verifyStripe);
orderRouter.post('/verifyRazorpay',authUser,validateRequest(razorpayVerifySchema),verifyRazorpay);

export default orderRouter;
