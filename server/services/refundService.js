/**
 * Refund orchestrator. The single entry point for every refund mutation:
 *
 *   - initiateRefund          (admin-driven)
 *   - markManualRefundProcessed (admin clears a bank transfer)
 *   - processWebhookUpdate    (Razorpay tells us a refund changed)
 *   - retry                   (background job re-attempts a failed refund)
 *
 * Concurrency model:
 *   1. Atomic "lock" via `Order.findOneAndUpdate` with a guarded
 *      `$inc` on `refundableAmountInPaise`. Only one concurrent caller
 *      can win the decrement; the loser sees no document and gets
 *      `InsufficientRefundableAmountError`.
 *   2. The expensive gateway call happens OUTSIDE any database
 *      transaction so we never hold a write lock across network IO.
 *   3. If the strategy fails, we COMPENSATE: re-credit the locked
 *      amount and write a compensating ledger entry.
 *   4. Append-only ledger writes give us an audit trail that never
 *      disagrees with the projected order totals.
 */

import auditLogModel from '../models/auditLogModel.js';
import orderModel from '../models/orderModel.js';
import refundModel from '../models/refundModel.js';
import {
    paiseFromOrderRupees,
    paiseToRupees,
    safePaiseAdd
} from '../utils/paise.util.js';
import {
    GatewayError,
    InsufficientRefundableAmountError,
    InvalidRefundTransitionError,
    RefundError,
    RefundNotFoundError,
    RefundValidationError,
    isRefundError
} from '../utils/refundErrors.js';
import {
    RefundState,
    canTransition,
    isTerminalState,
    shouldUpdateFromWebhook
} from '../utils/refundStateMachine.js';
import { refundLogger, withRefundContext } from '../utils/structuredLogger.js';

import * as ledgerService from './ledgerService.js';
import * as refundProjector from './refundProjector.js';
import { chooseStrategy } from './refundRouterService.js';

const RETRY_BACKOFF_BASE_MS = 10 * 60 * 1000; // 10 minutes
const MAX_RETRIES_DEFAULT = 3;

const STRATEGY_GATEWAY_STATUS_TO_STATE = Object.freeze({
    processed: RefundState.PROCESSED,
    refunded: RefundState.PROCESSED,
    pending: RefundState.PENDING,
    created: RefundState.PENDING,
    failed: RefundState.FAILED
});

const computeNextRetryAt = (retryCount) => {
    const delay = RETRY_BACKOFF_BASE_MS * 2 ** Math.max(0, retryCount);
    return new Date(Date.now() + delay);
};

const writeAudit = async ({ action, refund, order, admin, before, after, metadata }) => {
    try {
        await auditLogModel.create({
            actorId: admin?.id || null,
            actorEmail: admin?.email || 'system',
            actorRole: admin?.role || 'system',
            action,
            targetType: 'refund',
            targetId: refund?._id ? String(refund._id) : null,
            before: before || null,
            after: after || null,
            metadata: {
                orderId: order?._id ? String(order._id) : null,
                refundId: refund?._id ? String(refund._id) : null,
                ...(metadata || {})
            }
        });
    } catch (error) {
        refundLogger.warn(
            { event: 'refund_audit_write_failed', err: error.message, action },
            'Audit log write failed (non-fatal)'
        );
    }
};

/**
 * Atomically reserve `amountInPaise` from the order's refundable bucket.
 * Returns the updated order or throws InsufficientRefundableAmountError.
 */
const reserveRefundableAmount = async ({ orderId, amountInPaise }) => {
    const updated = await orderModel.findOneAndUpdate(
        {
            _id: orderId,
            refundableAmountInPaise: { $gte: amountInPaise }
        },
        {
            $inc: { refundableAmountInPaise: -amountInPaise }
        },
        { new: true }
    );

    if (!updated) {
        // Either the order is gone or the refundable bucket is too small.
        // Distinguish by checking the order separately for a useful error.
        const order = await orderModel.findById(orderId).lean();
        if (!order) {
            throw new RefundNotFoundError(`Order ${orderId} not found`);
        }
        throw new InsufficientRefundableAmountError(
            'Requested refund exceeds remaining refundable amount',
            {
                details: {
                    requestedPaise: amountInPaise,
                    refundableAmountInPaise: order.refundableAmountInPaise || 0
                }
            }
        );
    }

    return updated;
};

const releaseRefundableAmount = async ({ orderId, amountInPaise }) => {
    await orderModel.updateOne(
        { _id: orderId },
        { $inc: { refundableAmountInPaise: amountInPaise } }
    );
};

