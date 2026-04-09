import orderModel from '../models/orderModel.js';
import paymentAttemptModel from '../models/paymentAttemptModel.js';
import userModel from '../models/userModel.js';
import { razorpayWebhookEventSchema, stripeWebhookEventSchema } from '../validation/schemas.js';
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
    awardOrderDeliveryRewards,
    finalizeReservedLoyaltyRedemption,
    releaseReservedLoyaltyRedemption,
    releaseUserReservedLoyaltyPoints,
    reserveLoyaltyRedemption
} from '../services/loyaltyService.js';
import { queueAutomationEmail } from '../services/marketingAutomationService.js';
import Stripe from 'stripe';
import razorpay from 'razorpay';
import crypto from 'crypto';

//global variables
const currency = 'inr';
const deliveryCharge = DEFAULT_DELIVERY_CHARGE;

let stripeClient;
let razorpayClient;

const getStripeClient = () => {
    if (!process.env.STRIPE_SECRET_KEY) {
        return null;
    }

    if (!stripeClient) {
        stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
    }

    return stripeClient;
};

const getRazorpayClient = () => {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        return null;
    }

    if (!razorpayClient) {
        razorpayClient = new razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
        });
    }

    return razorpayClient;
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

const markOrderAsPaid = async ({ order, gatewayEventId, paymentFields }) => {
    if (!order || order.payment) {
        return order;
    }

    const updatedOrder = await orderModel.findByIdAndUpdate(
        order._id,
        {
            payment: true,
            paymentStatus: 'paid',
            paymentVerifiedAt: Date.now(),
            inventoryReserved: true,
            gatewayEventId: gatewayEventId || order.gatewayEventId,
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

const secureCompare = (a, b) => {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');

    if (left.length !== right.length) {
        return false;
    }

    return crypto.timingSafeEqual(left, right);
};

const resolveStripeOrder = async (session) => {
    const orderId = String(session?.client_reference_id || session?.metadata?.orderId || '');

    if (!isValidObjectId(orderId)) {
        return null;
    }

    const order = await orderModel.findById(orderId);
    if (!order) {
        return null;
    }

    const metadataOrderId = String(session?.metadata?.orderId || '');
    const clientReferenceId = String(session?.client_reference_id || '');
    const metadataUserId = String(session?.metadata?.userId || '');

    if (metadataOrderId && metadataOrderId !== String(order._id)) {
        return null;
    }

    if (clientReferenceId && clientReferenceId !== String(order._id)) {
        return null;
    }

    if (metadataUserId && metadataUserId !== String(order.userId)) {
        return null;
    }

    return order;
};

const resolveStripePaymentAttempt = async (session) => {
    const paymentAttemptId = String(
        session?.metadata?.paymentAttemptId || session?.metadata?.orderId || session?.client_reference_id || ''
    );

    if (!isValidObjectId(paymentAttemptId)) {
        return null;
    }

    const paymentAttempt = await paymentAttemptModel.findById(paymentAttemptId);
    if (!paymentAttempt) {
        return null;
    }

    const metadataAttemptId = String(session?.metadata?.paymentAttemptId || session?.metadata?.orderId || '');
    const clientReferenceId = String(session?.client_reference_id || '');
    const metadataUserId = String(session?.metadata?.userId || '');

    if (metadataAttemptId && metadataAttemptId !== String(paymentAttempt._id)) {
        return null;
    }

    if (clientReferenceId && clientReferenceId !== String(paymentAttempt._id)) {
        return null;
    }

    if (metadataUserId && metadataUserId !== String(paymentAttempt.userId)) {
        return null;
    }

    return paymentAttempt;
};

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

const buildOrderData = ({ userId, normalizedItems, pricing, address, checkoutSource, paymentMethod }) => ({
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
    checkoutSource,
    inventoryReserved: true,
    paymentMethod,
    payment: false,
    paymentStatus: 'pending',
    loyaltyPointsRedeemed: pricing.loyaltyPointsRedeemed || 0,
    loyaltyRedemptionStatus: Number(pricing.loyaltyPointsRedeemed || 0) > 0 ? 'reserved' : 'none',
    date: Date.now()
});

const buildPaymentAttemptData = ({ userId, normalizedItems, pricing, address, checkoutSource, paymentMethod }) => ({
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
    checkoutSource,
    paymentMethod,
    inventoryReserved: true,
    loyaltyPointsRedeemed: pricing.loyaltyPointsRedeemed || 0,
    loyaltyRedemptionStatus: Number(pricing.loyaltyPointsRedeemed || 0) > 0 ? 'reserved' : 'none',
    status: 'pending',
    date: Date.now()
});

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

const createOrderFromPaymentAttempt = async ({ paymentAttempt, gatewayEventId, paymentFields = {} }) => {
    if (!paymentAttempt) {
        return null;
    }

    const latestAttempt = await paymentAttemptModel.findById(paymentAttempt._id);
    if (!latestAttempt) {
        return null;
    }

    if (latestAttempt.createdOrderId) {
        return orderModel.findById(latestAttempt.createdOrderId);
    }

    if (!latestAttempt.inventoryReserved) {
        throw new Error('Payment attempt resources are no longer reserved');
    }

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
        address: latestAttempt.address,
        checkoutSource: latestAttempt.checkoutSource,
        inventoryReserved: true,
        paymentMethod: latestAttempt.paymentMethod,
        payment: true,
        paymentStatus: 'paid',
        paymentVerifiedAt: Date.now(),
        stripeSessionId: paymentFields.stripeSessionId || latestAttempt.stripeSessionId || null,
        stripePaymentIntentId: paymentFields.stripePaymentIntentId || latestAttempt.stripePaymentIntentId || null,
        razorpayOrderId: paymentFields.razorpayOrderId || latestAttempt.razorpayOrderId || null,
        razorpayPaymentId: paymentFields.razorpayPaymentId || latestAttempt.razorpayPaymentId || null,
        gatewayEventId: gatewayEventId || latestAttempt.gatewayEventId || null,
        loyaltyPointsRedeemed: latestAttempt.loyaltyPointsRedeemed || 0,
        loyaltyRedemptionStatus: Number(latestAttempt.loyaltyPointsRedeemed || 0) > 0 ? 'reserved' : 'none',
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

    return order;
};

const buildStripeLineItems = ({ normalizedItems, pricing }) => {
    if (pricing.discountAmount > 0) {
        return [
            {
                price_data: {
                    currency,
                    product_data: {
                        name: pricing.appliedCoupon?.code
                            ? `Lavish Fashion order total (${pricing.appliedCoupon.code})`
                            : 'Lavish Fashion order total'
                    },
                    unit_amount: Math.round(Number(pricing.amount) * 100)
                },
                quantity: 1
            }
        ];
    }

    const lineItems = normalizedItems.map((item) => ({
        price_data: {
            currency,
            product_data: {
                name: `${item.name}${item.size ? ` (${item.size})` : ''}`
            },
            unit_amount: Math.round(Number(item.price) * 100)
        },
        quantity: item.quantity
    }));

    if (pricing.deliveryFee > 0) {
        lineItems.push({
            price_data: {
                currency,
                product_data: {
                    name: 'Delivery Charges'
                },
                unit_amount: Math.round(Number(pricing.deliveryFee) * 100)
            },
            quantity: 1
        });
    }

    return lineItems;
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
                checkoutSource,
                paymentMethod: 'COD'
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


//Placing orders using Stripe Method
const placeOrderStripe = async (req, res) => {
    let idempotencyRecordId;
    let normalizedItems = [];
    let reservedInventory = false;
    let createdPaymentAttemptId;
    let reservedLoyaltyPoints = 0;

    try {
        const stripe = getStripeClient();
        if (!stripe) {
            return res.status(503).json({ success: false, message: 'Stripe is not configured on server' });
        }

        const userId = req.userId;
        const { items, address, checkoutSource = 'cart', couponCode = '', pointsToRedeem = 0 } = req.body;
        const idempotencyKey = getIdempotencyKey(req);

        if (!idempotencyKey) {
            return res.status(400).json({ success: false, message: 'Missing idempotency key header' });
        }

        const idempotencyResult = await beginIdempotentRequest({
            userId,
            scope: 'order:create:stripe',
            key: idempotencyKey,
            payload: req.body
        });

        if (idempotencyResult.action === 'replay' || idempotencyResult.action === 'conflict' || idempotencyResult.action === 'in_progress') {
            return res.status(idempotencyResult.statusCode).json(idempotencyResult.body);
        }

        idempotencyRecordId = idempotencyResult.recordId;

        const pricing = await calculateOrderDetails({ userId, items, couponCode, pointsToRedeem });
        normalizedItems = pricing.normalizedItems;
        const { amount } = pricing;
        const clientBaseUrl = String(process.env.CLIENT_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');

        if (!clientBaseUrl) {
            const responseBody = { success: false, message: 'Client URL is not configured' };
            await completeIdempotentRequest({
                recordId: idempotencyRecordId,
                statusCode: 500,
                body: responseBody
            });

            return res.status(500).json(responseBody);
        }

        if (amount <= 0) {
            throw createCheckoutError('Online payments require a payable order total greater than zero');
        }

        const paymentAttemptData = buildPaymentAttemptData({
            userId,
            normalizedItems,
            pricing,
            address,
            checkoutSource,
            paymentMethod: 'Stripe'
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

        const line_items = buildStripeLineItems({ normalizedItems, pricing });

        const session = await stripe.checkout.sessions.create({
            success_url: `${clientBaseUrl}/verify?orderId=${paymentAttempt._id}&session_id={CHECKOUT_SESSION_ID}&checkoutSource=${checkoutSource}`,
            cancel_url: `${clientBaseUrl}/verify?success=false&orderId=${paymentAttempt._id}&checkoutSource=${checkoutSource}`,
            line_items,
            mode: 'payment',
            client_reference_id: String(paymentAttempt._id),
            metadata: {
                orderId: String(paymentAttempt._id),
                paymentAttemptId: String(paymentAttempt._id),
                userId: String(userId),
                couponCode: pricing.appliedCoupon?.code || ''
            }
        })

        await paymentAttemptModel.findByIdAndUpdate(paymentAttempt._id, {
            stripeSessionId: session.id
        });

        const responseBody = { success: true, session };

        await completeIdempotentRequest({
            recordId: idempotencyRecordId,
            statusCode: 200,
            body: responseBody
        });

        res.status(200).json(responseBody);
        
    }
    catch (error) {
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

        req.log?.error({ err: error }, 'Failed to create Stripe order');

        const statusCode = isClientOrderError(error) ? 400 : 500;
        const responseBody = {
            success: false,
            message: isClientOrderError(error) ? error.message : 'Unable to create Stripe session'
        };
        await completeIdempotentRequest({
            recordId: idempotencyRecordId,
            statusCode,
            body: responseBody
        });

        res.status(statusCode).json(responseBody);
    }
};

//verify Stripe
const verifyStripe = async (req, res) => {
    const { orderId, success, session_id } = req.body;
    const userId = req.userId;

    try {
        const stripe = getStripeClient();
        if (!stripe) {
            return res.status(503).json({ success: false, message: 'Stripe is not configured on server' });
        }

        if (!isValidObjectId(orderId)) {
            return res.status(400).json({ success: false, message: 'Invalid order id' });
        }

        const existingOrder = await orderModel.findById(orderId);
        if (existingOrder && existingOrder.userId === userId) {
            if (existingOrder.payment) {
                return res.status(200).json({ success: true, message: 'Payment already confirmed via webhook.' });
            }

            if (success === 'false' && !session_id) {
                await releaseInventoryForOrder(existingOrder);
                await releaseReservedLoyaltyRedemption({ order: existingOrder });
                await orderModel.findByIdAndUpdate(orderId, {
                    paymentStatus: 'cancelled',
                    inventoryReserved: false,
                    loyaltyRedemptionStatus:
                        Number(existingOrder.loyaltyPointsRedeemed || 0) > 0
                            ? 'released'
                            : existingOrder.loyaltyRedemptionStatus,
                    loyaltyRedemptionReleasedAt:
                        Number(existingOrder.loyaltyPointsRedeemed || 0) > 0
                            ? Date.now()
                            : existingOrder.loyaltyRedemptionReleasedAt
                });

                return res.status(200).json({ success: false, message: 'Payment cancelled.' });
            }

            if (!session_id) {
                return res.status(400).json({ success: false, message: 'Missing Stripe session id' });
            }

            const legacySession = await stripe.checkout.sessions.retrieve(session_id);
            const isLinkedToOrder =
                legacySession.client_reference_id === String(orderId) &&
                legacySession.metadata?.orderId === String(orderId) &&
                legacySession.metadata?.userId === String(userId);

            if (!isLinkedToOrder) {
                return res.status(400).json({ success: false, message: 'Invalid Stripe session' });
            }

            if (legacySession.payment_status !== 'paid') {
                return res.status(402).json({ success: false, message: 'Payment not completed' });
            }

            await markOrderAsPaid({
                order: existingOrder,
                gatewayEventId: legacySession.id,
                paymentFields: {
                    stripeSessionId: legacySession.id,
                    stripePaymentIntentId: legacySession.payment_intent ? String(legacySession.payment_intent) : null
                }
            });

            return res.status(200).json({ success: true, message: 'Payment verified successfully.' });
        }

        const paymentAttempt = await paymentAttemptModel.findById(orderId);

        if (!paymentAttempt || paymentAttempt.userId !== userId || paymentAttempt.paymentMethod !== 'Stripe') {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (paymentAttempt.status === 'order_created' && paymentAttempt.createdOrderId) {
            return res.status(200).json({ success: true, message: 'Payment already confirmed.' });
        }

        if (success === 'false' && !session_id) {
            await markPaymentAttemptAsNotCompleted({
                paymentAttempt,
                status: 'cancelled',
                paymentFields: {
                    stripeSessionId: paymentAttempt.stripeSessionId || null
                }
            });

            return res.status(200).json({ success: false, message: 'Payment cancelled.' });
        }

        if (!session_id) {
            return res.status(400).json({ success: false, message: 'Missing Stripe session id' });
        }

        const session = await stripe.checkout.sessions.retrieve(session_id);
        const linkedAttemptId = String(
            session.metadata?.paymentAttemptId || session.metadata?.orderId || session.client_reference_id || ''
        );
        const isLinkedToAttempt =
            linkedAttemptId === String(paymentAttempt._id) &&
            session.metadata?.userId === String(userId);

        if (!isLinkedToAttempt) {
            return res.status(400).json({ success: false, message: 'Invalid Stripe session' });
        }

        if (session.payment_status !== 'paid') {
            return res.status(402).json({ success: false, message: 'Payment not completed' });
        }

        await createOrderFromPaymentAttempt({
            paymentAttempt,
            gatewayEventId: session.id,
            paymentFields: {
                stripeSessionId: session.id,
                stripePaymentIntentId: session.payment_intent ? String(session.payment_intent) : null
            }
        });

        return res.status(200).json({ success: true, message: 'Payment verified successfully.' });
    }
    catch (error) {
        req.log?.error({ err: error }, 'Failed to verify Stripe payment');
        res.status(500).json({ success: false, message: 'Failed to verify Stripe payment' });
    }
};


//Placing orders using razorpay Method
const placeOrderRazorpay = async (req, res) => {
    let idempotencyRecordId;
    let normalizedItems = [];
    let reservedInventory = false;
    let createdPaymentAttemptId;
    let reservedLoyaltyPoints = 0;

    try{
        const razorpayInstance = getRazorpayClient();
        if (!razorpayInstance) {
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
            checkoutSource,
            paymentMethod: 'Razorpay'
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

        const options = {
            amount: amount * 100,
            currency:currency.toUpperCase(),
            receipt:paymentAttempt._id.toString()
        }
        const order = await razorpayInstance.orders.create(options);

        await paymentAttemptModel.findByIdAndUpdate(paymentAttempt._id, {
            razorpayOrderId: order.id
        });

        const responseBody = { success: true, order };

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

        const generatedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');

        if (!secureCompare(generatedSignature, razorpay_signature)) {
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
                }
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
            }
        });

        res.status(200).json({success:true,message:'Payment verified successfully.'});
    }
    catch(error){
        req.log?.error({ err: error }, 'Failed to verify Razorpay payment');
        res.status(500).json({success:false,message:'Failed to verify Razorpay payment'});
    }
};

const handleStripeWebhook = async (req, res) => {
    const signature = req.headers['stripe-signature'];
    const stripe = getStripeClient();

    if (!signature) {
        return res.status(400).send('Missing Stripe signature');
    }

    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
        return res.status(503).send('Stripe webhook is not configured');
    }

    try {
        const event = stripe.webhooks.constructEvent(
            req.body,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET
        );

        const parsedEvent = stripeWebhookEventSchema.safeParse(event);
        if (!parsedEvent.success) {
            return res.status(400).send('Invalid Stripe webhook payload');
        }

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const paymentAttempt = await resolveStripePaymentAttempt(session);

            if (paymentAttempt) {
                await createOrderFromPaymentAttempt({
                    paymentAttempt,
                    gatewayEventId: event.id,
                    paymentFields: {
                        stripeSessionId: session.id,
                        stripePaymentIntentId: session.payment_intent ? String(session.payment_intent) : null
                    }
                });
            }

            const order = await resolveStripeOrder(session);

            if (order) {
                await markOrderAsPaid({
                    order,
                    gatewayEventId: event.id,
                    paymentFields: {
                        stripeSessionId: session.id,
                        stripePaymentIntentId: session.payment_intent ? String(session.payment_intent) : null
                    }
                });
            }
        }

        if (event.type === 'checkout.session.expired') {
            const session = event.data.object;
            const paymentAttempt = await resolveStripePaymentAttempt(session);

            if (paymentAttempt) {
                await markPaymentAttemptAsNotCompleted({
                    paymentAttempt,
                    status: 'expired',
                    gatewayEventId: event.id,
                    paymentFields: { stripeSessionId: session.id }
                });
            }

            const order = await resolveStripeOrder(session);

            if (order) {
                await markOrderAsFailed({
                    order,
                    gatewayEventId: event.id,
                    paymentFields: { stripeSessionId: session.id }
                });
            }
        }

        return res.status(200).json({ received: true });
    } catch (error) {
        req.log?.error({ err: error }, 'Stripe webhook failed');
        return res.status(400).send(`Webhook Error: ${error.message}`);
    }
};

const handleRazorpayWebhook = async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];

    if (!signature) {
        return res.status(400).send('Missing Razorpay signature');
    }

    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
        return res.status(503).send('Razorpay webhook is not configured');
    }

    try {
        const rawBody = req.body;
        const computedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
            .update(rawBody)
            .digest('hex');

        if (!secureCompare(computedSignature, signature)) {
            return res.status(400).send('Invalid webhook signature');
        }

        const event = JSON.parse(rawBody.toString('utf8'));
        const parsedEvent = razorpayWebhookEventSchema.safeParse(event);
        if (!parsedEvent.success) {
            return res.status(400).send('Invalid Razorpay webhook payload');
        }

        const paymentEntity = event?.payload?.payment?.entity;
        const razorpayOrderId = paymentEntity?.order_id;

        if (!razorpayOrderId) {
            return res.status(200).json({ received: true });
        }

        const paymentAttempt = await paymentAttemptModel.findOne({
            razorpayOrderId,
            paymentMethod: 'Razorpay'
        });
        const order = paymentAttempt ? null : await orderModel.findOne({ razorpayOrderId });

        if (event.event === 'payment.captured') {
            if (paymentAttempt) {
                await createOrderFromPaymentAttempt({
                    paymentAttempt,
                    gatewayEventId: event?.payload?.payment?.entity?.id,
                    paymentFields: {
                        razorpayOrderId,
                        razorpayPaymentId: paymentEntity?.id || null
                    }
                });
            } else {
                await markOrderAsPaid({
                    order,
                    gatewayEventId: event?.payload?.payment?.entity?.id,
                    paymentFields: {
                        razorpayOrderId,
                        razorpayPaymentId: paymentEntity?.id || null
                    }
                });
            }
        }

        if (event.event === 'payment.failed') {
            if (paymentAttempt) {
                await markPaymentAttemptAsNotCompleted({
                    paymentAttempt,
                    status: 'failed',
                    gatewayEventId: event?.payload?.payment?.entity?.id,
                    paymentFields: {
                        razorpayOrderId,
                        razorpayPaymentId: paymentEntity?.id || null
                    }
                });
            } else {
                await markOrderAsFailed({
                    order,
                    gatewayEventId: event?.payload?.payment?.entity?.id,
                    paymentFields: {
                        razorpayOrderId,
                        razorpayPaymentId: paymentEntity?.id || null
                    }
                });
            }
        }

        return res.status(200).json({ received: true });
    } catch (error) {
        req.log?.error({ err: error }, 'Razorpay webhook failed');
        return res.status(500).send('Webhook processing failed');
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
        res.status(200).json({ success: true, orders });
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

//update order status by Admin Panel
const updateOrderStatus = async (req, res) => {
    try {
        const { orderId, status } = req.body;
        const existingOrder = await orderModel.findById(orderId);

        if (!existingOrder) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const updatePayload = { status };
        let shouldProcessDeliveryRewards = false;
        let shouldReleaseLoyalty = false;

        // Mark COD orders as paid once delivery is confirmed in admin.
        if (existingOrder.paymentMethod === 'COD' && status === 'Delivered' && !existingOrder.payment) {
            updatePayload.payment = true;
            updatePayload.paymentStatus = 'paid';
            updatePayload.paymentVerifiedAt = Date.now();
        }

        if (status === 'Delivered' && !existingOrder.deliveredAt) {
            updatePayload.deliveredAt = Date.now();
        }

        // Release reserved loyalty points when order is cancelled
        if (status === 'Cancelled' && existingOrder.status !== 'Cancelled' && existingOrder.status !== 'Delivered') {
            shouldReleaseLoyalty = Number(existingOrder.loyaltyPointsRedeemed || 0) > 0 &&
                existingOrder.loyaltyRedemptionStatus === 'reserved';
        }

        let updatedOrder = null;

        if (status === 'Delivered') {
            // Ensure only one concurrent transition to Delivered executes delivery-linked rewards.
            updatedOrder = await orderModel.findOneAndUpdate(
                {
                    _id: orderId,
                    status: { $ne: 'Delivered' }
                },
                updatePayload,
                { new: true }
            );

            if (updatedOrder) {
                shouldProcessDeliveryRewards = true;
            } else {
                updatedOrder = await orderModel.findById(orderId);
            }
        } else {
            updatedOrder = await orderModel.findByIdAndUpdate(orderId, updatePayload, { new: true });
        }

        await publishAdminOrderUpsert({
            order: updatedOrder,
            source: 'orderController.updateOrderStatus'
        });

        if (shouldProcessDeliveryRewards && status === 'Delivered') {
            await finalizeReservedLoyaltyRedemption({ order: updatedOrder });
            const rewardSummary = await awardOrderDeliveryRewards(updatedOrder);
            const refreshedOrder = await orderModel.findById(orderId).lean();
            const refreshedUser = await userModel.findById(existingOrder.userId).lean();

            await queueAutomationEmail({
                userId: refreshedUser,
                automationKey: 'order_delivered',
                context: {
                    orderCode: String(orderId).slice(-6).toUpperCase(),
                    points: rewardSummary?.awardedOrderPoints || 0,
                    loyaltyPoints: Number(refreshedUser?.loyaltyPoints || 0)
                }
            });

            if (!refreshedOrder?.reviewReminderQueuedAt) {
                await queueAutomationEmail({
                    userId: refreshedUser,
                    automationKey: 'review_request',
                    context: {
                        orderCode: String(orderId).slice(-6).toUpperCase()
                    }
                });

                await orderModel.findByIdAndUpdate(orderId, {
                    reviewReminderQueuedAt: Date.now()
                });
            }

            if (rewardSummary?.referralRewards?.referrerPoints > 0 && refreshedUser?.referredBy) {
                const referrer = await userModel.findById(refreshedUser.referredBy).lean();

                if (referrer) {
                    await queueAutomationEmail({
                        userId: referrer,
                        automationKey: 'referral_reward_referrer',
                        context: {
                            points: rewardSummary.referralRewards.referrerPoints,
                            loyaltyPoints: Number(referrer.loyaltyPoints || 0)
                        }
                    });
                }

                await queueAutomationEmail({
                    userId: refreshedUser,
                    automationKey: 'referral_reward_new_customer',
                    context: {
                        points: rewardSummary.referralRewards.newCustomerPoints,
                        loyaltyPoints: Number(refreshedUser.loyaltyPoints || 0)
                    }
                });
            }
        }

        // Release reserved loyalty points on cancellation
        if (shouldReleaseLoyalty) {
            await releaseReservedLoyaltyRedemption({ order: existingOrder });
        }

        // Release inventory on cancellation if still reserved
        if (status === 'Cancelled' && existingOrder.status !== 'Cancelled' && existingOrder.inventoryReserved) {
            await releaseInventoryForOrder(existingOrder);
        }

        res.status(200).json({ success: true, message: 'Status Updated', order: updatedOrder });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to update order status');
        res.status(500).json({ success: false, message: 'Failed to update order status' });
    }
};

export {
    allOrders,
    handleRazorpayWebhook,
    handleStripeWebhook,
    placeOrderCOD,
    placeOrderRazorpay,
    placeOrderStripe,
    previewCheckoutPricing,
    updateOrderStatus,
    userOrders,
    verifyRazorpay,
    verifyStripe
}
