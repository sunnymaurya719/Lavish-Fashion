import orderModel from '../models/orderModel.js';
import userModel from '../models/userModel.js';
import logger from '../config/logger.js';
import { releaseInventoryForItems } from './productInventoryService.js';
import { publishAdminOrderUpsert } from './realtimeService.js';
import { cancelOrder as cancelShiprocketOrder } from './shiprocketService.js';
import { isShiprocketConfigured } from '../config/shiprocket.js';
import {
    awardOrderDeliveryRewards,
    finalizeReservedLoyaltyRedemption,
    releaseReservedLoyaltyRedemption
} from './loyaltyService.js';
import { queueAutomationEmail } from './marketingAutomationService.js';
import {
    sendCancelledMessage,
    sendDeliveredMessage,
    sendOutForDeliveryMessage,
    sendShippedMessage
} from './whatsappService.js';

const ORDER_STATUS = {
    placed: 'Order Placed',
    shipped: 'Shipped',
    outForDelivery: 'Out for delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled'
};

const normalizeOrderStatus = (value) => String(value || '').trim().toLowerCase();

const isFinalizedOrderStatus = (value) => {
    const normalizedStatus = normalizeOrderStatus(value);
    return (
        normalizedStatus === normalizeOrderStatus(ORDER_STATUS.delivered) ||
        normalizedStatus === normalizeOrderStatus(ORDER_STATUS.cancelled)
    );
};

const getOrderDisplayCode = (order) => {
    const referenceCode =
        String(order?.shiprocket?.referenceOrderId || order?.publicOrderCode || order?._id || '').trim().toUpperCase();

    return referenceCode || String(order?._id || '').slice(-6).toUpperCase();
};

const releaseInventoryForOrder = async (order) => {
    if (!order || !order.inventoryReserved) {
        return;
    }

    await releaseInventoryForItems(order.items);
    await orderModel.findByIdAndUpdate(order._id, { inventoryReserved: false });
};

const cancelShiprocketForOrder = async (order, { source } = {}) => {
    if (!order) {
        return null;
    }

    const shiprocketOrderId = Number(order?.shiprocket?.orderId || 0);
    const currentCancelStatus = String(order?.shiprocket?.cancelStatus || '').trim();

    if (!shiprocketOrderId) {
        return null;
    }

    if (currentCancelStatus === 'cancelled') {
        return { skipped: true, reason: 'already_cancelled' };
    }

    if (!isShiprocketConfigured()) {
        await orderModel.findByIdAndUpdate(order._id, {
            $set: {
                'shiprocket.cancelStatus': 'pending',
                'shiprocket.cancelAttemptedAt': Date.now(),
                'shiprocket.cancelError': 'Shiprocket integration is not configured'
            }
        });
        return { skipped: true, reason: 'shiprocket_disabled' };
    }

    const shiprocketLog = logger.child({
        integration: 'shiprocket',
        action: 'cancel_order_local_mirror',
        orderId: String(order._id || ''),
        shiprocketOrderId,
        source: source || 'orderStatusService.performOrderCancellation'
    });

    await orderModel.findByIdAndUpdate(order._id, {
        $set: {
            'shiprocket.cancelStatus': 'pending',
            'shiprocket.cancelAttemptedAt': Date.now(),
            'shiprocket.cancelError': ''
        }
    });

    try {
        const result = await cancelShiprocketOrder([shiprocketOrderId], { log: shiprocketLog });
        const cancelledAt = Date.now();

        await orderModel.findByIdAndUpdate(order._id, {
            $set: {
                'shiprocket.cancelStatus': 'cancelled',
                'shiprocket.cancelledAt': cancelledAt,
                'shiprocket.cancelError': '',
                'shiprocket.rawCancelResponse': result?.raw || null
            }
        });

        shiprocketLog.info(
            {
                alreadyCancelled: Boolean(result?.alreadyCancelled),
                message: result?.message || ''
            },
            'Shiprocket cancellation mirrored successfully'
        );

        return { success: true, alreadyCancelled: Boolean(result?.alreadyCancelled) };
    } catch (error) {
        const errorMessage = String(error?.message || 'Shiprocket cancellation failed').slice(0, 500);

        await orderModel.findByIdAndUpdate(order._id, {
            $set: {
                'shiprocket.cancelStatus': 'failed',
                'shiprocket.cancelError': errorMessage,
                'shiprocket.rawCancelResponse': error?.upstreamPayload || null
            }
        });

        shiprocketLog.error(
            {
                err: error,
                upstreamStatusCode: error?.upstreamStatusCode || null
            },
            'Shiprocket cancellation mirror failed (local cancellation already applied)'
        );

        return { success: false, error: errorMessage };
    }
};

