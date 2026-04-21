import orderModel from '../models/orderModel.js';
import paymentAttemptModel from '../models/paymentAttemptModel.js';
import userModel from '../models/userModel.js';
import { razorpayWebhookEventSchema } from '../validation/schemas.js';
import { beginIdempotentRequest, completeIdempotentRequest } from '../services/idempotencyService.js';
import {
    DEFAULT_DELIVERY_CHARGE,
    calculateCheckoutPricing,
    createCheckoutError,
    isCheckoutError
} from '../services/checkoutPricingService.js';
import {
    releaseInventoryForItems,
    reserveInventoryForItems
} from '../services/productInventoryService.js';
import { publishAdminOrderUpsert } from '../services/realtimeService.js';
import {
    finalizeReservedLoyaltyRedemption,
    releaseReservedLoyaltyRedemption,
    releaseUserReservedLoyaltyPoints,
    reserveLoyaltyRedemption
} from '../services/loyaltyService.js';
import {
    SHIPROCKET_SYNC_STATUS,
    buildShiprocketPricingSnapshot,
    decorateOrderWithShiprocketPricingAudit,
    getOrder as getShiprocketOrder,
    getPickupAddressStatus,
    refreshOrderTracking,
    syncOrderToShiprocket,
    verifyOrderPricingAgainstLiveShiprocket
} from '../services/shiprocketService.js';
import {
    cancelShiprocketBulkLiveVerificationJob,
    getShiprocketBulkVerifyJobStatus,
    startShiprocketBulkLiveVerificationJob
} from '../services/shiprocketBulkLiveVerificationService.js';
import { sendOrderPlacedMessage } from '../services/whatsappService.js';
import {
    ORDER_STATUS,
    applyOrderStatusTransition,
    normalizeOrderStatus,
    performOrderCancellation
} from '../services/orderStatusService.js';
import { getShiprocketConfig, getValidToken, isShiprocketConfigured, isShiprocketEnabled } from '../config/shiprocket.js';
import {
    createCheckoutOrder as createRazorpayCheckoutOrder,
    fetchPayment as fetchRazorpayPayment,
    isRazorpayConfigured,
    isRazorpayWebhookConfigured,
    secureCompare,
    verifyCheckoutSignature as verifyRazorpayCheckoutSignature,
    verifyWebhookSignature as verifyRazorpayWebhookSignature
} from '../services/razorpayService.js';
import razorpayWebhookEventModel from '../models/razorpayWebhookEventModel.js';
import crypto from 'crypto';

//global variables
const currency = 'inr';
const deliveryCharge = DEFAULT_DELIVERY_CHARGE;

const ORDER_CANCELLATION_WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_SHIPROCKET_REFERENCE_LENGTH = 20;
const DEFAULT_SHIPROCKET_SNAPSHOT_BACKFILL_LIMIT = 200;
const MAX_SHIPROCKET_SNAPSHOT_BACKFILL_LIMIT = 1000;
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const resolveOrderCreatedAtMs = (order) => {
    const createdAtValue = order?.createdAt ?? order?.date ?? 0;

    if (createdAtValue instanceof Date) {
        return createdAtValue.getTime();
    }

    const numericValue = Number(createdAtValue);
    if (Number.isFinite(numericValue) && numericValue > 0) {
        return numericValue;
    }

    const parsedValue = new Date(createdAtValue).getTime();
    return Number.isFinite(parsedValue) ? parsedValue : 0;
};

const isOrderWithinCancellationWindow = (order, now = Date.now()) => {
    const createdAtMs = resolveOrderCreatedAtMs(order);

    if (!createdAtMs) {
        return false;
    }

    return now - createdAtMs <= ORDER_CANCELLATION_WINDOW_MS;
};

const generateShiprocketReferenceOrderId = () => {
    const timestampSegment = Date.now().toString(36).toUpperCase();
    const randomSegment = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `LF${timestampSegment}${randomSegment}`.slice(0, MAX_SHIPROCKET_REFERENCE_LENGTH);
};

const buildInitialShiprocketState = ({ referenceOrderId = '' } = {}) => ({
    syncStatus: isShiprocketEnabled() ? SHIPROCKET_SYNC_STATUS.pending : SHIPROCKET_SYNC_STATUS.notRequired,
    referenceOrderId: String(referenceOrderId || '').trim(),
    lastError: ''
});

const resolveCustomerEmail = async (userId) => {
    const user = await userModel.findById(userId).select('email').lean();
    return normalizeEmail(user?.email);
};

const getRazorpayClient = () => {
    if (!isRazorpayConfigured()) {
        return null;
    }

    return true;
};

const clearCartForCompletedOrder = async (order) => {
    if (!order || order.checkoutSource === 'buy_now') {
        return;
    }

    await userModel.findByIdAndUpdate(order.userId, { cartData: {} });
};

const releaseInventoryForOrder = async (order) => {
    if (!order || !order.inventoryReserved) {
        return;
    }

    await releaseInventoryForItems(order.items);
    await orderModel.findByIdAndUpdate(order._id, { inventoryReserved: false });
};

const markOrderAsPaid = async ({ order, gatewayEventId, paymentFields, log }) => {
    if (!order || order.payment) {
        return order;
    }

    // Seed paise-denominated fields used by the refund subsystem. The new
    // refundService relies on `refundableAmountInPaise` being set on capture
    // (default 0). Without this, every refund call fails with
    // "Requested refund exceeds remaining refundable amount".
    const amountInPaise = Math.round(Number(order.amount || 0) * 100);

    const updatedOrder = await orderModel.findByIdAndUpdate(
        order._id,
        {
            payment: true,
            paymentStatus: 'paid',
            paymentVerifiedAt: Date.now(),
            inventoryReserved: true,
            gatewayEventId: gatewayEventId || order.gatewayEventId,
            amountInPaise,
            refundedAmountInPaise: 0,
            refundableAmountInPaise: amountInPaise,
            ...paymentFields
        },
        { new: true }
    );

    await finalizeReservedLoyaltyRedemption({ order: updatedOrder });

    await clearCartForCompletedOrder(order);
    await publishAdminOrderUpsert({
        order: updatedOrder,
        source: 'orderController.markOrderAsPaid'
    });

    await attemptShiprocketOrderSync({
        order: updatedOrder,
        log
    });

    return updatedOrder;
};

const markOrderAsFailed = async ({ order, gatewayEventId, paymentFields }) => {
    if (!order || order.payment) {
        return order;
    }

    await releaseInventoryForOrder(order);
    await releaseReservedLoyaltyRedemption({ order });

    const updatedOrder = await orderModel.findByIdAndUpdate(
        order._id,
        {
            paymentStatus: 'failed',
            inventoryReserved: false,
            gatewayEventId: gatewayEventId || order.gatewayEventId,
            loyaltyRedemptionStatus:
                Number(order.loyaltyPointsRedeemed || 0) > 0 ? 'released' : order.loyaltyRedemptionStatus,
            loyaltyRedemptionReleasedAt:
                Number(order.loyaltyPointsRedeemed || 0) > 0 ? Date.now() : order.loyaltyRedemptionReleasedAt,
            ...paymentFields
        },
        { new: true }
    );

    await publishAdminOrderUpsert({
        order: updatedOrder,
        source: 'orderController.markOrderAsFailed'
    });

    return updatedOrder;
};