const buildRefundDoc = ({ orderId, order, dto, admin }) => ({
    orderId,
    paymentId: order.razorpayPaymentId || null,
    amountInPaise: dto.amountInPaise,
    currency: order.currency || 'INR',
    state: RefundState.INITIATED,
    channel: dto.channel,
    reason: dto.reason || 'customer_request',
    notes: dto.notes || '',
    initiatedByAdminId: admin.id,
    initiatedByAdminEmail: admin.email,
    approvedByAdminId: dto.approvedByAdminId || null,
    approvedByAdminEmail: dto.approvedByAdminEmail || null,
    idempotencyKey: dto.idempotencyKey,
    refundInitiatedAt: new Date(),
    metadata: dto.metadata || {}
});

/**
 * Resolve a refund doc by its DB id (string ObjectId or ObjectId).
 */
const findRefundOrThrow = async (refundId) => {
    const refund = await refundModel.findById(refundId);
    if (!refund) {
        throw new RefundNotFoundError(`Refund ${refundId} not found`);
    }
    return refund;
};

/**
 * Persist a state transition on a Refund doc. Validates the
 * transition with the state machine and surfaces a typed error.
 */
const transitionRefundState = (refund, nextState) => {
    if (refund.state === nextState) return refund;
    if (!canTransition(refund.state, nextState)) {
        throw new InvalidRefundTransitionError(
            `Refund ${refund._id} cannot transition ${refund.state} → ${nextState}`,
            { details: { from: refund.state, to: nextState } }
        );
    }
    refund.state = nextState;
    if (nextState === RefundState.PROCESSED) {
        refund.refundProcessedAt = new Date();
    }
    if (nextState === RefundState.PERMANENTLY_FAILED) {
        refund.permanentlyFailedAt = new Date();
    }
    return refund;
};

/**
 * Initiate a refund.
 *
 * @param {object} dto
 * @param {string} dto.orderId
 * @param {number} dto.amountInPaise            Required positive integer paise
 * @param {string} dto.idempotencyKey           Required, unique per request
 * @param {string} dto.reason                   Enum value (see refundModel)
 * @param {string} [dto.notes]
 * @param {string} [dto.approvedByAdminId]      For high-value approvals
 * @param {string} [dto.approvedByAdminEmail]
 * @param {object} dto.admin                    { id, email, role }
 * @param {object} [dto.metadata]
 * @param {object} [dto.log]
 * @returns {Promise<{ refund: object, order: object }>}
 */
