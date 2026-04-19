import express from 'express';
import {
    allOrders,
    backfillShiprocketPricingSnapshots,
    cancelRazorpayPaymentAttempt,
    cancelShiprocketBulkLiveVerification,
    cancelUserOrder,
    getRazorpayPaymentDetails,
    getShiprocketBulkLiveVerificationJob,
    getShiprocketOrderDetails,
    placeOrderCOD,
    placeOrderRazorpay,
    previewCheckoutPricing,
    refundOrder,
    retryShiprocketSync,
    startShiprocketBulkLiveVerification,
    trackShiprocketOrder,
    updateOrderStatus,
    userOrders,
    verifyShiprocketPricingLive,
    verifyRazorpay
} from '../controllers/orderController.js';
import adminAuth from '../middleware/adminAuth.js';
import authUser from '../middleware/auth.js';
import validateRequest from '../middleware/validateRequest.js';
import {
    orderCreateSchema,
    orderCancelParamsSchema,
    orderPricingPreviewSchema,
    orderRefundSchema,
    orderStatusSchema,
    razorpayPaymentAttemptCancelSchema,
    razorpayVerifySchema,
    shiprocketBulkLiveVerificationCancelSchema,
    shiprocketBulkLiveVerificationSchema,
    shiprocketPricingBackfillSchema,
    shiprocketOrderParamsSchema
} from '../validation/schemas.js';

const orderRouter = express.Router();

//Admin features
orderRouter.post('/list', adminAuth,allOrders);
orderRouter.post('/status',adminAuth,validateRequest(orderStatusSchema),updateOrderStatus);



//Payment Features

orderRouter.post('/preview',authUser,validateRequest(orderPricingPreviewSchema),previewCheckoutPricing);
orderRouter.post('/create',authUser,validateRequest(orderCreateSchema),placeOrderCOD);
orderRouter.post('/place',authUser,validateRequest(orderCreateSchema),placeOrderCOD);
orderRouter.post('/razorpay',authUser,validateRequest(orderCreateSchema),placeOrderRazorpay);



//User Features
orderRouter.post('/:orderId/cancel', authUser, validateRequest(orderCancelParamsSchema, 'params'), cancelUserOrder);
orderRouter.post('/userorders',authUser,userOrders);

//Shiprocket admin features
orderRouter.post(
    '/shiprocket/backfill-pricing-snapshots',
    adminAuth,
    validateRequest(shiprocketPricingBackfillSchema),
    backfillShiprocketPricingSnapshots
);
orderRouter.get('/shiprocket/live-verification-job', adminAuth, getShiprocketBulkLiveVerificationJob);
orderRouter.post(
    '/shiprocket/verify-live-bulk',
    adminAuth,
    validateRequest(shiprocketBulkLiveVerificationSchema),
    startShiprocketBulkLiveVerification
);
orderRouter.post(
    '/shiprocket/verify-live-bulk/cancel',
    adminAuth,
    validateRequest(shiprocketBulkLiveVerificationCancelSchema),
    cancelShiprocketBulkLiveVerification
);
orderRouter.post('/:orderId/shiprocket/retry', adminAuth, validateRequest(shiprocketOrderParamsSchema, 'params'), retryShiprocketSync);
orderRouter.post(
    '/:orderId/shiprocket/verify-live',
    adminAuth,
    validateRequest(shiprocketOrderParamsSchema, 'params'),
    verifyShiprocketPricingLive
);
orderRouter.get('/:orderId/shiprocket', adminAuth, validateRequest(shiprocketOrderParamsSchema, 'params'), getShiprocketOrderDetails);
orderRouter.get('/:orderId/shiprocket/track', adminAuth, validateRequest(shiprocketOrderParamsSchema, 'params'), trackShiprocketOrder);

//Verify payment
orderRouter.post('/verifyRazorpay',authUser,validateRequest(razorpayVerifySchema),verifyRazorpay);

// Cancel a Razorpay payment attempt (releases reserved inventory & loyalty points
// when the user dismisses the Razorpay checkout modal without paying).
orderRouter.post(
    '/payment-attempt/:attemptId/cancel',
    authUser,
    validateRequest(razorpayPaymentAttemptCancelSchema, 'params'),
    cancelRazorpayPaymentAttempt
);

// Admin: fetch Razorpay payment details + refund history for an order.
orderRouter.get(
    '/:orderId/razorpay/payment',
    adminAuth,
    validateRequest(shiprocketOrderParamsSchema, 'params'),
    getRazorpayPaymentDetails
);

// Admin: issue a Razorpay refund (full or partial) against a paid order.
orderRouter.post(
    '/:orderId/refund',
    adminAuth,
    validateRequest(shiprocketOrderParamsSchema, 'params'),
    validateRequest(orderRefundSchema),
    refundOrder
);

export default orderRouter;