const isValidObjectId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

const getIdempotencyKey = (req) => String(req.headers['idempotency-key'] || '').trim();

const calculateOrderDetails = async ({ userId, items, couponCode = '', pointsToRedeem = 0 }) => {
    return calculateCheckoutPricing({
        userId,
        items,
        couponCode,
        pointsToRedeem,
        deliveryCharge
    });
};

const buildOrderData = ({
    userId,
    normalizedItems,
    pricing,
    address,
    customerEmail,
    checkoutSource,
    paymentMethod,
    shiprocketReferenceOrderId
}) => ({
    userId,
    items: normalizedItems,
    subtotal: pricing.subtotal,
    deliveryFee: pricing.deliveryFee,
    discountAmount: pricing.discountAmount,
    couponDiscountAmount: pricing.couponDiscountAmount || 0,
    loyaltyDiscountAmount: pricing.loyaltyDiscountAmount || 0,
    couponCode: pricing.appliedCoupon?.code || '',
    couponId: pricing.appliedCoupon?.couponId || '',
    amount: pricing.amount,
    address,
    customerEmail,
    checkoutSource,
    inventoryReserved: true,
    paymentMethod,
    payment: false,
    paymentStatus: 'pending',
    loyaltyPointsRedeemed: pricing.loyaltyPointsRedeemed || 0,
    loyaltyRedemptionStatus: Number(pricing.loyaltyPointsRedeemed || 0) > 0 ? 'reserved' : 'none',
    shiprocket: buildInitialShiprocketState({
        referenceOrderId: shiprocketReferenceOrderId
    }),
    date: Date.now()
});

const buildPaymentAttemptData = ({
    userId,
    normalizedItems,
    pricing,
    address,
    customerEmail,
    checkoutSource,
    paymentMethod,
    shiprocketReferenceOrderId
}) => ({
    userId,
    items: normalizedItems,
    subtotal: pricing.subtotal,
    deliveryFee: pricing.deliveryFee,
    discountAmount: pricing.discountAmount,
    couponDiscountAmount: pricing.couponDiscountAmount || 0,
    loyaltyDiscountAmount: pricing.loyaltyDiscountAmount || 0,
    couponCode: pricing.appliedCoupon?.code || '',
    couponId: pricing.appliedCoupon?.couponId || '',
    amount: pricing.amount,
    address,
    customerEmail,
    shiprocketReferenceOrderId,
    checkoutSource,
    paymentMethod,
    inventoryReserved: true,
    loyaltyPointsRedeemed: pricing.loyaltyPointsRedeemed || 0,
    loyaltyRedemptionStatus: Number(pricing.loyaltyPointsRedeemed || 0) > 0 ? 'reserved' : 'none',
    status: 'pending',
    date: Date.now()
});

const attemptShiprocketOrderSync = async ({ order, log, force = false, throwOnFailure = false }) => {
    if (!order?._id) {
        return {
            success: false,
            skipped: true,
            reason: 'missing_order_id'
        };
    }

    try {
        return await syncOrderToShiprocket(order, {
            log,
            force,
            throwOnFailure
        });
    } catch (error) {
        log?.error(
            {
                err: error,
                shiprocketErrorMessage: error?.message || 'Shiprocket sync failed'
            },
            'Shiprocket order sync failed'
        );

        if (throwOnFailure) {
            throw error;
        }

        return {
            success: false,
            error: error?.message || 'Shiprocket sync failed'
        };
    }
};

const releaseResourcesForPaymentAttempt = async (paymentAttempt) => {
    if (!paymentAttempt) {
        return paymentAttempt;
    }

    if (paymentAttempt.inventoryReserved) {
        await releaseInventoryForItems(paymentAttempt.items || []);
    }

    if (
        Number(paymentAttempt.loyaltyPointsRedeemed || 0) > 0 &&
        paymentAttempt.loyaltyRedemptionStatus === 'reserved'
    ) {
        await releaseUserReservedLoyaltyPoints({
            userId: paymentAttempt.userId,
            points: paymentAttempt.loyaltyPointsRedeemed
        });
    }

    return paymentAttemptModel.findByIdAndUpdate(
        paymentAttempt._id,
        {
            inventoryReserved: false,
            loyaltyRedemptionStatus:
                Number(paymentAttempt.loyaltyPointsRedeemed || 0) > 0 ? 'released' : paymentAttempt.loyaltyRedemptionStatus,
            loyaltyRedemptionReleasedAt: Number(paymentAttempt.loyaltyPointsRedeemed || 0) > 0 ? Date.now() : null
        },
        { new: true }
    );
};

const markPaymentAttemptAsNotCompleted = async ({ paymentAttempt, status, gatewayEventId, paymentFields = {} }) => {
    if (!paymentAttempt) {
        return null;
    }

    const latestAttempt = await paymentAttemptModel.findById(paymentAttempt._id);
    if (!latestAttempt) {
        return null;
    }

    if (latestAttempt.status === 'order_created') {
        return latestAttempt;
    }

    const releasedAttempt = await releaseResourcesForPaymentAttempt(latestAttempt);

    return paymentAttemptModel.findByIdAndUpdate(
        paymentAttempt._id,
        {
            status,
            gatewayEventId: gatewayEventId || releasedAttempt?.gatewayEventId || latestAttempt.gatewayEventId,
            ...paymentFields
        },
        { new: true }
    );
};