const initiateRefund = async (dto) => {
    if (!dto || typeof dto !== 'object') {
        throw new RefundValidationError('initiateRefund requires a DTO');
    }
    const { orderId, amountInPaise, idempotencyKey, admin } = dto;

    if (!orderId) throw new RefundValidationError('orderId is required');
    if (!Number.isInteger(amountInPaise) || amountInPaise <= 0) {
        throw new RefundValidationError('amountInPaise must be a positive integer (paise)');
    }
    if (!idempotencyKey) throw new RefundValidationError('idempotencyKey is required');
    // `admin.id` may be empty for the legacy env-based super admin
    // (ADMIN_EMAIL token has no DB-backed user record). Only the email
    // is mandatory — it's what we persist on the refund + ledger entries.
    if (!admin?.email) {
        throw new RefundValidationError('admin context is required');
    }

    const log = withRefundContext(dto.log || refundLogger, {
        orderId: String(orderId),
        idempotencyKey,
        adminEmail: admin.email
    });

    // Reject duplicate keys early to avoid an avoidable Mongo write race.
    const existingRefund = await refundModel.findOne({ idempotencyKey }).lean();
    if (existingRefund) {
        log.info(
            { event: 'refund_initiate_replay', refundId: String(existingRefund._id) },
            'Replaying existing refund for idempotency key'
        );
        const order = await orderModel.findById(existingRefund.orderId);
        return { refund: existingRefund, order, replayed: true };
    }

    // Step 1: load order & confirm refundability.
    const orderForCheck = await orderModel.findById(orderId).lean();
    if (!orderForCheck) {
        throw new RefundNotFoundError(`Order ${orderId} not found`);
    }
    if (!orderForCheck.payment) {
        throw new RefundError('Cannot refund an unpaid order', {
            statusCode: 409,
            code: 'REFUND_ORDER_UNPAID'
        });
    }

    // Resolve channel via router
    const { channel, strategy } = chooseStrategy(orderForCheck);
    const fullDto = {
        ...dto,
        channel,
        reason: dto.reason || 'customer_request'
    };

    // Step 2: atomically reserve refundable amount.
    const orderAfterReserve = await reserveRefundableAmount({
        orderId,
        amountInPaise
    });

    let refund;
    try {
        // Step 3: persist a Refund doc in INITIATED.
        refund = await refundModel.create(
            buildRefundDoc({
                orderId,
                order: orderAfterReserve,
                dto: fullDto,
                admin
            })
        );

        log.info(
            {
                event: 'refund_initiate_persisted',
                refundId: String(refund._id),
                channel,
                amountInPaise
            },
            'Refund persisted, calling strategy'
        );

        // Step 4: call strategy (network IO).
        const strategyResult = await strategy.execute({
            refund,
            order: orderAfterReserve,
            idempotencyKey,
            log
        });

        refund.gatewayRefundId = strategyResult.gatewayRefundId;
        refund.metadata = {
            ...(refund.metadata || {}),
            strategyRaw: strategyResult.raw
        };

        // Step 5: transition state based on strategy result.
        if (!strategyResult.skipPendingTransition) {
            transitionRefundState(refund, RefundState.PENDING);
        }
        await refund.save();

        // Step 6: write ledger entry (negative amount = money paid back).
        // We only post a ledger entry once the refund leaves INITIATED
        // for a non-manual channel. For manual transfers the ledger
        // entry is posted in markManualRefundProcessed.
        if (!strategyResult.skipPendingTransition) {
            await ledgerService.recordRefund({
                amountInPaise: -amountInPaise,
                source: channel === 'razorpay' ? 'razorpay' : 'manual',
                referenceId: refund.gatewayRefundId,
                orderId,
                refundId: refund._id,
                description: `Refund initiated for order ${orderId}`
            });
        }

        // Step 7: project to the order doc.
        await refundProjector.project({ orderId, log });

        await writeAudit({
            action: 'refund.initiated',
            refund,
            order: orderAfterReserve,
            admin,
            after: {
                state: refund.state,
                amountInPaise,
                channel,
                gatewayRefundId: refund.gatewayRefundId
            }
        });

        log.info(
            { event: 'refund_initiate_succeeded', refundId: String(refund._id) },
            'Refund initiated successfully'
        );

        return { refund, order: orderAfterReserve, replayed: false };
    } catch (error) {
        // Compensating rollback. We re-credit the order's refundable
        // bucket and (if the refund doc was created) mark it FAILED.
        log.warn(
            { event: 'refund_initiate_failed', err: error.message, code: error.code },
            'Refund initiation failed — compensating'
        );

        await releaseRefundableAmount({ orderId, amountInPaise }).catch((releaseError) => {
            log.error(
                {
                    event: 'refund_release_failed',
                    err: releaseError.message,
                    orderId: String(orderId)
                },
                'CRITICAL: failed to release refundable amount after failed initiation'
            );
        });

        if (refund?._id) {
            const failureReason =
                error?.message ||
                (error?.cause?.message) ||
                'Refund initiation failed';
            try {
                refund.failureReason = failureReason;
                refund.retryCount = (refund.retryCount || 0);
                refund.nextRetryAt = computeNextRetryAt(refund.retryCount);
                if (canTransition(refund.state, RefundState.FAILED)) {
                    transitionRefundState(refund, RefundState.FAILED);
                }
                await refund.save();
            } catch (saveError) {
                log.error(
                    { event: 'refund_mark_failed_failed', err: saveError.message },
                    'Failed to mark refund as failed'
                );
            }

            await writeAudit({
                action: 'refund.failed',
                refund,
                order: orderAfterReserve,
                admin,
                after: { state: refund.state, failureReason }
            });
        }

        if (isRefundError(error)) throw error;

        // Wrap unknown errors so callers always see a typed RefundError.
        throw new RefundError(error?.message || 'Refund initiation failed', {
            statusCode: 500,
            code: 'REFUND_INITIATE_UNEXPECTED',
            cause: error
        });
    }
};

/**
 * Mark a manual (bank-transfer) refund as processed once an admin has
 * confirmed the funds left our bank account.
 */