const performOrderCancellation = async ({ existingOrder, source }) => {
    const orderId = String(existingOrder?._id || '');
    const shouldReleaseLoyalty =
        normalizeOrderStatus(existingOrder?.status) !== normalizeOrderStatus(ORDER_STATUS.delivered) &&
        Number(existingOrder?.loyaltyPointsRedeemed || 0) > 0 &&
        existingOrder?.loyaltyRedemptionStatus === 'reserved';
    const shouldReleaseInventory = Boolean(existingOrder?.inventoryReserved);

    const cancelledOrder = await orderModel.findOneAndUpdate(
        {
            _id: orderId,
            status: { $ne: ORDER_STATUS.cancelled }
        },
        {
            status: ORDER_STATUS.cancelled,
            paymentStatus: 'cancelled',
            cancelledAt: existingOrder?.cancelledAt || Date.now()
        },
        { new: true }
    );

    // Another request may have cancelled the order first. In that case, avoid
    // double-releasing inventory or loyalty reservations from stale state.
    if (!cancelledOrder) {
        return orderModel.findById(orderId);
    }

    if (shouldReleaseLoyalty) {
        await releaseReservedLoyaltyRedemption({ order: existingOrder });
    }

    if (shouldReleaseInventory) {
        await releaseInventoryForOrder(existingOrder);
    }

    // Best-effort: mirror the cancellation to Shiprocket so the shipment is
    // not dispatched. Failures are logged and stored on the order but never
    // block the local cancellation path.
    await cancelShiprocketForOrder(cancelledOrder, { source });

    const refreshedOrder = await orderModel.findById(orderId);

    if (refreshedOrder) {
        await publishAdminOrderUpsert({
            order: refreshedOrder,
            source
        });
    }

    return refreshedOrder;
};

const sendStatusDrivenWhatsAppNotification = async ({ order, status, log }) => {
    if (!order) {
        return null;
    }

    if (status === ORDER_STATUS.shipped) {
        return sendShippedMessage(order, { log });
    }

    if (status === ORDER_STATUS.outForDelivery) {
        return sendOutForDeliveryMessage(order, { log });
    }

    if (status === ORDER_STATUS.delivered) {
        return sendDeliveredMessage(order, { log });
    }

    if (status === ORDER_STATUS.cancelled) {
        return sendCancelledMessage(order, { log });
    }

    return null;
};

