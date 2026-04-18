import crypto from 'crypto';
import logger from '../config/logger.js';
import orderModel from '../models/orderModel.js';
import shiprocketWebhookEventModel from '../models/shiprocketWebhookEventModel.js';
import { shiprocketWebhookSchema } from '../validation/schemas.js';
import { buildShiprocketWebhookEventKey, SHIPROCKET_SYNC_STATUS } from './shiprocketService.js';
import {
    applyOrderStatusTransition,
    isFinalizedOrderStatus,
    normalizeOrderStatus
} from './orderStatusService.js';
import { runBackgroundTask } from './backgroundTaskService.js';
import {
    acquireDistributedLock,
    getDistributedLock,
    releaseDistributedLock
} from './distributedLockService.js';
import {
    getSystemJobState,
    markSystemJobCompleted,
    markSystemJobFailed,
    markSystemJobSkipped,
    markSystemJobStarted
} from './systemJobStateService.js';

const PROCESSING_STATUS = {
    queued: 'queued',
    processing: 'processing',
    processed: 'processed',
    ignored: 'ignored',
    unmatched: 'unmatched',
    failed: 'failed'
};

const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;
const DRAIN_LOCK_KEY = 'shiprocket_webhook_drain';
const DEFAULT_DRAIN_BATCH_SIZE = 25;
const MAX_DRAIN_BATCH_SIZE = 100;
const DEFAULT_DRAIN_TIME_BUDGET_MS = 15_000;
const MAX_DRAIN_TIME_BUDGET_MS = 25_000;
const DEFAULT_DRAIN_LOCK_TTL_MS = 45_000;
const DEFAULT_PROCESSING_STALE_AFTER_MS = 5 * 60 * 1000;
const SHIPROCKET_DRAIN_JOB_KEY = 'shiprocket_webhook_drain_job';
const SENSITIVE_HEADER_NAMES = new Set([
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-shiprocket-token',
    'x-shiprocket-secret',
    'x-webhook-token'
]);

const normalizeText = (value) => String(value || '').trim();
const normalizeUpper = (value) => normalizeText(value).toUpperCase();
const normalizeNumber = (value) => {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
};
const parsePositiveInteger = (value, fallbackValue) => {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? Math.floor(parsedValue) : fallbackValue;
};
const clampPositiveInteger = (value, fallbackValue, maxValue) =>
    Math.min(maxValue, parsePositiveInteger(value, fallbackValue));
const buildPayloadHash = (payload = {}) =>
    crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

const buildWebhookLogger = ({ log, eventKey = '', requestId = '' } = {}) => {
    if (log?.child) {
        return log.child({
            integration: 'shiprocket_webhook',
            eventKey,
            requestId
        });
    }

    return logger.child({
        integration: 'shiprocket_webhook',
        eventKey,
        requestId
    });
};

const getProcessedOutcomeCount = (outcomes = {}) =>
    Object.values(outcomes).reduce((totalCount, currentCount) => totalCount + Number(currentCount || 0), 0);

const serializeLockState = (lock) => {
    if (!lock) {
        return null;
    }

    return {
        key: lock.key,
        ownerId: lock.ownerId,
        expiresAt: lock.expiresAt,
        metadata: lock.metadata || null
    };
};