const markManualRefundProcessed = async ({
    refundId,
    utrReference,
    notes,
    admin,
    log = refundLogger
}) => {
    if (!refundId) throw new RefundValidationError('refundId is required');
    if (!utrReference || typeof utrReference !== 'string') {
        throw new RefundValidationError('utrReference is required');
    }
    if (!admin?.email) {
        throw new RefundValidationError('admin context is required');
    }

    const refund = await findRefundOrThrow(refundId);

    if (refund.channel !== 'bank_transfer') {
        throw new RefundError(
            `markManualRefundProcessed only valid for bank_transfer refunds (got ${refund.channel})`,
            { statusCode: 409, code: 'REFUND_NOT_MANUAL' }
        );
    }
    if (isTerminalState(refund.state)) {
        throw new InvalidRefundTransitionError(
            `Refund ${refund._id} is already ${refund.state}`,
            { details: { from: refund.state, to: RefundState.PROCESSED } }
        );
    }

    refund.manualReference = utrReference.trim().slice(0, 64);
    if (notes) {
        refund.notes = String(notes).slice(0, 500);
    }
    refund.markedProcessedByAdminEmail = admin.email;

    transitionRefundState(refund, RefundState.PROCESSED);
    await refund.save();

    await ledgerService.recordRefund({
        amountInPaise: -refund.amountInPaise,
        source: 'manual',
        referenceId: refund.manualReference,
        orderId: refund.orderId,
        refundId: refund._id,
        description: `Manual bank transfer settled — UTR ${refund.manualReference}`
    });

    await refundProjector.project({ orderId: refund.orderId, log });

    await writeAudit({
        action: 'refund.manual_marked_processed',
        refund,
        order: { _id: refund.orderId },
        admin,
        after: {
            state: refund.state,
            manualReference: refund.manualReference
        }
    });

    log.info(
        {
            event: 'refund_manual_marked_processed',
            refundId: String(refund._id),
            utrReference: refund.manualReference
        },
        'Manual refund marked processed'
    );

    return refund;
};

/**
 * Apply a Razorpay refund webhook event to our records. Idempotent
 * per (refundId, gatewayStatus, gatewayUpdatedAt).
 */
const processWebhookUpdate = async ({ event, refundEntity, log = refundLogger }) => {
    if (!event || !refundEntity) {
        throw new RefundValidationError('processWebhookUpdate requires event and refundEntity');
    }
    const gatewayRefundId = String(refundEntity.id || '');
    if (!gatewayRefundId) {
        throw new RefundValidationError('refundEntity is missing id');
    }

    const refund = await refundModel.findOne({ gatewayRefundId });
    if (!refund) {
        log.warn(
            { event: 'refund_webhook_unknown_refund', gatewayRefundId, gatewayEvent: event },
            'Webhook references unknown refund — skipping'
        );
        return null;
    }

    const gatewayStatus = String(refundEntity.status || '').toLowerCase();
    const incomingState =
        STRATEGY_GATEWAY_STATUS_TO_STATE[gatewayStatus] || null;

    if (!incomingState) {
        log.info(
            { event: 'refund_webhook_unmapped_status', gatewayStatus, refundId: String(refund._id) },
            'Webhook gateway status has no mapping — ignoring'
        );
        return refund;
    }

    if (!shouldUpdateFromWebhook(refund.state, incomingState)) {
        log.info(
            {
                event: 'refund_webhook_no_progress',
                from: refund.state,
                to: incomingState,
                refundId: String(refund._id)
            },
            'Webhook would not advance refund state — skipping'
        );
        return refund;
    }

    const before = refund.state;

    if (incomingState === RefundState.FAILED) {
        refund.failureReason =
            refundEntity.error_description ||
            refundEntity.notes?.failure_reason ||
            'Refund failed at gateway';
    }

    transitionRefundState(refund, incomingState);
    await refund.save();

    // Ledger consistency: only the FIRST time we mark a refund processed
    // do we want to "confirm" it. Our recordRefund-on-initiate already
    // captured the negative entry; webhook processed = no extra ledger
    // movement (it would double the refund). We only post adjustments
    // when a refund FAILS after we already debited the ledger.
    if (incomingState === RefundState.FAILED && before === RefundState.PENDING) {
        // Compensate: refund did not actually go out, restore refundable.
        await releaseRefundableAmount({
            orderId: refund.orderId,
            amountInPaise: refund.amountInPaise
        });
        await ledgerService.recordAdjustment({
            amountInPaise: refund.amountInPaise,
            source: 'razorpay',
            referenceId: gatewayRefundId,
            orderId: refund.orderId,
            refundId: refund._id,
            description: `Refund ${gatewayRefundId} reported FAILED by gateway — reversing`
        });
    }

    await refundProjector.project({ orderId: refund.orderId, log });

    await writeAudit({
        action: `refund.webhook.${incomingState}`,
        refund,
        order: { _id: refund.orderId },
        admin: { email: 'system', role: 'system' },
        before: { state: before },
        after: { state: refund.state },
        metadata: { gatewayStatus, gatewayEvent: event }
    });

    log.info(
        {
            event: 'refund_webhook_applied',
            refundId: String(refund._id),
            from: before,
            to: refund.state
        },
        'Webhook applied to refund'
    );

    return refund;
};

/**
 * Retry a failed refund. Used by the retry job and by the admin
 * "retry now" action.
 */