const processDeliveredOrderEffects = async ({ existingOrder, updatedOrder }) => {
    if (!updatedOrder || normalizeOrderStatus(updatedOrder.status) !== normalizeOrderStatus(ORDER_STATUS.delivered)) {
        return;
    }

    await finalizeReservedLoyaltyRedemption({ order: updatedOrder });
    const rewardSummary = await awardOrderDeliveryRewards(updatedOrder);
    const refreshedOrder = await orderModel.findById(updatedOrder._id).lean();
    const refreshedUser = await userModel.findById(existingOrder.userId).lean();
    const orderCode = getOrderDisplayCode(updatedOrder);

    await queueAutomationEmail({
        userId: refreshedUser,
        automationKey: 'order_delivered',
        context: {
            orderCode,
            points: rewardSummary?.awardedOrderPoints || 0,
            loyaltyPoints: Number(refreshedUser?.loyaltyPoints || 0)
        }
    });

    if (!refreshedOrder?.reviewReminderQueuedAt) {
        await queueAutomationEmail({
            userId: refreshedUser,
            automationKey: 'review_request',
            context: {
                orderCode
            }
        });

        await orderModel.findByIdAndUpdate(updatedOrder._id, {
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
};

const validateOrderStatusTransition = (existingOrder, status) => {
    if (
        normalizeOrderStatus(existingOrder.status) === normalizeOrderStatus(ORDER_STATUS.delivered) &&
        normalizeOrderStatus(status) !== normalizeOrderStatus(ORDER_STATUS.delivered)
    ) {
        const error = new Error('Delivered orders cannot be moved back into the fulfillment pipeline.');
        error.statusCode = 400;
        throw error;
    }

    if (
        normalizeOrderStatus(existingOrder.status) === normalizeOrderStatus(ORDER_STATUS.cancelled) &&
        normalizeOrderStatus(status) !== normalizeOrderStatus(ORDER_STATUS.cancelled)
    ) {
        const error = new Error('Cancelled orders cannot be moved back into the fulfillment pipeline.');
        error.statusCode = 400;
        throw error;
    }
};

const applyOrderStatusTransition = async ({ existingOrder, status, source, log, additionalSet = {} }) => {
    validateOrderStatusTransition(existingOrder, status);

    if (
        normalizeOrderStatus(status) === normalizeOrderStatus(ORDER_STATUS.cancelled) &&
        normalizeOrderStatus(existingOrder.status) === normalizeOrderStatus(ORDER_STATUS.cancelled)
    ) {
        if (Object.keys(additionalSet).length > 0) {
            return {
                updatedOrder: await orderModel.findByIdAndUpdate(
                    existingOrder._id,
                    { $set: additionalSet },
                    { new: true }
                ),
                shouldProcessDeliveryRewards: false
            };
        }

        return {
            updatedOrder: existingOrder,
            shouldProcessDeliveryRewards: false
        };
    }

    const updatePayload = {
        status,
        ...additionalSet
    };
    let shouldProcessDeliveryRewards = false;

    if (existingOrder.paymentMethod === 'COD' && status === ORDER_STATUS.delivered && !existingOrder.payment) {
        updatePayload.payment = true;
        updatePayload.paymentStatus = 'paid';
        updatePayload.paymentVerifiedAt = Date.now();
    }

    if (status === ORDER_STATUS.delivered && !existingOrder.deliveredAt) {
        updatePayload.deliveredAt = Date.now();
    }

    let updatedOrder = null;

    if (status === ORDER_STATUS.cancelled) {
        updatedOrder = await performOrderCancellation({
            existingOrder,
            source
        });

        if (updatedOrder && Object.keys(additionalSet).length > 0) {
            updatedOrder = await orderModel.findByIdAndUpdate(
                updatedOrder._id,
                { $set: additionalSet },
                { new: true }
            );
        }
    } else if (status === ORDER_STATUS.delivered) {
        updatedOrder = await orderModel.findOneAndUpdate(
            {
                _id: existingOrder._id,
                status: { $ne: ORDER_STATUS.delivered }
            },
            { $set: updatePayload },
            { new: true }
        );

        if (updatedOrder) {
            shouldProcessDeliveryRewards = true;
        } else {
            updatedOrder = await orderModel.findById(existingOrder._id);
            if (updatedOrder && Object.keys(additionalSet).length > 0) {
                updatedOrder = await orderModel.findByIdAndUpdate(
                    existingOrder._id,
                    { $set: additionalSet },
                    { new: true }
                );
            }
        }
    } else {
        updatedOrder = await orderModel.findByIdAndUpdate(
            existingOrder._id,
            { $set: updatePayload },
            { new: true }
        );
    }

    if (status !== ORDER_STATUS.cancelled) {
        await publishAdminOrderUpsert({
            order: updatedOrder,
            source
        });
    }

    await sendStatusDrivenWhatsAppNotification({
        order: updatedOrder,
        status,
        log
    });

    if (shouldProcessDeliveryRewards && status === ORDER_STATUS.delivered) {
        await processDeliveredOrderEffects({
            existingOrder,
            updatedOrder
        });
    }

    return {
        updatedOrder,
        shouldProcessDeliveryRewards
    };
};

export {
    ORDER_STATUS,
    applyOrderStatusTransition,
    isFinalizedOrderStatus,
    normalizeOrderStatus,
    performOrderCancellation
};