const createOrderFromPaymentAttempt = async ({ paymentAttempt, gatewayEventId, paymentFields = {}, log }) => {
    if (!paymentAttempt) {
        return null;
    }

    const latestAttempt = await paymentAttemptModel.findById(paymentAttempt._id);
    if (!latestAttempt) {
        return null;
    }

    if (latestAttempt.createdOrderId) {
        const existingOrder = await orderModel.findById(latestAttempt.createdOrderId);

        if (existingOrder) {
            await sendOrderPlacedMessage(existingOrder);
            await attemptShiprocketOrderSync({
                order: existingOrder,
                log
            });
        }

        return existingOrder;
    }

    if (!latestAttempt.inventoryReserved) {
        throw new Error('Payment attempt resources are no longer reserved');
    }

    // Seed paise-denominated fields used by the refund subsystem. Without
    // these, refundableAmountInPaise stays at the schema default (0) and
    // every refund attempt fails with "exceeds remaining refundable amount".
    const orderAmountInPaise = Math.round(Number(latestAttempt.amount || 0) * 100);

    const order = await orderModel.create({
        userId: latestAttempt.userId,
        items: latestAttempt.items,
        subtotal: latestAttempt.subtotal,
        deliveryFee: latestAttempt.deliveryFee,
        discountAmount: latestAttempt.discountAmount,
        couponDiscountAmount: latestAttempt.couponDiscountAmount || 0,
        loyaltyDiscountAmount: latestAttempt.loyaltyDiscountAmount || 0,
        couponCode: latestAttempt.couponCode || '',
        couponId: latestAttempt.couponId || '',
        amount: latestAttempt.amount,
        amountInPaise: orderAmountInPaise,
        refundedAmountInPaise: 0,
        refundableAmountInPaise: orderAmountInPaise,
        address: latestAttempt.address,
        customerEmail: latestAttempt.customerEmail || '',
        checkoutSource: latestAttempt.checkoutSource,
        inventoryReserved: true,
        paymentMethod: latestAttempt.paymentMethod,
        payment: true,
        paymentStatus: 'paid',
        paymentVerifiedAt: Date.now(),
        razorpayOrderId: paymentFields.razorpayOrderId || latestAttempt.razorpayOrderId || null,
        razorpayPaymentId: paymentFields.razorpayPaymentId || latestAttempt.razorpayPaymentId || null,
        gatewayEventId: gatewayEventId || latestAttempt.gatewayEventId || null,
        loyaltyPointsRedeemed: latestAttempt.loyaltyPointsRedeemed || 0,
        loyaltyRedemptionStatus: Number(latestAttempt.loyaltyPointsRedeemed || 0) > 0 ? 'reserved' : 'none',
        shiprocket: buildInitialShiprocketState({
            referenceOrderId: latestAttempt.shiprocketReferenceOrderId || generateShiprocketReferenceOrderId()
        }),
        date: latestAttempt.date || Date.now()
    });

    await finalizeReservedLoyaltyRedemption({ order });
    await clearCartForCompletedOrder(order);

    await paymentAttemptModel.findByIdAndUpdate(latestAttempt._id, {
        status: 'order_created',
        createdOrderId: String(order._id),
        inventoryReserved: false,
        loyaltyRedemptionStatus:
            Number(latestAttempt.loyaltyPointsRedeemed || 0) > 0 ? 'redeemed' : latestAttempt.loyaltyRedemptionStatus,
        loyaltyRedemptionAppliedAt:
            Number(latestAttempt.loyaltyPointsRedeemed || 0) > 0 ? Date.now() : latestAttempt.loyaltyRedemptionAppliedAt,
        paymentVerifiedAt: Date.now(),
        gatewayEventId: gatewayEventId || latestAttempt.gatewayEventId || null,
        ...paymentFields
    });

    await publishAdminOrderUpsert({
        order,
        source: 'orderController.createOrderFromPaymentAttempt'
    });

    await sendOrderPlacedMessage(order);
    await attemptShiprocketOrderSync({
        order,
        log
    });

    return order;
};

const isClientOrderError = (error) =>
    isCheckoutError(error) || /insufficient stock/i.test(String(error?.message || ''));

const previewCheckoutPricing = async (req, res) => {
    try {
        const userId = req.userId;
        const { items, couponCode = '', pointsToRedeem = 0 } = req.body;
        const pricing = await calculateOrderDetails({ userId, items, couponCode, pointsToRedeem });

        return res.status(200).json({
            success: true,
            pricing: {
                subtotal: pricing.subtotal,
                deliveryFee: pricing.deliveryFee,
                couponDiscountAmount: pricing.couponDiscountAmount,
                loyaltyDiscountAmount: pricing.loyaltyDiscountAmount,
                discountAmount: pricing.discountAmount,
                total: pricing.amount,
                loyaltyPointsRedeemed: pricing.loyaltyPointsRedeemed,
                availableLoyaltyPoints: pricing.availableLoyaltyPoints,
                loyaltyRules: pricing.loyaltyRules,
                appliedCoupon: pricing.appliedCoupon
            }
        });
    } catch (error) {
        req.log?.warn({ err: error }, 'Checkout preview failed');
        return res.status(400).json({
            success: false,
            message: error.message || 'Unable to preview checkout pricing'
        });
    }
};

const placeOrderCOD = async (req, res) => {
    let idempotencyRecordId;
    let normalizedItems = [];
    let reservedInventory = false;
    let reservedLoyaltyPoints = 0;

    try {
        const userId = req.userId;
        const { items, address, checkoutSource = 'cart', couponCode = '', pointsToRedeem = 0 } = req.body;
        const idempotencyKey = getIdempotencyKey(req);

        if (!idempotencyKey) {
            return res.status(400).json({ success: false, message: 'Missing idempotency key header' });
        }

        const idempotencyResult = await beginIdempotentRequest({
            userId,
            scope: 'order:create:cod',
            key: idempotencyKey,
            payload: req.body
        });

        if (idempotencyResult.action === 'replay' || idempotencyResult.action === 'conflict' || idempotencyResult.action === 'in_progress') {
            return res.status(idempotencyResult.statusCode).json(idempotencyResult.body);
        }

        idempotencyRecordId = idempotencyResult.recordId;

        const pricing = await calculateOrderDetails({ userId, items, couponCode, pointsToRedeem });
        const customerEmail = await resolveCustomerEmail(userId);
        const shiprocketReferenceOrderId = generateShiprocketReferenceOrderId();
        normalizedItems = pricing.normalizedItems;
        if (Number(pricing.loyaltyPointsRedeemed || 0) > 0) {
            await reserveLoyaltyRedemption({
                userId,
                points: pricing.loyaltyPointsRedeemed
            });
            reservedLoyaltyPoints = Number(pricing.loyaltyPointsRedeemed || 0);
        }
        await reserveInventoryForItems(normalizedItems);
        reservedInventory = true;

        const newOrder = await orderModel.create(
            buildOrderData({
                userId,
                normalizedItems,
                pricing,
                address,
                customerEmail,
                checkoutSource,
                paymentMethod: 'COD',
                shiprocketReferenceOrderId
            })
        );

        await clearCartForCompletedOrder(newOrder);

        const responseBody = {
            success: true,
            message: 'Cash on delivery order placed successfully',
            orderId: newOrder._id
        };

        await publishAdminOrderUpsert({
            order: newOrder,
            source: 'orderController.placeOrderCOD'
        });

        await sendOrderPlacedMessage(newOrder, { log: req.log });
        await attemptShiprocketOrderSync({
            order: newOrder,
            log: req.log
        });

        await completeIdempotentRequest({
            recordId: idempotencyRecordId,
            statusCode: 201,
            body: responseBody
        });

        return res.status(201).json(responseBody);
    } catch (error) {
        if (reservedInventory) {
            await releaseInventoryForItems(normalizedItems);
        }
        if (reservedLoyaltyPoints > 0) {
            await releaseUserReservedLoyaltyPoints({
                userId: req.userId,
                points: reservedLoyaltyPoints
            });
        }

        req.log?.error({ err: error }, 'Failed to place COD order');

        const statusCode = isClientOrderError(error) ? 400 : 500;
        const responseBody = {
            success: false,
            message: isClientOrderError(error) ? error.message : 'Unable to place COD order'
        };
        await completeIdempotentRequest({
            recordId: idempotencyRecordId,
            statusCode,
            body: responseBody
        });

        return res.status(statusCode).json(responseBody);
    }
};

//Placing orders using COD Method
// const placeOrder = async (req, res) => {
//     try {
//         const { userId, items, amount, address } = req.body;
//         const orderData = {
//             userId,
//             items,
//             amount,
//             address,
//             paymentMethod: "COD",
//             payment: false,
//             date: Date.now(),
//         }
//         const newOrder = new orderModel(orderData);
//         await newOrder.save();
//         //empty the cart after placing order
//         await userModel.findByIdAndUpdate(userId, { cartData: {} });
//         res.json({ success: true, message: "Order Places" });
//     }
//     catch (error) {
//         console.log(error);
//         res.json({ success: false, message: error.message })
//     }