const secureCompare = (leftValue, rightValue) => {
    const leftBuffer = Buffer.from(String(leftValue || ''), 'utf8');
    const rightBuffer = Buffer.from(String(rightValue || ''), 'utf8');

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const getConfiguredShiprocketWebhookApiKey = () =>
    normalizeText(
        process.env.SHIPROCKET_WEBHOOK_API_KEY ||
            process.env.SHIPROCKET_WEBHOOK_TOKEN ||
            process.env.SHIPROCKET_WEBHOOK_SECRET
    );

const getShiprocketWebhookDrainConfig = (overrides = {}) => {
    const batchSize = clampPositiveInteger(
        overrides.batchSize ?? process.env.SHIPROCKET_WEBHOOK_DRAIN_BATCH_SIZE,
        DEFAULT_DRAIN_BATCH_SIZE,
        MAX_DRAIN_BATCH_SIZE
    );
    const timeBudgetMs = clampPositiveInteger(
        overrides.timeBudgetMs ?? process.env.SHIPROCKET_WEBHOOK_DRAIN_TIME_BUDGET_MS,
        DEFAULT_DRAIN_TIME_BUDGET_MS,
        MAX_DRAIN_TIME_BUDGET_MS
    );
    const processingStaleAfterMs = parsePositiveInteger(
        overrides.processingStaleAfterMs ?? process.env.SHIPROCKET_WEBHOOK_PROCESSING_STALE_AFTER_MS,
        DEFAULT_PROCESSING_STALE_AFTER_MS
    );
    const configuredLockTtlMs = parsePositiveInteger(
        overrides.lockTtlMs ?? process.env.SHIPROCKET_WEBHOOK_DRAIN_LOCK_TTL_MS,
        DEFAULT_DRAIN_LOCK_TTL_MS
    );

    return {
        batchSize,
        timeBudgetMs,
        processingStaleAfterMs,
        lockTtlMs: Math.max(configuredLockTtlMs, timeBudgetMs + 5_000)
    };
};

const sanitizeWebhookHeaders = (headers = {}) =>
    Object.entries(headers || {}).reduce((accumulator, [headerName, headerValue]) => {
        const normalizedHeaderName = String(headerName || '').toLowerCase();
        const serializedValue = Array.isArray(headerValue)
            ? headerValue.map((value) => normalizeText(value)).filter(Boolean).join(', ')
            : normalizeText(headerValue);

        if (!normalizedHeaderName || !serializedValue) {
            return accumulator;
        }

        accumulator[normalizedHeaderName] = SENSITIVE_HEADER_NAMES.has(normalizedHeaderName)
            ? '[REDACTED]'
            : serializedValue;

        return accumulator;
    }, {});

const isShiprocketWebhookAuthorized = (req) => {
    const configuredApiKey = getConfiguredShiprocketWebhookApiKey();

    if (!configuredApiKey) {
        return true;
    }

    const receivedApiKey = normalizeText(req?.headers?.['x-api-key']);

    if (!receivedApiKey) {
        return false;
    }

    return secureCompare(receivedApiKey, configuredApiKey);
};

const extractShiprocketWebhookPayload = (payload = {}) => {
    const parsedPayload = shiprocketWebhookSchema.safeParse(payload);

    if (!parsedPayload.success) {
        const error = new Error('Invalid Shiprocket webhook payload');
        error.statusCode = 400;
        throw error;
    }

    const source =
        parsedPayload.data?.data && typeof parsedPayload.data.data === 'object'
            ? parsedPayload.data.data
            : parsedPayload.data;

    return {
        eventName: normalizeText(
            source?.event ||
                parsedPayload.data?.event ||
                source?.event_name ||
                parsedPayload.data?.event_name ||
                source?.webhook_event
        ),
        shipmentId: normalizeNumber(
            source?.shipment_id ||
                source?.shipmentId ||
                source?.shipment?.id
        ),
        shiprocketOrderId: normalizeNumber(
            source?.order_id ||
                source?.shiprocket_order_id ||
                source?.order?.id
        ),
        referenceOrderId: normalizeText(
            source?.channel_order_id ||
                source?.reference_order_id ||
                source?.order_number ||
                source?.order_id_text ||
                source?.order?.channel_order_id
        ),
        awbCode: normalizeText(
            source?.awb_code ||
                source?.awb ||
                source?.shipment?.awb
        ),
        currentStatus: normalizeText(
            source?.current_status ||
                source?.status ||
                source?.shipment_status ||
                parsedPayload.data?.current_status
        ),
        currentStatusCode: normalizeNumber(
            source?.current_status_id ||
                source?.status_code ||
                source?.shipment_status_id ||
                parsedPayload.data?.current_status_id
        ),
        occurredAt: normalizeText(
            source?.event_time ||
                source?.timestamp ||
                source?.updated_at ||
                source?.occurred_at
        ),
        rawPayload: parsedPayload.data
    };
};

const extractShiprocketWebhookPayloadSafely = (payload = {}) => {
    try {
        return {
            ...extractShiprocketWebhookPayload(payload),
            isValid: true
        };
    } catch (error) {
        return {
            eventName: '',
            shipmentId: null,
            shiprocketOrderId: null,
            referenceOrderId: '',
            awbCode: '',
            currentStatus: '',
            currentStatusCode: null,
            occurredAt: '',
            rawPayload: payload,
            isValid: false,
            validationError: error?.message || 'Invalid Shiprocket webhook payload'
        };
    }
};

const resolveShiprocketLocalStatus = ({ eventName = '', currentStatus = '' } = {}) => {
    const normalizedSignals = [eventName, currentStatus]
        .map(normalizeUpper)
        .filter(Boolean)
        .join(' ');

    if (!normalizedSignals) {
        return null;
    }

    if (normalizedSignals.includes('OUT FOR DELIVERY')) {
        return 'Out for delivery';
    }

    if (normalizedSignals.includes('DELIVERED')) {
        return 'Delivered';
    }

    if (normalizedSignals.includes('CANCELLED') || normalizedSignals.includes('CANCELED')) {
        return 'Cancelled';
    }

    if (
        normalizedSignals.includes('SHIPPED') ||
        normalizedSignals.includes('IN TRANSIT') ||
        normalizedSignals.includes('DISPATCH')
    ) {
        return 'Shipped';
    }

    return null;
};

const buildShiprocketWebhookUpdateSet = ({ existingOrder, webhookPayload }) => ({
    'shiprocket.syncStatus': SHIPROCKET_SYNC_STATUS.synced,
    'shiprocket.referenceOrderId':
        normalizeText(webhookPayload.referenceOrderId) ||
        normalizeText(existingOrder?.shiprocket?.referenceOrderId),
    'shiprocket.orderId':
        webhookPayload.shiprocketOrderId ??
        existingOrder?.shiprocket?.orderId ??
        null,
    'shiprocket.shipmentId':
        webhookPayload.shipmentId ??
        existingOrder?.shiprocket?.shipmentId ??
        null,
    'shiprocket.awbCode':
        normalizeText(webhookPayload.awbCode) ||
        normalizeText(existingOrder?.shiprocket?.awbCode),
    'shiprocket.status':
        normalizeText(webhookPayload.currentStatus) ||
        normalizeText(webhookPayload.eventName) ||
        normalizeText(existingOrder?.shiprocket?.status),
    'shiprocket.statusCode':
        webhookPayload.currentStatusCode ??
        existingOrder?.shiprocket?.statusCode ??
        null,
    'shiprocket.currentStatus':
        normalizeText(webhookPayload.currentStatus) ||
        normalizeText(webhookPayload.eventName) ||
        normalizeText(existingOrder?.shiprocket?.currentStatus),
    'shiprocket.currentStatusCode':
        webhookPayload.currentStatusCode ??
        existingOrder?.shiprocket?.currentStatusCode ??
        null,
    'shiprocket.lastWebhookAt': Date.now(),
    'shiprocket.lastError': ''
});

const findOrderForShiprocketWebhook = async ({
    shipmentId,
    shiprocketOrderId,
    awbCode,
    referenceOrderId
}) => {
    if (shipmentId) {
        const order = await orderModel.findOne({ 'shiprocket.shipmentId': shipmentId });
        if (order) {
            return order;
        }
    }

    if (shiprocketOrderId) {
        const order = await orderModel.findOne({ 'shiprocket.orderId': shiprocketOrderId });
        if (order) {
            return order;
        }
    }

    if (awbCode) {
        const order = await orderModel.findOne({ 'shiprocket.awbCode': awbCode });
        if (order) {
            return order;
        }
    }

    if (referenceOrderId) {
        return orderModel.findOne({ 'shiprocket.referenceOrderId': referenceOrderId });
    }

    return null;
};

const computeNextRetryAt = (attemptCount) => {
    if (attemptCount >= MAX_RETRY_ATTEMPTS) {
        return null;
    }

    const retryDelayMs = Math.min(
        MAX_RETRY_DELAY_MS,
        RETRY_BASE_DELAY_MS * (2 ** Math.max(attemptCount - 1, 0))
    );

    return new Date(Date.now() + retryDelayMs);
};

const buildRetryDueQuery = (now) => ({
    processingAttempts: { $lt: MAX_RETRY_ATTEMPTS },
    $or: [
        { nextRetryAt: { $exists: false } },
        { nextRetryAt: null },
        { nextRetryAt: { $lte: now } }
    ]
});

const buildDrainEligibilityQuery = ({ now = new Date(), processingStaleAfterMs } = {}) => {
    const staleThreshold = new Date(now.getTime() - processingStaleAfterMs);

    return {
        provider: 'shiprocket',
        $or: [
            {
                processingStatus: PROCESSING_STATUS.queued
            },
            {
                processingStatus: { $in: [PROCESSING_STATUS.failed, PROCESSING_STATUS.unmatched] },
                ...buildRetryDueQuery(now)
            },
            {
                processingStatus: PROCESSING_STATUS.processing,
                processingAttempts: { $lt: MAX_RETRY_ATTEMPTS },
                $or: [
                    { lastProcessingStartedAt: { $exists: false } },
                    { lastProcessingStartedAt: null },
                    { lastProcessingStartedAt: { $lte: staleThreshold } }
                ]
            }
        ]
    };
};

const recordShiprocketWebhookEvent = async ({ payload, headers, requestId, log } = {}) => {
    const sanitizedHeaders = sanitizeWebhookHeaders(headers);
    const normalizedPayload = extractShiprocketWebhookPayloadSafely(payload);
    const eventKey = buildShiprocketWebhookEventKey(normalizedPayload.rawPayload);
    const payloadHash = buildPayloadHash(normalizedPayload.rawPayload);
    const webhookLog = buildWebhookLogger({
        log,
        eventKey,
        requestId
    });

    webhookLog.info(
        {
            headers: sanitizedHeaders,
            payload: normalizedPayload.rawPayload,
            payloadHash,
            shipmentId: normalizedPayload.shipmentId,
            shiprocketOrderId: normalizedPayload.shiprocketOrderId,
            awbCode: normalizedPayload.awbCode,
            referenceOrderId: normalizedPayload.referenceOrderId
        },
        'Accepted Shiprocket webhook request'
    );

    try {
        const event = await shiprocketWebhookEventModel.create({
            provider: 'shiprocket',
            eventKey,
            shipmentId: normalizedPayload.shipmentId,
            orderId: normalizedPayload.shiprocketOrderId,
            awbCode: normalizedPayload.awbCode,
            referenceOrderId: normalizedPayload.referenceOrderId,
            eventName: normalizedPayload.eventName,
            status: normalizedPayload.currentStatus || normalizedPayload.eventName,
            payloadHash,
            rawPayload: normalizedPayload.rawPayload,
            requestId: normalizeText(requestId),
            requestHeaders: sanitizedHeaders,
            processingStatus: PROCESSING_STATUS.queued,
            lastError: normalizedPayload.isValid ? '' : normalizeText(normalizedPayload.validationError)
        });

        return {
            accepted: true,
            duplicate: false,
            eventId: String(event._id),
            eventKey
        };
    } catch (error) {
        if (error?.code === 11000) {
            webhookLog.info({ eventKey }, 'Skipping duplicate Shiprocket webhook event');
            return {
                accepted: true,
                duplicate: true,
                eventId: '',
                eventKey
            };
        }

        throw error;
    }
};

const claimQueuedWebhookEvent = async ({ eventId = '', processingStaleAfterMs = DEFAULT_PROCESSING_STALE_AFTER_MS } = {}) => {
    const now = new Date();
    const baseQuery = buildDrainEligibilityQuery({
        now,
        processingStaleAfterMs
    });

    if (eventId) {
        baseQuery._id = eventId;
    }

    return shiprocketWebhookEventModel.findOneAndUpdate(
        baseQuery,
        {
            $set: {
                processingStatus: PROCESSING_STATUS.processing,
                lastProcessingStartedAt: now,
                nextRetryAt: null
            },
            $inc: {
                processingAttempts: 1
            }
        },
        {
            new: true,
            sort: {
                receivedAt: 1
            }
        }
    );
};

const finalizeWebhookEvent = async (eventId, updateSet = {}) =>
    shiprocketWebhookEventModel.findByIdAndUpdate(
        eventId,
        {
            $set: {
                ...updateSet,
                nextRetryAt: updateSet.nextRetryAt ?? null,
                processedAt: updateSet.processedAt || new Date()
            }
        },
        { new: true }
    );

const processClaimedWebhookEvent = async (eventRecord, { log } = {}) => {
    const webhookLog = buildWebhookLogger({
        log,
        eventKey: eventRecord?.eventKey,
        requestId: eventRecord?.requestId
    });

    try {
        const webhookPayload = extractShiprocketWebhookPayloadSafely(eventRecord?.rawPayload || {});

        if (!webhookPayload.isValid) {
            webhookLog.warn(
                {
                    validationError: webhookPayload.validationError
                },
                'Ignoring Shiprocket webhook because the payload shape is invalid'
            );

            await finalizeWebhookEvent(eventRecord._id, {
                processingStatus: PROCESSING_STATUS.ignored,
                matchedOrderId: '',
                localStatus: '',
                lastError: normalizeText(webhookPayload.validationError)
            });
            return {
                outcome: PROCESSING_STATUS.ignored,
                retryScheduled: false
            };
        }

        const existingOrder = await findOrderForShiprocketWebhook({
            shipmentId: webhookPayload.shipmentId,
            shiprocketOrderId: webhookPayload.shiprocketOrderId,
            awbCode: webhookPayload.awbCode,
            referenceOrderId: webhookPayload.referenceOrderId
        });

        if (!existingOrder) {
            const processingAttempts = Number(eventRecord?.processingAttempts || 0);
            const nextRetryAt = computeNextRetryAt(processingAttempts);

            webhookLog.warn(
                {
                    shipmentId: webhookPayload.shipmentId,
                    shiprocketOrderId: webhookPayload.shiprocketOrderId,
                    awbCode: webhookPayload.awbCode,
                    referenceOrderId: webhookPayload.referenceOrderId,
                    processingAttempts,
                    nextRetryAt
                },
                'Shiprocket webhook could not be matched to a local order'
            );

            await finalizeWebhookEvent(eventRecord._id, {
                processingStatus: PROCESSING_STATUS.unmatched,
                matchedOrderId: '',
                localStatus: '',
                lastError: 'Shiprocket webhook could not yet be matched to a local order',
                nextRetryAt
            });
            return {
                outcome: PROCESSING_STATUS.unmatched,
                retryScheduled: Boolean(nextRetryAt)
            };
        }

        const shiprocketUpdateSet = buildShiprocketWebhookUpdateSet({
            existingOrder,
            webhookPayload
        });
        const localStatus = resolveShiprocketLocalStatus(webhookPayload);

        if (!localStatus) {
            await orderModel.findByIdAndUpdate(existingOrder._id, {
                $set: shiprocketUpdateSet
            });

            await finalizeWebhookEvent(eventRecord._id, {
                processingStatus: PROCESSING_STATUS.processed,
                matchedOrderId: String(existingOrder._id),
                localStatus: '',
                lastError: ''
            });
            return {
                outcome: PROCESSING_STATUS.processed,
                retryScheduled: false
            };
        }

        if (
            isFinalizedOrderStatus(existingOrder.status) &&
            normalizeOrderStatus(existingOrder.status) !== normalizeOrderStatus(localStatus)
        ) {
            await orderModel.findByIdAndUpdate(existingOrder._id, {
                $set: shiprocketUpdateSet
            });

            webhookLog.info(
                {
                    orderId: String(existingOrder._id),
                    existingStatus: existingOrder.status,
                    webhookStatus: localStatus
                },
                'Ignored stale Shiprocket webhook status after a local final state was reached'
            );

            await finalizeWebhookEvent(eventRecord._id, {
                processingStatus: PROCESSING_STATUS.ignored,
                matchedOrderId: String(existingOrder._id),
                localStatus,
                lastError: ''
            });
            return {
                outcome: PROCESSING_STATUS.ignored,
                retryScheduled: false
            };
        }

        try {
            await applyOrderStatusTransition({
                existingOrder,
                status: localStatus,
                source: 'shiprocketWebhookService.processClaimedWebhookEvent',
                log: webhookLog,
                additionalSet: shiprocketUpdateSet
            });

            await finalizeWebhookEvent(eventRecord._id, {
                processingStatus: PROCESSING_STATUS.processed,
                matchedOrderId: String(existingOrder._id),
                localStatus,
                lastError: ''
            });
            return {
                outcome: PROCESSING_STATUS.processed,
                retryScheduled: false
            };
        } catch (error) {
            if (Number(error?.statusCode) === 400) {
                await orderModel.findByIdAndUpdate(existingOrder._id, {
                    $set: shiprocketUpdateSet
                });

                webhookLog.info(
                    {
                        orderId: String(existingOrder._id),
                        errorMessage: error?.message || 'Shiprocket webhook transition skipped'
                    },
                    'Shiprocket webhook updated integration fields but skipped local status transition'
                );

                await finalizeWebhookEvent(eventRecord._id, {
                    processingStatus: PROCESSING_STATUS.ignored,
                    matchedOrderId: String(existingOrder._id),
                    localStatus,
                    lastError: ''
                });
                return {
                    outcome: PROCESSING_STATUS.ignored,
                    retryScheduled: false
                };
            }

            throw error;
        }
    } catch (error) {
        const processingAttempts = Number(eventRecord?.processingAttempts || 0);
        const nextRetryAt = computeNextRetryAt(processingAttempts);

        webhookLog.error(
            {
                err: error,
                errorMessage: error?.message || 'Shiprocket webhook processing failed',
                processingAttempts,
                nextRetryAt
            },
            'Shiprocket webhook processing failed'
        );

        await shiprocketWebhookEventModel.findByIdAndUpdate(eventRecord._id, {
            $set: {
                processingStatus: PROCESSING_STATUS.failed,
                lastError: normalizeText(error?.message || 'Shiprocket webhook processing failed'),
                nextRetryAt
            }
        });

        return {
            outcome: PROCESSING_STATUS.failed,
            retryScheduled: Boolean(nextRetryAt)
        };
    }
};

const processShiprocketWebhookEventById = async ({ eventId, log } = {}) => {
    if (!eventId) {
        return null;
    }

    const eventRecord = await claimQueuedWebhookEvent({ eventId });

    if (!eventRecord) {
        return null;
    }

    return processClaimedWebhookEvent(eventRecord, { log });
};

const getShiprocketWebhookQueueMetrics = async ({
    processingStaleAfterMs = DEFAULT_PROCESSING_STALE_AFTER_MS
} = {}) => {
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - processingStaleAfterMs);
    const retryDueQuery = buildRetryDueQuery(now);

    const [
        totalOpenCount,
        readyCount,
        queuedCount,
        failedRetryableCount,
        unmatchedRetryableCount,
        processingActiveCount,
        processingStaleCount,
        exhaustedCount
    ] = await Promise.all([
        shiprocketWebhookEventModel.countDocuments({
            provider: 'shiprocket',
            processingStatus: {
                $in: [PROCESSING_STATUS.queued, PROCESSING_STATUS.processing, PROCESSING_STATUS.failed, PROCESSING_STATUS.unmatched]
            }
        }),
        shiprocketWebhookEventModel.countDocuments(
            buildDrainEligibilityQuery({
                now,
                processingStaleAfterMs
            })
        ),
        shiprocketWebhookEventModel.countDocuments({
            provider: 'shiprocket',
            processingStatus: PROCESSING_STATUS.queued
        }),
        shiprocketWebhookEventModel.countDocuments({
            provider: 'shiprocket',
            processingStatus: PROCESSING_STATUS.failed,
            ...retryDueQuery
        }),
        shiprocketWebhookEventModel.countDocuments({
            provider: 'shiprocket',
            processingStatus: PROCESSING_STATUS.unmatched,
            ...retryDueQuery
        }),
        shiprocketWebhookEventModel.countDocuments({
            provider: 'shiprocket',
            processingStatus: PROCESSING_STATUS.processing,
            lastProcessingStartedAt: { $gt: staleThreshold }
        }),
        shiprocketWebhookEventModel.countDocuments({
            provider: 'shiprocket',
            processingStatus: PROCESSING_STATUS.processing,
            $or: [
                { lastProcessingStartedAt: { $exists: false } },
                { lastProcessingStartedAt: null },
                { lastProcessingStartedAt: { $lte: staleThreshold } }
            ]
        }),
        shiprocketWebhookEventModel.countDocuments({
            provider: 'shiprocket',
            processingStatus: { $in: [PROCESSING_STATUS.failed, PROCESSING_STATUS.unmatched] },
            processingAttempts: { $gte: MAX_RETRY_ATTEMPTS }
        })
    ]);

    return {
        totalOpenCount,
        readyCount,
        queuedCount,
        failedRetryableCount,
        unmatchedRetryableCount,
        processingActiveCount,
        processingStaleCount,
        exhaustedCount
    };
};

