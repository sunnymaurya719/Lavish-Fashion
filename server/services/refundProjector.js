/**
 * Refund projector — the SINGLE writer for `order.refunds[]`,
 * `order.refundedAmountInPaise`, `order.refundStatus`, and per-item
 * refund totals.
 *
 * Idempotent by construction: it RECOMPUTES every projected field from
 * the source-of-truth `Refund` collection rather than incrementing.
 * Running twice produces the same result.
 */

import orderModel from '../models/orderModel.js';
import refundModel from '../models/refundModel.js';
import { paiseToRupees } from '../utils/paise.util.js';
import { RefundError } from '../utils/refundErrors.js';
import { RefundState } from '../utils/refundStateMachine.js';
import { refundLogger } from '../utils/structuredLogger.js';

import { publishAdminOrderUpsert } from './realtimeService.js';

const STATE_TO_LEGACY_STATUS = Object.freeze({
    [RefundState.INITIATED]: 'pending',
    [RefundState.PENDING]: 'pending',
    [RefundState.PROCESSED]: 'processed',
    [RefundState.FAILED]: 'failed',
    [RefundState.PERMANENTLY_FAILED]: 'failed'
});

const buildLegacyRefundEntry = (refund) => ({
    refundId: refund.gatewayRefundId || `refund_${String(refund._id)}`,
    paymentId: refund.paymentId || '',
    amount: paiseToRupees(refund.amountInPaise),
    currency: refund.currency || 'INR',
    status: STATE_TO_LEGACY_STATUS[refund.state] || 'pending',
    speed: 'normal',
    speedRequested: 'normal',
    speedProcessed: '',
    reason: refund.reason || '',
    notes: { refundDocId: String(refund._id), channel: refund.channel },
    initiatedBy: refund.initiatedByAdminEmail || '',
    idempotencyKey: refund.idempotencyKey || '',
    createdAt: refund.refundInitiatedAt
        ? new Date(refund.refundInitiatedAt).getTime()
        : Date.now(),
    processedAt: refund.refundProcessedAt
        ? new Date(refund.refundProcessedAt).getTime()
        : null,
    failureReason: refund.failureReason || '',
    rawResponse: refund.metadata || null
});

const computeOrderTotals = ({ orderAmountInPaise, refunds }) => {
    const processedPaise = refunds
        .filter((r) => r.state === RefundState.PROCESSED)
        .reduce((sum, r) => sum + (r.amountInPaise || 0), 0);

    const inFlight = refunds.some(
        (r) => r.state === RefundState.INITIATED || r.state === RefundState.PENDING
    );
    const hasFailed = refunds.some(
        (r) => r.state === RefundState.FAILED || r.state === RefundState.PERMANENTLY_FAILED
    );

    let refundStatus = 'none';
    if (processedPaise > 0 && processedPaise >= orderAmountInPaise) {
        refundStatus = 'processed';
    } else if (processedPaise > 0) {
        refundStatus = 'partial';
    } else if (inFlight) {
        refundStatus = 'pending';
    } else if (hasFailed) {
        refundStatus = 'failed';
    }

    return { processedPaise, refundStatus };
};

/**
 * Recompute and persist all projected fields for one order.
 * @param {object} input
 * @param {string|object} input.orderId
 * @param {object} [input.log]
 */
const project = async ({ orderId, log = refundLogger }) => {
    if (!orderId) {
        throw new RefundError('refundProjector.project requires orderId', {
            code: 'REFUND_PROJECTOR_NO_ORDER_ID'
        });
    }

    const order = await orderModel.findById(orderId);
    if (!order) {
        log.warn(
            { event: 'refund_projector_order_missing', orderId: String(orderId) },
            'Skipping projection — order not found'
        );
        return null;
    }

    const refunds = await refundModel
        .find({ orderId })
        .sort({ createdAt: 1 })
        .lean();

    const orderAmountInPaise = Number.isInteger(order.amountInPaise) && order.amountInPaise > 0
        ? order.amountInPaise
        : Math.round(Number(order.amount || 0) * 100);

    const { processedPaise, refundStatus } = computeOrderTotals({
        orderAmountInPaise,
        refunds
    });

    // Per-item refund tracking. With our current data model we do not
    // attribute refunds to individual items (the existing UI also does
    // not), so we only set per-item status when the WHOLE order has
    // been refunded. A future per-line-item refund feature can extend
    // this without breaking the field shape.
    const items = (order.items || []).map((item) => {
        const plain = item.toObject ? item.toObject() : { ...item };
        if (refundStatus === 'processed') {
            return {
                ...plain,
                refundedAmountPaise: plain.pricePaise || 0,
                refundStatus: 'full'
            };
        }
        if (refundStatus === 'partial') {
            return {
                ...plain,
                refundStatus: 'partial'
            };
        }
        return {
            ...plain,
            refundedAmountPaise: 0,
            refundStatus: 'none'
        };
    });

    order.refundedAmountInPaise = processedPaise;
    order.refundedAmount = paiseToRupees(processedPaise);
    order.refundStatus = refundStatus;
    order.refundLastUpdatedAt = Date.now();
    order.refunds = refunds.map(buildLegacyRefundEntry);
    order.items = items;

    await order.save();

    log.info(
        {
            event: 'refund_projector_applied',
            orderId: String(order._id),
            refundCount: refunds.length,
            processedPaise,
            refundStatus
        },
        'Order refund projection updated'
    );

    // Fire-and-forget realtime push so the admin grid reflects the
    // change. Errors here MUST NOT propagate — the projection has
    // already been persisted successfully.
    publishAdminOrderUpsert({
        order,
        source: 'refundProjector.project'
    }).catch((error) => {
        log.warn(
            { event: 'refund_projector_publish_failed', err: error?.message },
            'Realtime publish for refund projection failed'
        );
    });

    return order;
};

export { project };