// }


//Placing orders using razorpay Method
const placeOrderRazorpay = async (req, res) => {
    let idempotencyRecordId;
    let normalizedItems = [];
    let reservedInventory = false;
    let createdPaymentAttemptId;
    let reservedLoyaltyPoints = 0;

    try{
        if (!isRazorpayConfigured()) {
            return res.status(503).json({ success: false, message: 'Razorpay is not configured on server' });
        }

        const userId = req.userId;
        const { items, address, checkoutSource = 'cart', couponCode = '', pointsToRedeem = 0 } = req.body;
        const idempotencyKey = getIdempotencyKey(req);

        if (!idempotencyKey) {
            return res.status(400).json({ success: false, message: 'Missing idempotency key header' });
        }

        const idempotencyResult = await beginIdempotentRequest({
            userId,
            scope: 'order:create:razorpay',
            key: idempotencyKey,
            payload: req.body
        });

        if (idempotencyResult.action === 'replay' || idempotencyResult.action === 'conflict' || idempotencyResult.action === 'in_progress') {
            return res.status(idempotencyResult.statusCode).json(idempotencyResult.body);
        }

        idempotencyRecordId = idempotencyResult.recordId;

        const pricing = await calculateOrderDetails({ userId, items, couponCode, pointsToRedeem });
        const customerEmail = await resolveCustomerEmail(userId);
        const shiprocketReferenceOrderId = generateShiprocketReferenceOrderId();
        normalizedItems = pricing.normalizedItems;
        const { amount } = pricing;

        if (amount <= 0) {
            throw createCheckoutError('Online payments require a payable order total greater than zero');
        }

        const paymentAttemptData = buildPaymentAttemptData({
            userId,
            normalizedItems,
            pricing,
            address,
            customerEmail,
            checkoutSource,
            paymentMethod: 'Razorpay',
            shiprocketReferenceOrderId
        });
        if (Number(pricing.loyaltyPointsRedeemed || 0) > 0) {
            await reserveLoyaltyRedemption({
                userId,
                points: pricing.loyaltyPointsRedeemed
            });
            reservedLoyaltyPoints = Number(pricing.loyaltyPointsRedeemed || 0);
        }

        await reserveInventoryForItems(normalizedItems);
        reservedInventory = true;

        const paymentAttempt = await paymentAttemptModel.create(paymentAttemptData);
        createdPaymentAttemptId = paymentAttempt._id;

        const order = await createRazorpayCheckoutOrder({
            amountInRupees: amount,
            receipt: paymentAttempt._id.toString(),
            notes: {
                paymentAttemptId: paymentAttempt._id.toString(),
                userId: String(userId || ''),
                checkoutSource,
                shiprocketReferenceOrderId
            }
        });

        await paymentAttemptModel.findByIdAndUpdate(paymentAttempt._id, {
            razorpayOrderId: order.id
        });

        const responseBody = {
            success: true,
            order: {
                id: order.id,
                amount: order.amount,
                currency: order.currency,
                receipt: order.receipt,
                status: order.status,
                paymentAttemptId: paymentAttempt._id.toString()
            }
        };

        await completeIdempotentRequest({
            recordId: idempotencyRecordId,
            statusCode: 200,
            body: responseBody
        });

        res.status(200).json(responseBody);
    }catch(error){
        if (reservedInventory) {
            await releaseInventoryForItems(normalizedItems);
        }

        if (reservedLoyaltyPoints > 0) {
            await releaseUserReservedLoyaltyPoints({
                userId: req.userId,
                points: reservedLoyaltyPoints
            });
        }

        if (createdPaymentAttemptId) {
            const paymentAttempt = await paymentAttemptModel.findById(createdPaymentAttemptId);

            if (paymentAttempt) {
                await markPaymentAttemptAsNotCompleted({
                    paymentAttempt,
                    status: 'failed'
                });
            }
        } else {
            if (reservedInventory) {
                await releaseInventoryForItems(normalizedItems);
            }

            if (reservedLoyaltyPoints > 0) {
                await releaseUserReservedLoyaltyPoints({
                    userId: req.userId,
                    points: reservedLoyaltyPoints
                });
            }
        }

        req.log?.error({ err: error }, 'Failed to create Razorpay order');

        const statusCode = isClientOrderError(error) ? 400 : 500;
        const responseBody = {
            success: false,
            message: isClientOrderError(error) ? error.message : 'Failed to place Razorpay order'
        };
        await completeIdempotentRequest({
            recordId: idempotencyRecordId,
            statusCode,
            body: responseBody
        });

        res.status(statusCode).json(responseBody);
    }
};

const verifyRazorpay = async(req,res) =>{
    try{
        const userId = req.userId;
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({success:false,message:'Missing Razorpay verification fields'});
        }

        if (!verifyRazorpayCheckoutSignature({
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            signature: razorpay_signature
        })) {
            return res.status(400).json({success:false,message:'Invalid Razorpay signature'});
        }

        const paymentAttempt = await paymentAttemptModel.findOne({
            razorpayOrderId: razorpay_order_id,
            userId,
            paymentMethod: 'Razorpay'
        });

        if (paymentAttempt) {
            if (paymentAttempt.status === 'order_created' && paymentAttempt.createdOrderId) {
                return res.status(200).json({success:true,message:'Payment already confirmed.'});
            }

            await createOrderFromPaymentAttempt({
                paymentAttempt,
                gatewayEventId: razorpay_payment_id,
                paymentFields: {
                    razorpayOrderId: razorpay_order_id,
                    razorpayPaymentId: razorpay_payment_id
                },
                log: req.log
            });

            return res.status(200).json({success:true,message:'Payment verified successfully.'});
        }

        const localOrder = await orderModel.findOne({ razorpayOrderId: razorpay_order_id });

        if (!localOrder || localOrder.userId !== userId) {
            return res.status(404).json({success:false,message:'Order not found'});
        }

        if (localOrder.payment) {
            return res.status(200).json({success:true,message:'Payment already confirmed via webhook.'});
        }

        await markOrderAsPaid({
            order: localOrder,
            gatewayEventId: razorpay_payment_id,
            paymentFields: {
                razorpayOrderId: razorpay_order_id,
                razorpayPaymentId: razorpay_payment_id
            },
            log: req.log
        });

        res.status(200).json({success:true,message:'Payment verified successfully.'});
    }
    catch(error){
        req.log?.error({ err: error }, 'Failed to verify Razorpay payment');
        res.status(500).json({success:false,message:'Failed to verify Razorpay payment'});
    }
};

const RAZORPAY_HANDLED_EVENTS = new Set([
    'payment.authorized',
    'payment.captured',
    'payment.failed',
    'order.paid',
    'refund.created',
    'refund.processed',
    'refund.failed'
]);