const retry = async ({ refundId, log = refundLogger }) => {
    const refund = await findRefundOrThrow(refundId);

    if (refund.state !== RefundState.FAILED) {
        throw new RefundError(`Only FAILED refunds can be retried (got ${refund.state})`, {
            statusCode: 409,
            code: 'REFUND_NOT_RETRYABLE'
        });
    }

    if (refund.channel === 'bank_transfer') {
        throw new RefundError('Manual bank-transfer refunds cannot be retried automatically', {
            statusCode: 409,
            code: 'REFUND_MANUAL_NOT_RETRYABLE'
        });
    }

    const order = await orderModel.findById(refund.orderId);
    if (!order) {
        throw new RefundNotFoundError(`Order ${refund.orderId} not found`);
    }

    const maxRetries = refund.maxRetries ?? MAX_RETRIES_DEFAULT;
    if (refund.retryCount >= maxRetries) {
        transitionRefundState(refund, RefundState.PERMANENTLY_FAILED);
        await refund.save();
        await refundProjector.project({ orderId: refund.orderId, log });
        await writeAudit({
            action: 'refund.permanently_failed',
            refund,
            order,
            admin: { email: 'system', role: 'system' },
            after: { state: refund.state, retryCount: refund.retryCount }
        });
        log.error(
            {
                event: 'refund_permanently_failed',
                refundId: String(refund._id),
                retryCount: refund.retryCount,
                maxRetries
            },
            'Refund moved to PERMANENTLY_FAILED — manual intervention required'
        );
        return refund;
    }

    refund.retryCount = (refund.retryCount || 0) + 1;
    transitionRefundState(refund, RefundState.PENDING);
    await refund.save();

    const { strategy } = chooseStrategy(order);
    try {
        const strategyResult = await strategy.execute({
            refund,
            order,
            idempotencyKey: `${refund.idempotencyKey}:retry:${refund.retryCount}`,
            log
        });

        refund.gatewayRefundId = strategyResult.gatewayRefundId || refund.gatewayRefundId;
        refund.metadata = {
            ...(refund.metadata || {}),
            lastRetryRaw: strategyResult.raw
        };
        await refund.save();

        await refundProjector.project({ orderId: refund.orderId, log });

        await writeAudit({
            action: 'refund.retry_succeeded',
            refund,
            order,
            admin: { email: 'system', role: 'system' },
            after: { retryCount: refund.retryCount, state: refund.state }
        });

        log.info(
            {
                event: 'refund_retry_succeeded',
                refundId: String(refund._id),
                retryCount: refund.retryCount
            },
            'Refund retry succeeded'
        );
        return refund;
    } catch (error) {
        refund.failureReason = error?.message || 'Refund retry failed';
        refund.nextRetryAt = computeNextRetryAt(refund.retryCount);
        if (canTransition(refund.state, RefundState.FAILED)) {
            transitionRefundState(refund, RefundState.FAILED);
        }
        await refund.save();

        await writeAudit({
            action: 'refund.retry_failed',
            refund,
            order,
            admin: { email: 'system', role: 'system' },
            after: {
                retryCount: refund.retryCount,
                failureReason: refund.failureReason,
                nextRetryAt: refund.nextRetryAt
            }
        });

        log.warn(
            {
                event: 'refund_retry_failed',
                refundId: String(refund._id),
                retryCount: refund.retryCount,
                err: refund.failureReason,
                gatewayError: error instanceof GatewayError
            },
            'Refund retry failed'
        );

        // Re-throw so the job/loop can decide what to do.
        if (isRefundError(error)) throw error;
        throw new GatewayError(error?.message || 'Refund retry failed', {
            retryable: true,
            cause: error
        });
    }
};

export {
    initiateRefund,
    markManualRefundProcessed,
    processWebhookUpdate,
    retry,
    // Exposed for tests & jobs only:
    computeNextRetryAt,
    releaseRefundableAmount,
    reserveRefundableAmount
};

// Convenience helpers for callers that prefer rupees ergonomics.
export const initiateRefundFromRupees = (dto) =>
    initiateRefund({
        ...dto,
        amountInPaise: paiseFromOrderRupees(dto.amountInRupees)
    });

export const refundAmountToRupees = (refund) =>
    refund?.amountInPaise ? paiseToRupees(refund.amountInPaise) : 0;

// Defensive constant exports for downstream code.
export const REFUND_RETRY_BACKOFF_BASE_MS = RETRY_BACKOFF_BASE_MS;
export const REFUND_MAX_RETRIES_DEFAULT = MAX_RETRIES_DEFAULT;

// Re-export for ergonomics.
export { safePaiseAdd };