const getShiprocketWebhookStatus = async ({
    processingStaleAfterMs = DEFAULT_PROCESSING_STALE_AFTER_MS
} = {}) => {
    const [queueMetrics, drainLock, lastDrainRun] = await Promise.all([
        getShiprocketWebhookQueueMetrics({
            processingStaleAfterMs
        }),
        getDistributedLock(DRAIN_LOCK_KEY),
        getSystemJobState(SHIPROCKET_DRAIN_JOB_KEY)
    ]);
    const now = Date.now();
    const lockExpiresAtMs = drainLock?.expiresAt ? new Date(drainLock.expiresAt).getTime() : 0;
    const isLockActive = Boolean(drainLock?.ownerId) && lockExpiresAtMs > now;
    const serializedLock = serializeLockState(drainLock);

    return {
        queue: {
            pendingEvents: queueMetrics.queuedCount,
            processingEvents: queueMetrics.processingActiveCount + queueMetrics.processingStaleCount,
            readyEvents: queueMetrics.readyCount,
            retryableFailedEvents: queueMetrics.failedRetryableCount,
            retryableUnmatchedEvents: queueMetrics.unmatchedRetryableCount,
            exhaustedEvents: queueMetrics.exhaustedCount,
            openEvents: queueMetrics.totalOpenCount
        },
        drain: {
            config: getShiprocketWebhookDrainConfig({
                processingStaleAfterMs
            }),
            lock: serializedLock
                ? {
                    active: isLockActive,
                    ...serializedLock
                }
                : {
                    active: false,
                    key: '',
                    ownerId: '',
                    expiresAt: null,
                    metadata: null
                },
            lastRun: lastDrainRun
                ? {
                    status: lastDrainRun.lastRunStatus || 'idle',
                    startedAt: lastDrainRun.lastRunStartedAt || null,
                    finishedAt: lastDrainRun.lastRunFinishedAt || null,
                    successfulAt: lastDrainRun.lastSuccessfulRunAt || null,
                    failedAt: lastDrainRun.lastFailedRunAt || null,
                    skippedAt: lastDrainRun.lastSkippedRunAt || null,
                    durationMs: Number(lastDrainRun.lastRunDurationMs || 0),
                    claimedCount: Number(lastDrainRun.lastClaimedCount || 0),
                    processedCount: Number(lastDrainRun.lastProcessedCount || 0),
                    retryScheduledCount: Number(lastDrainRun.lastRetryScheduledCount || 0),
                    trigger: lastDrainRun.lastTrigger || '',
                    requestedBy: lastDrainRun.lastRequestedBy || '',
                    error: lastDrainRun.lastError || '',
                    result: lastDrainRun.lastRunResult || null
                }
                : null,
            lastDrainRunTimestamp:
                lastDrainRun?.lastRunFinishedAt ||
                lastDrainRun?.lastSuccessfulRunAt ||
                lastDrainRun?.lastRunStartedAt ||
                null
        }
    };
};