const buildRazorpayWebhookEventId = (event) => {
    const candidate =
        event?.id ||
        event?.payload?.payment?.entity?.id ||
        event?.payload?.order?.entity?.id ||
        event?.payload?.refund?.entity?.id;
    if (candidate) {
        const eventType = String(event?.event || 'event').trim();
        return `${eventType}:${candidate}`;
    }

    const fallback = crypto
        .createHash('sha256')
        .update(JSON.stringify(event || {}))
        .digest('hex');
    return `${String(event?.event || 'event')}:hash:${fallback}`;
};

const recomputeOrderRefundTotals = (order) => {
    const refunds = Array.isArray(order?.refunds) ? order.refunds : [];
    const processedAmount = refunds
        .filter((refund) => refund?.status === 'processed')
        .reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
    const hasPending = refunds.some((refund) => refund?.status === 'pending');
    const hasFailed = refunds.some((refund) => refund?.status === 'failed');
    const orderTotal = Number(order?.amount || 0);

    let refundStatus = 'none';
    if (processedAmount > 0 && processedAmount + 0.01 >= orderTotal) {
        refundStatus = 'processed';
    } else if (processedAmount > 0) {
        refundStatus = 'partial';
    } else if (hasPending) {
        refundStatus = 'pending';
    } else if (hasFailed) {
        refundStatus = 'failed';
    }

    return {
        refundedAmount: Math.round(processedAmount * 100) / 100,
        refundStatus,
        refundLastUpdatedAt: Date.now()
    };
};

const upsertOrderRefundRecord = async ({ order, refundEntity, initiatedBy = 'webhook' }) => {
    if (!order || !refundEntity?.id) {
        return order;
    }

    const refundId = String(refundEntity.id);
    const amountInRupees = Number(refundEntity.amount || 0) / 100;
    const status =
        refundEntity.status === 'processed'
            ? 'processed'
            : refundEntity.status === 'failed'
                ? 'failed'
                : 'pending';

    const existingRefund = (order.refunds || []).find((refund) => String(refund.refundId) === refundId);

    if (existingRefund) {
        existingRefund.status = status;
        existingRefund.amount = amountInRupees;
        existingRefund.speedProcessed = refundEntity.speed_processed || existingRefund.speedProcessed || '';
        existingRefund.speedRequested = refundEntity.speed_requested || existingRefund.speedRequested || existingRefund.speed;
        existingRefund.processedAt = status === 'processed' ? Date.now() : existingRefund.processedAt;
        existingRefund.failureReason =
            status === 'failed' ? String(refundEntity.notes?.failure_reason || 'Refund failed') : existingRefund.failureReason;
        existingRefund.rawResponse = refundEntity;
    } else {
        order.refunds = order.refunds || [];
        order.refunds.push({
            refundId,
            paymentId: String(refundEntity.payment_id || order.razorpayPaymentId || ''),
            amount: amountInRupees,
            currency: String(refundEntity.currency || 'INR'),
            status,
            speed: refundEntity.speed_requested === 'optimum' ? 'optimum' : 'normal',
            speedRequested: refundEntity.speed_requested || 'normal',
            speedProcessed: refundEntity.speed_processed || '',
            reason: String(refundEntity.notes?.reason || ''),
            notes: refundEntity.notes || {},
            initiatedBy,
            createdAt: Date.now(),
            processedAt: status === 'processed' ? Date.now() : null,
            failureReason: status === 'failed' ? String(refundEntity.notes?.failure_reason || 'Refund failed') : '',
            rawResponse: refundEntity
        });
    }

    Object.assign(order, recomputeOrderRefundTotals(order));
    await order.save();

    await publishAdminOrderUpsert({
        order,
        source: 'orderController.upsertOrderRefundRecord'
    });

    return order;
};

const handleRazorpayPaymentAuthorized = async ({ event, paymentEntity, log }) => {
    const razorpayOrderId = paymentEntity?.order_id;
    if (!razorpayOrderId) return;
    const order = await orderModel.findOne({ razorpayOrderId });
    if (!order || order.payment) return;
    await orderModel.findByIdAndUpdate(order._id, {
        paymentAuthorizedAt: Date.now(),
        razorpayPaymentId: paymentEntity?.id || order.razorpayPaymentId,
        gatewayEventId: paymentEntity?.id || order.gatewayEventId
    });
    log?.info({ razorpayOrderId, paymentId: paymentEntity?.id }, 'Razorpay payment authorized');
};

const handleRazorpayPaymentCaptured = async ({ event, paymentEntity, log }) => {
    const razorpayOrderId = paymentEntity?.order_id;
    if (!razorpayOrderId) return;

    const paymentAttempt = await paymentAttemptModel.findOne({
        razorpayOrderId,
        paymentMethod: 'Razorpay'
    });
    const order = paymentAttempt ? null : await orderModel.findOne({ razorpayOrderId });

    if (paymentAttempt) {
        await createOrderFromPaymentAttempt({
            paymentAttempt,
            gatewayEventId: paymentEntity?.id,
            paymentFields: {
                razorpayOrderId,
                razorpayPaymentId: paymentEntity?.id || null,
                paymentCapturedAt: Date.now()
            },
            log
        });
        return;
    }

    if (order) {
        await markOrderAsPaid({
            order,
            gatewayEventId: paymentEntity?.id,
            paymentFields: {
                razorpayOrderId,
                razorpayPaymentId: paymentEntity?.id || null,
                paymentCapturedAt: Date.now()
            },
            log
        });
    }
};

const handleRazorpayPaymentFailed = async ({ event, paymentEntity, log }) => {
    const razorpayOrderId = paymentEntity?.order_id;
    if (!razorpayOrderId) return;

    const paymentAttempt = await paymentAttemptModel.findOne({
        razorpayOrderId,
        paymentMethod: 'Razorpay'
    });
    const order = paymentAttempt ? null : await orderModel.findOne({ razorpayOrderId });

    if (paymentAttempt) {
        await markPaymentAttemptAsNotCompleted({
            paymentAttempt,
            status: 'failed',
            gatewayEventId: paymentEntity?.id,
            paymentFields: {
                razorpayOrderId,
                razorpayPaymentId: paymentEntity?.id || null
            }
        });
        return;
    }

    if (order) {
        await markOrderAsFailed({
            order,
            gatewayEventId: paymentEntity?.id,
            paymentFields: {
                razorpayOrderId,
                razorpayPaymentId: paymentEntity?.id || null
            }
        });
    }
};

const handleRazorpayRefundEvent = async ({ event, refundEntity, log }) => {
    if (!refundEntity?.id) return;
    try {
        // Delegate to the new refund subsystem (Phase 4 cutover).
        // The new service is the single writer for refund state and ledger;
        // it also runs the projector that updates `order.refunds[]`,
        // `order.refundedAmount`, and `order.refundStatus` for the admin UI.
        const { processWebhookUpdate } = await import('../services/refundService.js');
        await processWebhookUpdate({ event, refundEntity, log });
    } catch (error) {
        log?.error(
            { err: error, refundId: refundEntity.id, eventName: event },
            'Refund webhook processing failed'
        );
        // Swallow — webhook handler relies on this being non-throwing so
        // the outer ack flow can still respond 200 to Razorpay.
    }
};

