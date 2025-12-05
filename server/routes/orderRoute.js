import express from 'express';
import { placeOrder,placeOrderStripe,placeOrderRazorpay,allOrders,userOrders,updateOrderStatus,verifyStripe } from '../controllers/orderController.js';
import adminAuth from '../middleware/adminAuth.js';
import authUser from '../middleware/auth.js';

const orderRouter = express.Router();

//Admin features
orderRouter.post('/list', adminAuth,allOrders);
orderRouter.post('/status',adminAuth,updateOrderStatus);



//Payment Features

//orderRouter.post('/place',authUser,placeOrder);
orderRouter.post('/stripe',authUser,placeOrderStripe);
orderRouter.post('/razorpay',authUser,placeOrderRazorpay);



//User Features
orderRouter.post('/userorders',authUser,userOrders);

//Verify payment
orderRouter.post('/verifyStripe',authUser,verifyStripe);

export default orderRouter;