const drainQueuedShiprocketWebhookEvents = async ({
    limit = DEFAULT_DRAIN_BATCH_SIZE,
    timeBudgetMs = DEFAULT_DRAIN_TIME_BUDGET_MS,
    processingStaleAfterMs = DEFAULT_PROCESSING_STALE_AFTER_MS,
    log
} = {}) => {
    const drainStartedAt = Date.now();
    const outcomes = {
        processed: 0,
        ignored: 0,
        unmatched: 0,
        failed: 0
    };
    let claimedCount = 0;
    let retryScheduledCount = 0;

    for (let index = 0; index < limit; index += 1) {
        if (Date.now() - drainStartedAt >= timeBudgetMs) {
            break;
        }

        const eventRecord = await claimQueuedWebhookEvent({
            processingStaleAfterMs
        });

        if (!eventRecord) {
            break;
        }

        claimedCount += 1;
        const result = await processClaimedWebhookEvent(eventRecord, { log });
        const outcome = result?.outcome || PROCESSING_STATUS.failed;

        outcomes[outcome] = Number(outcomes[outcome] || 0) + 1;

        if (result?.retryScheduled) {
            retryScheduledCount += 1;
        }
    }

    const durationMs = Date.now() - drainStartedAt;

    return {
        claimedCount,
        outcomes,
        retryScheduledCount,
        durationMs,
        timedOut: durationMs >= timeBudgetMs,
        batchLimitReached: claimedCount >= limit
    };
};