const handleRazorpayWebhook = async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];

    if (!signature) {
        return res.status(400).send('Missing Razorpay signature');
    }

    if (!isRazorpayWebhookConfigured()) {
        return res.status(503).send('Razorpay webhook is not configured');
    }

    const rawBody = req.body;

    if (!verifyRazorpayWebhookSignature({ rawBody, signature })) {
        return res.status(400).send('Invalid webhook signature');
    }

    let event;
    try {
        event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
    } catch (parseError) {
        req.log?.warn({ err: parseError }, 'Failed to parse Razorpay webhook body');
        return res.status(400).send('Invalid Razorpay webhook payload');
    }

    const parsedEvent = razorpayWebhookEventSchema.safeParse(event);
    if (!parsedEvent.success) {
        req.log?.warn({ issues: parsedEvent.error?.issues }, 'Razorpay webhook payload failed schema validation');
        return res.status(400).send('Invalid Razorpay webhook payload');
    }

    const eventType = String(event.event || '').trim();
    const eventId = buildRazorpayWebhookEventId(event);
    const paymentEntity = event?.payload?.payment?.entity;
    const refundEntity = event?.payload?.refund?.entity;
    const orderEntity = event?.payload?.order?.entity;
    const razorpayOrderId =
        paymentEntity?.order_id || orderEntity?.id || '';

    let webhookEventRecord;
    try {
        webhookEventRecord = await razorpayWebhookEventModel.create({
            eventId,
            eventType,
            signature: String(signature).slice(0, 256),
            razorpayOrderId,
            razorpayPaymentId: String(paymentEntity?.id || refundEntity?.payment_id || ''),
            razorpayRefundId: String(refundEntity?.id || ''),
            payload: event,
            attempts: 1
        });
    } catch (error) {
        if (error?.code === 11000) {
            req.log?.info({ eventId, eventType }, 'Razorpay webhook duplicate; ignoring');
            return res.status(200).json({ received: true, duplicate: true });
        }

        req.log?.error({ err: error, eventId }, 'Failed to persist Razorpay webhook event');
        return res.status(500).send('Webhook persistence failed');
    }

    if (!RAZORPAY_HANDLED_EVENTS.has(eventType)) {
        await razorpayWebhookEventModel.findByIdAndUpdate(webhookEventRecord._id, {
            processed: true,
            processedAt: Date.now()
        });
        return res.status(200).json({ received: true, ignored: true });
    }

    try {
        if (eventType === 'payment.authorized') {
            await handleRazorpayPaymentAuthorized({ event, paymentEntity, log: req.log });
        } else if (eventType === 'payment.captured' || eventType === 'order.paid') {
            await handleRazorpayPaymentCaptured({ event, paymentEntity, log: req.log });
        } else if (eventType === 'payment.failed') {
            await handleRazorpayPaymentFailed({ event, paymentEntity, log: req.log });
        } else if (eventType === 'refund.created' || eventType === 'refund.processed' || eventType === 'refund.failed') {
            await handleRazorpayRefundEvent({ event, refundEntity, log: req.log });
        }

        await razorpayWebhookEventModel.findByIdAndUpdate(webhookEventRecord._id, {
            processed: true,
            processedAt: Date.now()
        });

        return res.status(200).json({ received: true });
    } catch (error) {
        req.log?.error({ err: error, eventId, eventType }, 'Razorpay webhook processing failed');
        await razorpayWebhookEventModel.findByIdAndUpdate(webhookEventRecord._id, {
            processed: false,
            lastError: String(error?.message || 'Webhook processing failed').slice(0, 500),
            $inc: { attempts: 1 }
        });
        return res.status(500).send('Webhook processing failed');
    }
};

const cancelRazorpayPaymentAttempt = async (req, res) => {
    try {
        const userId = req.userId;
        const { attemptId } = req.params;

        const paymentAttempt = await paymentAttemptModel.findById(attemptId);

        if (!paymentAttempt || String(paymentAttempt.userId) !== String(userId)) {
            return res.status(404).json({ success: false, message: 'Payment attempt not found' });
        }

        if (paymentAttempt.status === 'order_created') {
            return res.status(409).json({ success: false, message: 'Payment already completed for this attempt' });
        }

        if (paymentAttempt.status === 'cancelled') {
            return res.status(200).json({ success: true, message: 'Payment attempt already cancelled' });
        }

        await markPaymentAttemptAsNotCompleted({
            paymentAttempt,
            status: 'cancelled'
        });

        return res.status(200).json({ success: true, message: 'Payment attempt cancelled and reservation released' });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to cancel Razorpay payment attempt');
        return res.status(500).json({ success: false, message: 'Failed to cancel payment attempt' });
    }
};

const refundOrder = async (req, res) => {
    // SHIM: legacy `POST /api/order/:orderId/refund` route. Translates the
    // legacy DTO (`{ amount, reason, speed, notes }` in rupees) into the
    // new refund service contract (paise + idempotency + RBAC) so existing
    // admin UI keeps working without a frontend change.
    //
    // Source of truth from Phase 4 onwards is `services/refundService.js`.
    try {
        const { initiateRefund } = await import('../services/refundService.js');
        const { paiseFromOrderRupees } = await import('../utils/paise.util.js');
        const { buildLegacyIdempotencyKey } = await import('./refundController.js');

        const { orderId } = req.params;
        const { amount, reason = '', notes = {} } = req.body || {};

        const order = await orderModel.findById(orderId).lean();
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Default to refunding the full remaining refundable amount when the
        // legacy caller does not specify one.
        const remainingRupees =
            Number(order.amount || 0) - Number(order.refundedAmount || 0);
        const refundRupees =
            amount === undefined || amount === null || amount === ''
                ? Math.max(0, Math.round(remainingRupees * 100) / 100)
                : Number(amount);

        if (!Number.isFinite(refundRupees) || refundRupees <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Refund amount must be a positive number'
            });
        }

        let amountInPaise;
        try {
            amountInPaise = paiseFromOrderRupees(refundRupees);
        } catch (conversionError) {
            return res.status(400).json({
                success: false,
                message: conversionError.message || 'Refund amount has invalid precision'
            });
        }

        const idempotencyKey =
            getIdempotencyKey(req) ||
            buildLegacyIdempotencyKey({
                orderId,
                amountInPaise,
                adminId: req.admin?.id
            });

        const reasonValue =
            typeof reason === 'string' && reason.trim() ? reason.trim() : 'customer_request';
        const allowedReasons = new Set([
            'customer_request',
            'duplicate_payment',
            'fraud',
            'order_cancelled',
            'item_unavailable',
            'damaged_in_transit',
            'wrong_item',
            'quality_issue',
            'admin_adjustment',
            'other'
        ]);
        const safeReason = allowedReasons.has(reasonValue) ? reasonValue : 'other';

        const { refund, order: orderAfter, replayed } = await initiateRefund({
            orderId,
            amountInPaise,
            reason: safeReason,
            notes:
                typeof notes === 'string'
                    ? notes
                    : (notes && typeof notes === 'object' ? JSON.stringify(notes).slice(0, 500) : ''),
            idempotencyKey,
            admin: {
                id: req.admin?.id,
                email: req.admin?.email,
                role: req.admin?.role
            },
            log: req.log
        });

        return res.status(replayed ? 200 : 200).json({
            success: true,
            message: replayed
                ? 'Refund already processed (idempotent replay)'
                : 'Refund initiated successfully',
            refund: {
                id: refund.gatewayRefundId || String(refund._id),
                amount: refund.amountInPaise / 100,
                status: refund.state,
                speed: 'normal'
            },
            order: orderAfter
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Refund (legacy shim) failed');
        const status =
            error?.statusCode && Number.isFinite(error.statusCode) ? error.statusCode : 500;
        return res.status(status).json({
            success: false,
            message: error?.message || 'Failed to issue refund',
            code: error?.code || undefined
        });
    }
};

