import express from 'express';
import {placeOrderStripe,placeOrderRazorpay,allOrders,userOrders,updateOrderStatus,verifyStripe, verifyRazorpay } from '../controllers/orderController.js';
import adminAuth from '../middleware/adminAuth.js';
import authUser from '../middleware/auth.js';
import validateRequest from '../middleware/validateRequest.js';
import { orderCreateSchema, orderStatusSchema, razorpayVerifySchema, stripeVerifySchema } from '../validation/schemas.js';

const orderRouter = express.Router();

//Admin features
orderRouter.post('/list', adminAuth,allOrders);
orderRouter.post('/status',adminAuth,validateRequest(orderStatusSchema),updateOrderStatus);



//Payment Features

//orderRouter.post('/place',authUser,placeOrder);
orderRouter.post('/stripe',authUser,validateRequest(orderCreateSchema),placeOrderStripe);
orderRouter.post('/razorpay',authUser,validateRequest(orderCreateSchema),placeOrderRazorpay);



//User Features
orderRouter.post('/userorders',authUser,userOrders);

//Verify payment
orderRouter.post('/verifyStripe',authUser,validateRequest(stripeVerifySchema),verifyStripe);
orderRouter.post('/verifyRazorpay',authUser,validateRequest(razorpayVerifySchema),verifyRazorpay);

export default orderRouter;