const runShiprocketWebhookDrain = async ({
    trigger = 'cron',
    requestedBy = '',
    overrides = {},
    log
} = {}) => {
    const config = getShiprocketWebhookDrainConfig(overrides);
    const lockOwnerId = crypto.randomUUID();
    const requestedByText = normalizeText(requestedBy);
    const drainLog = buildWebhookLogger({
        log,
        eventKey: '',
        requestId: ''
    }).child({
        action: 'drain_shiprocket_webhooks',
        trigger
    });
    const lockResult = await acquireDistributedLock({
        key: DRAIN_LOCK_KEY,
        ownerId: lockOwnerId,
        ttlMs: config.lockTtlMs,
        metadata: {
            trigger,
            requestedBy: requestedByText
        }
    });

    if (!lockResult.acquired) {
        const currentLock = lockResult.lock || (await getDistributedLock(DRAIN_LOCK_KEY));
        const skipResult = {
            success: true,
            skipped: true,
            reason: 'drain_locked',
            trigger,
            requestedBy: requestedByText,
            config,
            lock: serializeLockState(currentLock)
        };

        drainLog.info(skipResult, 'Skipped Shiprocket webhook drain because a lock is already active');
        await markSystemJobSkipped({
            jobKey: SHIPROCKET_DRAIN_JOB_KEY,
            provider: 'shiprocket',
            jobType: 'webhook_drain',
            trigger,
            requestedBy: requestedByText,
            config,
            reason: 'drain_locked',
            result: skipResult
        });

        return skipResult;
    }

    const runStartedAt = Date.now();
    const lockExpiresAt = new Date(runStartedAt + config.lockTtlMs);

    drainLog.info(
        {
            trigger,
            requestedBy: requestedByText,
            config,
            lockOwnerId
        },
        'Starting Shiprocket webhook drain run'
    );

    try {
        await markSystemJobStarted({
            jobKey: SHIPROCKET_DRAIN_JOB_KEY,
            provider: 'shiprocket',
            jobType: 'webhook_drain',
            trigger,
            requestedBy: requestedByText,
            ownerId: lockOwnerId,
            expiresAt: lockExpiresAt,
            config
        });

        const metricsBefore = await getShiprocketWebhookQueueMetrics({
            processingStaleAfterMs: config.processingStaleAfterMs
        });
        const drainResult = await drainQueuedShiprocketWebhookEvents({
            limit: config.batchSize,
            timeBudgetMs: config.timeBudgetMs,
            processingStaleAfterMs: config.processingStaleAfterMs,
            log: drainLog
        });
        const metricsAfter = await getShiprocketWebhookQueueMetrics({
            processingStaleAfterMs: config.processingStaleAfterMs
        });
        const responsePayload = {
            success: true,
            skipped: false,
            trigger,
            requestedBy: requestedByText,
            config,
            drainResult,
            metricsBefore,
            metricsAfter
        };

        await markSystemJobCompleted({
            jobKey: SHIPROCKET_DRAIN_JOB_KEY,
            provider: 'shiprocket',
            jobType: 'webhook_drain',
            trigger,
            requestedBy: requestedByText,
            config,
            metricsBefore,
            metricsAfter,
            result: responsePayload,
            durationMs: Date.now() - runStartedAt
        });

        drainLog.info(
            {
                trigger,
                requestedBy: requestedByText,
                config,
                drainResult,
                claimedCount: drainResult.claimedCount,
                handledEventCount: getProcessedOutcomeCount(drainResult.outcomes),
                metricsBefore,
                metricsAfter
            },
            'Completed Shiprocket webhook drain run'
        );

        return responsePayload;
    } catch (error) {
        const failureResult = {
            success: false,
            skipped: false,
            trigger,
            requestedBy: requestedByText,
            config,
            errorMessage: error?.message || 'Shiprocket webhook drain failed'
        };

        await markSystemJobFailed({
            jobKey: SHIPROCKET_DRAIN_JOB_KEY,
            provider: 'shiprocket',
            jobType: 'webhook_drain',
            trigger,
            requestedBy: requestedByText,
            config,
            result: failureResult,
            errorMessage: failureResult.errorMessage,
            durationMs: Date.now() - runStartedAt
        });

        drainLog.error(
            {
                err: error,
                errorMessage: failureResult.errorMessage,
                trigger,
                requestedBy: requestedByText,
                config
            },
            'Shiprocket webhook drain run failed'
        );

        throw error;
    } finally {
        await releaseDistributedLock({
            key: DRAIN_LOCK_KEY,
            ownerId: lockOwnerId,
            metadata: {
                trigger,
                requestedBy: requestedByText,
                releasedAt: new Date().toISOString()
            }
        }).catch((error) => {
            drainLog.warn(
                {
                    err: error,
                    errorMessage: error?.message || 'Failed to release Shiprocket drain lock'
                },
                'Failed to release Shiprocket webhook drain lock'
            );
        });
    }
};

const scheduleShiprocketWebhookProcessing = ({ eventId, waitUntil, log } = {}) =>
    runBackgroundTask(
        async () => {
            await processShiprocketWebhookEventById({ eventId, log });
            await drainQueuedShiprocketWebhookEvents({ limit: 2, log });
        },
        {
            taskName: 'shiprocket_webhook_processing',
            waitUntil,
            log
        }
    );

export {
    drainQueuedShiprocketWebhookEvents,
    getShiprocketWebhookDrainConfig,
    getShiprocketWebhookQueueMetrics,
    getShiprocketWebhookStatus,
    isShiprocketWebhookAuthorized,
    PROCESSING_STATUS as SHIPROCKET_WEBHOOK_PROCESSING_STATUS,
    recordShiprocketWebhookEvent,
    runShiprocketWebhookDrain,
    scheduleShiprocketWebhookProcessing,
    sanitizeWebhookHeaders
};