const getRazorpayPaymentDetails = async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await orderModel.findById(orderId).lean();

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (order.paymentMethod !== 'Razorpay' || !order.razorpayPaymentId) {
            return res.status(200).json({ success: true, order, payment: null, refunds: order?.refunds || [] });
        }

        const payment = await fetchRazorpayPayment(order.razorpayPaymentId).catch((error) => {
            req.log?.warn({ err: error }, 'Failed to fetch Razorpay payment details');
            return null;
        });

        return res.status(200).json({
            success: true,
            order,
            payment,
            refunds: order?.refunds || []
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to load Razorpay payment details');
        return res.status(500).json({ success: false, message: 'Failed to load payment details' });
    }
};

const testShiprocketConnection = async (req, res) => {
    try {
        if (!isShiprocketEnabled()) {
            return res.status(503).json({
                success: false,
                message: 'Shiprocket integration is disabled'
            });
        }

        if (!isShiprocketConfigured()) {
            return res.status(503).json({
                success: false,
                message: 'Shiprocket integration is not fully configured'
            });
        }

        const token = await getValidToken();
        const pickupStatus = await getPickupAddressStatus({ log: req.log }).catch(() => null);
        const configuredPickupLocation = getShiprocketConfig().pickupLocation;

        return res.status(200).json({
            success: true,
            message: 'Shiprocket token is valid',
            tokenPresent: Boolean(token),
            pickupAddressConfigured: pickupStatus?.ready ?? null,
            configuredPickupLocation,
            recentPickupAddressCount: pickupStatus?.recentAddresses?.length ?? null
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Shiprocket integration test failed');
        return res.status(error?.statusCode || 500).json({
            success: false,
            message: error?.message || 'Shiprocket integration test failed'
        });
    }
};

const retryShiprocketSync = async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await orderModel.findById(orderId);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const syncResult = await attemptShiprocketOrderSync({
            order,
            log: req.log,
            force: true,
            throwOnFailure: true
        });
        const refreshedOrder = await orderModel.findById(orderId);

        return res.status(200).json({
            success: true,
            message: 'Shiprocket sync completed',
            syncResult,
            order: decorateOrderWithShiprocketPricingAudit(refreshedOrder)
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Manual Shiprocket sync retry failed');
        return res.status(error?.statusCode || 500).json({
            success: false,
            message: error?.message || 'Failed to retry Shiprocket sync'
        });
    }
};

const getShiprocketOrderDetails = async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await orderModel.findById(orderId);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (!order?.shiprocket?.orderId) {
            return res.status(200).json({
                success: true,
                message: 'Order has not been synced to Shiprocket yet',
                order: decorateOrderWithShiprocketPricingAudit(order)
            });
        }

        const shiprocketOrder = await getShiprocketOrder(order.shiprocket.orderId, {
            log: req.log
        });

        return res.status(200).json({
            success: true,
            order: decorateOrderWithShiprocketPricingAudit(order),
            shiprocketOrder
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch Shiprocket order details');
        return res.status(error?.statusCode || 500).json({
            success: false,
            message: error?.message || 'Failed to fetch Shiprocket order details'
        });
    }
};

const trackShiprocketOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await orderModel.findById(orderId);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const result = await refreshOrderTracking(order, {
            log: req.log
        });

        return res.status(200).json({
            success: true,
            order: decorateOrderWithShiprocketPricingAudit(result.order),
            tracking: result.tracking
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to refresh Shiprocket order tracking');
        return res.status(error?.statusCode || 500).json({
            success: false,
            message: error?.message || 'Failed to refresh Shiprocket order tracking'
        });
    }
};

const buildMissingShiprocketPricingSnapshotQuery = () => ({
    'shiprocket.syncStatus': SHIPROCKET_SYNC_STATUS.synced,
    $or: [
        { 'shiprocket.pricingSnapshot': { $exists: false } },
        { 'shiprocket.pricingSnapshot': null }
    ]
});

const backfillShiprocketPricingSnapshots = async (req, res) => {
    try {
        const requestedLimit = Number(req.body?.limit || DEFAULT_SHIPROCKET_SNAPSHOT_BACKFILL_LIMIT);
        const limit = Math.min(
            MAX_SHIPROCKET_SNAPSHOT_BACKFILL_LIMIT,
            Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : DEFAULT_SHIPROCKET_SNAPSHOT_BACKFILL_LIMIT)
        );
        const dryRun = req.body?.dryRun === true;
        const query = buildMissingShiprocketPricingSnapshotQuery();
        const matchedCount = await orderModel.countDocuments(query);
        const targetOrders = await orderModel.find(query).sort({ date: -1 }).limit(limit).lean();

        if (dryRun) {
            return res.status(200).json({
                success: true,
                dryRun: true,
                matchedCount,
                processedCount: targetOrders.length,
                remainingCount: Math.max(0, matchedCount - targetOrders.length),
                sampleOrders: targetOrders.slice(0, 10).map((order) => ({
                    _id: String(order._id || ''),
                    referenceOrderId: order?.shiprocket?.referenceOrderId || '',
                    amount: Number(order.amount || 0),
                    syncStatus: order?.shiprocket?.syncStatus || ''
                }))
            });
        }

        if (targetOrders.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No Shiprocket pricing snapshots needed backfill',
                matchedCount,
                processedCount: 0,
                updatedCount: 0,
                remainingCount: 0
            });
        }

        const capturedAt = Date.now();
        const bulkOperations = targetOrders.map((order) => ({
            updateOne: {
                filter: { _id: order._id },
                update: {
                    $set: {
                        'shiprocket.pricingSnapshot': buildShiprocketPricingSnapshot(order, {
                            capturedAt,
                            source: 'shiprocket_backfill_v2'
                        })
                    }
                }
            }
        }));

        const bulkResult = await orderModel.bulkWrite(bulkOperations, { ordered: false });
        const updatedCount = Number(bulkResult?.modifiedCount || bulkResult?.matchedCount || 0);

        return res.status(200).json({
            success: true,
            message: 'Shiprocket pricing snapshot backfill completed',
            matchedCount,
            processedCount: targetOrders.length,
            updatedCount,
            remainingCount: Math.max(0, matchedCount - targetOrders.length),
            updatedOrderIds: targetOrders.slice(0, 20).map((order) => String(order._id || ''))
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to backfill Shiprocket pricing snapshots');
        return res.status(500).json({
            success: false,
            message: error?.message || 'Failed to backfill Shiprocket pricing snapshots'
        });
    }
};

const verifyShiprocketPricingLive = async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await orderModel.findById(orderId);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const verification = await verifyOrderPricingAgainstLiveShiprocket(order, {
            log: req.log,
            persist: true
        });
        const refreshedOrder = await orderModel.findById(orderId);

        await publishAdminOrderUpsert({
            order: refreshedOrder,
            source: 'orderController.verifyShiprocketPricingLive'
        });

        return res.status(200).json({
            success: true,
            message:
                verification.status === 'clear'
                    ? 'Live Shiprocket pricing matches the expected payload'
                    : 'Live Shiprocket pricing requires review',
            order: decorateOrderWithShiprocketPricingAudit(refreshedOrder),
            verification
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to verify live Shiprocket pricing');
        return res.status(error?.statusCode || 500).json({
            success: false,
            message: error?.message || 'Failed to verify live Shiprocket pricing'
        });
    }
};

const startShiprocketBulkLiveVerification = async (req, res) => {
    try {
        const requestedBy = normalizeEmail(req.admin?.email || process.env.ADMIN_EMAIL || 'admin');
        const result = await startShiprocketBulkLiveVerificationJob({
            config: {
                limit: req.body?.limit,
                requestsPerMinute: req.body?.requestsPerMinute,
                scope: req.body?.scope
            },
            requestedBy,
            trigger: 'admin_api',
            log: req.log
        });

        return res.status(200).json({
            success: true,
            message: result.started
                ? 'Shiprocket bulk live verification started'
                : result.reason === 'no_target_orders'
                  ? 'No eligible Shiprocket orders need live verification right now'
                  : 'A Shiprocket bulk live verification run is already in progress',
            started: result.started,
            skipped: result.skipped,
            config: result.config,
            targetCount: result.targetCount || 0,
            job: result.job
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to start Shiprocket bulk live verification');
        return res.status(error?.statusCode || 500).json({
            success: false,
            message: error?.message || 'Failed to start Shiprocket bulk live verification'
        });
    }
};

const getShiprocketBulkLiveVerificationJob = async (req, res) => {
    try {
        const job = await getShiprocketBulkVerifyJobStatus();

        return res.status(200).json({
            success: true,
            job
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to load Shiprocket bulk live verification status');
        return res.status(500).json({
            success: false,
            message: error?.message || 'Failed to load Shiprocket bulk live verification status'
        });
    }
};

const cancelShiprocketBulkLiveVerification = async (req, res) => {
    try {
        const requestedBy = normalizeEmail(req.admin?.email || process.env.ADMIN_EMAIL || 'admin');
        const result = await cancelShiprocketBulkLiveVerificationJob({
            requestedBy,
            reason: req.body?.reason || 'admin_request'
        });

        return res.status(200).json({
            success: true,
            message:
                result.reason === 'cancel_requested'
                    ? 'Shiprocket bulk live verification cancellation has been requested'
                    : result.reason === 'stale_job_cancelled'
                      ? 'The stale Shiprocket bulk verification run was cancelled'
                      : result.reason === 'cancel_already_requested'
                        ? 'Cancellation was already requested for the active Shiprocket run'
                        : 'No active Shiprocket bulk verification run is currently running',
            cancelled: result.cancelled,
            reason: result.reason,
            job: result.job
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to cancel Shiprocket bulk live verification');
        return res.status(error?.statusCode || 500).json({
            success: false,
            message: error?.message || 'Failed to cancel Shiprocket bulk live verification'
        });
    }
};


//All Orders data for Admin panel
const allOrders = async (req, res) => {
    try {
        const orders = await orderModel
            .find({
                $or: [
                    { paymentMethod: 'COD' },
                    { payment: true }
                ]
            })
            .sort({ date: -1 });
        res.status(200).json({
            success: true,
            orders: orders.map((order) => decorateOrderWithShiprocketPricingAudit(order)).filter(Boolean)
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch all orders');
        res.status(500).json({ success: false, message: 'Failed to fetch orders' });
    }
};


//User Order data for Frontend
const userOrders = async (req, res) => {
    try {
        const userId = req.userId;
        const orders = await orderModel.find({
            userId,
            $or: [
                { payment: true },
                { paymentMethod: 'COD' }
            ]
        }).sort({ date: -1 });
        res.status(200).json({ success: true, orders });

    }
    catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch user orders');
        res.status(500).json({ success: false, message: 'Failed to fetch user orders' })
    }
};

const cancelUserOrder = async (req, res) => {
    try {
        const userId = req.userId;
        const { orderId } = req.params;
        const existingOrder = await orderModel.findById(orderId);

        if (!existingOrder || String(existingOrder.userId) !== String(userId)) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (normalizeOrderStatus(existingOrder.status) === normalizeOrderStatus(ORDER_STATUS.cancelled)) {
            return res.status(200).json({
                success: true,
                message: 'Order cancelled successfully',
                order: existingOrder
            });
        }

        if (normalizeOrderStatus(existingOrder.status) !== normalizeOrderStatus(ORDER_STATUS.placed)) {
            return res.status(400).json({
                success: false,
                message: 'Only orders that are still in Order placed status can be cancelled.'
            });
        }

        if (!isOrderWithinCancellationWindow(existingOrder)) {
            return res.status(400).json({
                success: false,
                message: 'Order can only be cancelled within 6 hours of placing it.'
            });
        }

        const updatedOrder = await performOrderCancellation({
            existingOrder,
            source: 'orderController.cancelUserOrder'
        });

        return res.status(200).json({
            success: true,
            message: 'Order cancelled successfully',
            order: updatedOrder
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to cancel user order');
        return res.status(500).json({ success: false, message: 'Failed to cancel order. Please try again.' });
    }
};

//update order status by Admin Panel
const updateOrderStatus = async (req, res) => {
    try {
        const { orderId, status } = req.body;
        const existingOrder = await orderModel.findById(orderId);

        if (!existingOrder) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }
        const { updatedOrder } = await applyOrderStatusTransition({
            existingOrder,
            status,
            source: 'orderController.updateOrderStatus',
            log: req.log
        });

        res.status(200).json({
            success: true,
            message: 'Status Updated',
            order: decorateOrderWithShiprocketPricingAudit(updatedOrder)
        });
    } catch (error) {
        if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }

        req.log?.error({ err: error }, 'Failed to update order status');
        res.status(500).json({ success: false, message: 'Failed to update order status' });
    }
};

export {
    allOrders,
    backfillShiprocketPricingSnapshots,
    cancelRazorpayPaymentAttempt,
    cancelShiprocketBulkLiveVerification,
    cancelUserOrder,
    getRazorpayPaymentDetails,
    getShiprocketBulkLiveVerificationJob,
    handleRazorpayWebhook,
    getShiprocketOrderDetails,
    placeOrderCOD,
    placeOrderRazorpay,
    previewCheckoutPricing,
    refundOrder,
    retryShiprocketSync,
    startShiprocketBulkLiveVerification,
    testShiprocketConnection,
    trackShiprocketOrder,
    updateOrderStatus,
    userOrders,
    verifyShiprocketPricingLive,
    verifyRazorpay
}
