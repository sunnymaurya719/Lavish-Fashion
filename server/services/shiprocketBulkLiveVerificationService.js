import crypto from 'crypto';
import orderModel from '../models/orderModel.js';
import { publishAdminOrderUpsert } from './realtimeService.js';
import {
    SHIPROCKET_SYNC_STATUS,
    decorateOrderWithShiprocketPricingAudit,
    isShiprocketThrottleError,
    verifyOrderPricingAgainstLiveShiprocket
} from './shiprocketService.js';
import {
    acquireDistributedLock,
    getDistributedLock,
    refreshDistributedLock,
    releaseDistributedLock
} from './distributedLockService.js';
import {
    getSystemJobState,
    markSystemJobCancelled,
    markSystemJobCompleted,
    markSystemJobFailed,
    markSystemJobSkipped,
    markSystemJobStarted,
    updateSystemJobState
} from './systemJobStateService.js';

const SHIPROCKET_BULK_VERIFY_JOB_KEY = 'shiprocket_live_pricing_bulk_verify_job';
const SHIPROCKET_BULK_VERIFY_LOCK_KEY = 'shiprocket_live_pricing_bulk_verify_lock';
const SHIPROCKET_BULK_VERIFY_PROVIDER = 'shiprocket';
const SHIPROCKET_BULK_VERIFY_JOB_TYPE = 'live_pricing_bulk_verify';
const DEFAULT_BULK_VERIFY_LIMIT = 50;
const MAX_BULK_VERIFY_LIMIT = 500;
const DEFAULT_BULK_VERIFY_REQUESTS_PER_MINUTE = 45;
const MAX_BULK_VERIFY_REQUESTS_PER_MINUTE = 180;
const DEFAULT_BULK_VERIFY_SCOPE = 'high_risk';
const DEFAULT_SELECTION_WINDOW = 250;
const MAX_SELECTION_WINDOW = 2500;
const MIN_LOCK_TTL_MS = 5 * 60 * 1000;
const LOCK_TTL_BUFFER_MS = 5 * 60 * 1000;
const JOB_STALE_GRACE_MS = 30 * 1000;
const HEARTBEAT_INTERVAL_MS = 5 * 1000;
const CANCELLATION_POLL_INTERVAL_MS = 1 * 1000;
const DEFAULT_THROTTLE_RETRY_LIMIT = 3;
const DEFAULT_THROTTLE_BACKOFF_BASE_MS = 5 * 1000;
const DEFAULT_THROTTLE_BACKOFF_MAX_MS = 60 * 1000;
const VALID_BULK_VERIFY_SCOPES = new Set(['high_risk', 'not_verified', 'all_synced']);

const normalizeText = (value) => String(value || '').trim();
const normalizeInteger = (value, fallbackValue = 0) => {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? Math.floor(parsedValue) : fallbackValue;
};
const clampInteger = (value, minimumValue, maximumValue, fallbackValue) => {
    const parsedValue = normalizeInteger(value, fallbackValue);
    return Math.min(maximumValue, Math.max(minimumValue, parsedValue));
};
const truncateText = (value, maxLength = 240) => {
    const normalizedValue = normalizeText(value);
    return normalizedValue.length > maxLength ? normalizedValue.slice(0, maxLength) : normalizedValue;
};
const sleep = (ms) =>
    new Promise((resolve) => {
        setTimeout(resolve, Math.max(0, normalizeInteger(ms, 0)));
    });

const createCancellationError = ({ cancelRequestedAt, cancelRequestedBy, cancelReason } = {}) => {
    const error = new Error(cancelReason || 'Shiprocket bulk live verification was cancelled');

    error.name = 'ShiprocketBulkVerifyCancelledError';
    error.isShiprocketBulkVerifyCancelled = true;
    error.cancelRequestedAt = cancelRequestedAt || null;
    error.cancelRequestedBy = cancelRequestedBy || '';
    error.cancelReason = cancelReason || '';

    return error;
};

const serializeLockState = (lock = null) => {
    if (!lock) {
        return null;
    }

    return {
        key: normalizeText(lock.key),
        ownerId: normalizeText(lock.ownerId),
        expiresAt: lock.expiresAt || null,
        lastAcquiredAt: lock.lastAcquiredAt || null,
        lastReleasedAt: lock.lastReleasedAt || null,
        metadata: lock.metadata || null
    };
};

const getShiprocketBulkVerifyConfig = (overrides = {}) => {
    const normalizedScope = normalizeText(overrides?.scope).toLowerCase();
    const scope = VALID_BULK_VERIFY_SCOPES.has(normalizedScope) ? normalizedScope : DEFAULT_BULK_VERIFY_SCOPE;
    const limit = clampInteger(
        overrides?.limit,
        1,
        MAX_BULK_VERIFY_LIMIT,
        DEFAULT_BULK_VERIFY_LIMIT
    );
    const requestsPerMinute = clampInteger(
        overrides?.requestsPerMinute,
        1,
        MAX_BULK_VERIFY_REQUESTS_PER_MINUTE,
        DEFAULT_BULK_VERIFY_REQUESTS_PER_MINUTE
    );
    const requestIntervalMs = Math.max(0, Math.ceil(60_000 / requestsPerMinute));
    const selectionWindow = Math.min(
        MAX_SELECTION_WINDOW,
        Math.max(DEFAULT_SELECTION_WINDOW, limit * 6)
    );
    const estimatedRunMs = limit * Math.max(2_000, requestIntervalMs * 2);

    return {
        scope,
        limit,
        requestsPerMinute,
        requestIntervalMs,
        selectionWindow,
        lockTtlMs: Math.max(MIN_LOCK_TTL_MS, estimatedRunMs + LOCK_TTL_BUFFER_MS),
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        cancellationPollIntervalMs: CANCELLATION_POLL_INTERVAL_MS,
        throttleRetryLimit: DEFAULT_THROTTLE_RETRY_LIMIT,
        throttleBackoffBaseMs: DEFAULT_THROTTLE_BACKOFF_BASE_MS,
        throttleBackoffMaxMs: DEFAULT_THROTTLE_BACKOFF_MAX_MS
    };
};

const buildBulkVerifyBaseQuery = () => ({
    'shiprocket.syncStatus': SHIPROCKET_SYNC_STATUS.synced,
    'shiprocket.orderId': { $gt: 0 }
});

const buildBulkVerifyPreFilterQuery = (scope) => {
    if (scope === 'not_verified') {
        return {
            $or: [
                { 'shiprocket.livePricingVerifiedAt': { $exists: false } },
                { 'shiprocket.livePricingVerifiedAt': null },
                { 'shiprocket.livePricingVerificationStatus': { $in: ['not_verified', 'failed'] } }
            ]
        };
    }

    if (scope === 'high_risk') {
        return {
            $or: [
                { 'shiprocket.pricingSnapshot': { $exists: false } },
                { 'shiprocket.pricingSnapshot': null },
                { 'shiprocket.livePricingVerifiedAt': { $exists: false } },
                { 'shiprocket.livePricingVerifiedAt': null },
                { 'shiprocket.livePricingVerificationStatus': { $in: ['warning', 'mismatch', 'failed'] } }
            ]
        };
    }

    return {};
};

const getAuditSeverityRank = (audit = {}) => {
    if (audit?.hasMismatch) {
        return 2;
    }

    if (audit?.hasWarning) {
        return 1;
    }

    return 0;
};

const shouldVerifyOrderForScope = (order, scope) => {
    const audit = decorateOrderWithShiprocketPricingAudit(order)?.shiprocketPricingAudit || {};

    if (scope === 'all_synced') {
        return true;
    }

    if (scope === 'not_verified') {
        return !order?.shiprocket?.livePricingVerifiedAt || audit?.liveVerification?.status === 'not_verified';
    }

    return audit.hasMismatch || audit.hasWarning;
};

const selectCandidateOrdersForBulkVerify = async (config = {}) => {
    const baseQuery = buildBulkVerifyBaseQuery();
    const preFilterQuery = buildBulkVerifyPreFilterQuery(config.scope);
    const combinedQuery =
        Object.keys(preFilterQuery).length > 0
            ? {
                ...baseQuery,
                ...preFilterQuery
            }
            : baseQuery;

    const candidateOrders = await orderModel
        .find(combinedQuery)
        .sort({ date: -1 })
        .limit(config.selectionWindow)
        .lean();
    const selectedOrders = [];
    const seenOrderIds = new Set();

    const appendEligibleOrders = (orders = []) => {
        for (const order of orders) {
            const orderId = normalizeText(order?._id);

            if (!orderId || seenOrderIds.has(orderId)) {
                continue;
            }

            if (!shouldVerifyOrderForScope(order, config.scope)) {
                continue;
            }

            seenOrderIds.add(orderId);
            selectedOrders.push(order);

            if (selectedOrders.length >= config.limit) {
                break;
            }
        }
    };

    const prioritizedOrders = [...candidateOrders].sort((leftOrder, rightOrder) => {
        const rightRank = getAuditSeverityRank(
            decorateOrderWithShiprocketPricingAudit(rightOrder)?.shiprocketPricingAudit
        );
        const leftRank = getAuditSeverityRank(
            decorateOrderWithShiprocketPricingAudit(leftOrder)?.shiprocketPricingAudit
        );

        return rightRank - leftRank;
    });

    appendEligibleOrders(prioritizedOrders);

    if (selectedOrders.length < config.limit && config.scope === 'high_risk') {
        const fallbackOrders = await orderModel
            .find(baseQuery)
            .sort({ date: -1 })
            .limit(config.selectionWindow)
            .lean();

        appendEligibleOrders(fallbackOrders);
    }

    return selectedOrders.slice(0, config.limit).map((order) => ({
        _id: String(order._id || ''),
        referenceOrderId: normalizeText(order?.shiprocket?.referenceOrderId),
        livePricingVerificationStatus: normalizeText(order?.shiprocket?.livePricingVerificationStatus),
        date: Number(order?.date || 0)
    }));
};

const buildProgressSnapshot = ({
    config,
    targetOrders,
    processedCount = 0,
    clearCount = 0,
    warningCount = 0,
    mismatchCount = 0,
    failedCount = 0,
    retryScheduledCount = 0,
    lastRetryDelayMs = 0,
    statusNote = '',
    currentOrderId = '',
    currentReferenceOrderId = '',
    lastProcessedOrderId = '',
    recentFailures = []
} = {}) => {
    const totalCount = Array.isArray(targetOrders) ? targetOrders.length : 0;
    const normalizedProcessedCount = Math.max(0, normalizeInteger(processedCount, 0));
    const remainingCount = Math.max(0, totalCount - normalizedProcessedCount);

    return {
        scope: normalizeText(config?.scope || DEFAULT_BULK_VERIFY_SCOPE),
        totalCount,
        processedCount: normalizedProcessedCount,
        remainingCount,
        clearCount: Math.max(0, normalizeInteger(clearCount, 0)),
        warningCount: Math.max(0, normalizeInteger(warningCount, 0)),
        mismatchCount: Math.max(0, normalizeInteger(mismatchCount, 0)),
        failedCount: Math.max(0, normalizeInteger(failedCount, 0)),
        retryScheduledCount: Math.max(0, normalizeInteger(retryScheduledCount, 0)),
        lastRetryDelayMs: Math.max(0, normalizeInteger(lastRetryDelayMs, 0)),
        successCount: Math.max(
            0,
            normalizeInteger(clearCount, 0) +
                normalizeInteger(warningCount, 0) +
                normalizeInteger(mismatchCount, 0)
        ),
        percentComplete: totalCount > 0 ? Math.round((normalizedProcessedCount / totalCount) * 100) : 0,
        statusNote: normalizeText(statusNote),
        currentOrderId: normalizeText(currentOrderId),
        currentReferenceOrderId: normalizeText(currentReferenceOrderId),
        lastProcessedOrderId: normalizeText(lastProcessedOrderId),
        recentFailures: Array.isArray(recentFailures) ? recentFailures.slice(-5) : []
    };
};

const extractCancellationState = (jobState = {}) => ({
    cancelRequestedAt: jobState?.lastRunResult?.cancelRequestedAt || null,
    cancelRequestedBy: normalizeText(jobState?.lastRunResult?.cancelRequestedBy),
    cancelReason: normalizeText(jobState?.lastRunResult?.cancelReason)
});

const persistRunningJobProgress = async ({
    config,
    progress,
    requestedBy = '',
    trigger = '',
    activeRunExpiresAt = null,
    cancellationState = null
} = {}) => {
    // `markSystemJobStarted` resets `lastRunResult` to `null` at the beginning
    // of every run, so dot-path `$set` updates such as
    // `lastRunResult.progress` would fail with "Cannot create field 'progress'
    // in element {lastRunResult: null}". Build the full sub-document once and
    // overwrite it atomically. Any cancellation flags already captured on the
    // job state are merged back in via `cancellationState`.
    const updatedAt = new Date().toISOString();
    const lastRunResult = {
        success: true,
        skipped: false,
        trigger: normalizeText(trigger),
        requestedBy: normalizeText(requestedBy),
        config,
        progress,
        updatedAt,
        ...(cancellationState?.cancelRequestedAt
            ? {
                cancelRequestedAt: cancellationState.cancelRequestedAt,
                cancelRequestedBy: normalizeText(cancellationState.cancelRequestedBy),
                cancelReason: normalizeText(cancellationState.cancelReason)
            }
            : {})
    };

    return updateSystemJobState({
        jobKey: SHIPROCKET_BULK_VERIFY_JOB_KEY,
        updateSet: {
            provider: SHIPROCKET_BULK_VERIFY_PROVIDER,
            jobType: SHIPROCKET_BULK_VERIFY_JOB_TYPE,
            lastRunStatus: 'running',
            lastClaimedCount: Number(progress?.totalCount || 0),
            lastProcessedCount: Number(progress?.processedCount || 0),
            lastRetryScheduledCount: Number(progress?.retryScheduledCount || 0),
            lastConfig: config,
            lastRunResult,
            activeRunExpiresAt: activeRunExpiresAt || null
        }
    });
};

const serializeShiprocketBulkVerifyJobState = (jobState = null) => {
    if (!jobState) {
        return {
            jobKey: SHIPROCKET_BULK_VERIFY_JOB_KEY,
            provider: SHIPROCKET_BULK_VERIFY_PROVIDER,
            jobType: SHIPROCKET_BULK_VERIFY_JOB_TYPE,
            status: 'idle',
            config: null,
            progress: null,
            lock: null,
            startedAt: null,
            finishedAt: null,
            updatedAt: null,
            requestedBy: '',
            trigger: '',
            isStale: false,
            error: ''
        };
    }

    const runResult = jobState.lastRunResult || {};
    const progress = runResult.progress || null;
    const cancellationState = extractCancellationState(jobState);
    const activeRunExpiresAt = jobState.activeRunExpiresAt ? new Date(jobState.activeRunExpiresAt) : null;
    const isStale =
        jobState.lastRunStatus === 'running' &&
        activeRunExpiresAt instanceof Date &&
        !Number.isNaN(activeRunExpiresAt.getTime()) &&
        activeRunExpiresAt.getTime() + JOB_STALE_GRACE_MS < Date.now();

    return {
        jobKey: normalizeText(jobState.jobKey || SHIPROCKET_BULK_VERIFY_JOB_KEY),
        provider: normalizeText(jobState.provider || SHIPROCKET_BULK_VERIFY_PROVIDER),
        jobType: normalizeText(jobState.jobType || SHIPROCKET_BULK_VERIFY_JOB_TYPE),
        status: normalizeText(jobState.lastRunStatus || 'idle'),
        config: jobState.lastConfig || runResult.config || null,
        progress,
        result: runResult || null,
        error: normalizeText(jobState.lastError),
        requestedBy: normalizeText(jobState.lastRequestedBy || runResult.requestedBy),
        trigger: normalizeText(jobState.lastTrigger || runResult.trigger),
        startedAt: jobState.lastRunStartedAt || null,
        finishedAt: jobState.lastRunFinishedAt || null,
        updatedAt: jobState.updatedAt || null,
        lockExpiresAt: activeRunExpiresAt,
        lock: null,
        isStale,
        cancelRequestedAt: cancellationState.cancelRequestedAt,
        cancelRequestedBy: cancellationState.cancelRequestedBy,
        cancelReason: cancellationState.cancelReason,
        isCancelling: jobState.lastRunStatus === 'running' && Boolean(cancellationState.cancelRequestedAt)
    };
};

const getShiprocketBulkVerifyJobStatus = async () => {
    const [jobState, lock] = await Promise.all([
        getSystemJobState(SHIPROCKET_BULK_VERIFY_JOB_KEY),
        getDistributedLock(SHIPROCKET_BULK_VERIFY_LOCK_KEY)
    ]);

    return {
        ...serializeShiprocketBulkVerifyJobState(jobState),
        lock: serializeLockState(lock)
    };
};

const refreshActiveRunHeartbeat = async ({
    config,
    lockOwnerId,
    requestedBy = '',
    trigger = '',
    progress,
    cancellationState = null
} = {}) => {
    const activeRunExpiresAt = new Date(Date.now() + Number(config?.lockTtlMs || MIN_LOCK_TTL_MS));
    const refreshedLock = await refreshDistributedLock({
        key: SHIPROCKET_BULK_VERIFY_LOCK_KEY,
        ownerId: lockOwnerId,
        ttlMs: config?.lockTtlMs,
        metadata: {
            trigger,
            requestedBy: normalizeText(requestedBy),
            progress,
            cancellationState
        }
    });

    if (!refreshedLock) {
        const error = new Error('Shiprocket bulk live verification lock was lost before the run completed');
        error.statusCode = 409;
        throw error;
    }

    await persistRunningJobProgress({
        config,
        progress,
        requestedBy,
        trigger,
        activeRunExpiresAt,
        cancellationState
    });

    return activeRunExpiresAt;
};

const assertShiprocketBulkVerifyNotCancelled = async () => {
    const jobState = await getSystemJobState(SHIPROCKET_BULK_VERIFY_JOB_KEY);
    const cancellationState = extractCancellationState(jobState);

    if (cancellationState.cancelRequestedAt) {
        throw createCancellationError(cancellationState);
    }

    return cancellationState;
};

const waitForDelayOrCancellation = async ({
    delayMs,
    config,
    lockOwnerId,
    requestedBy = '',
    trigger = '',
    progress
} = {}) => {
    let remainingMs = Math.max(0, normalizeInteger(delayMs, 0));
    let heartbeatElapsedMs = 0;
    let activeRunExpiresAt = null;

    while (remainingMs > 0) {
        const cancellationState = await assertShiprocketBulkVerifyNotCancelled();
        const sliceMs = Math.min(Number(config?.cancellationPollIntervalMs || CANCELLATION_POLL_INTERVAL_MS), remainingMs);

        await sleep(sliceMs);
        remainingMs -= sliceMs;
        heartbeatElapsedMs += sliceMs;

        if (remainingMs > 0 && heartbeatElapsedMs >= Number(config?.heartbeatIntervalMs || HEARTBEAT_INTERVAL_MS)) {
            activeRunExpiresAt = await refreshActiveRunHeartbeat({
                config,
                lockOwnerId,
                requestedBy,
                trigger,
                progress,
                cancellationState
            });
            heartbeatElapsedMs = 0;
        }
    }

    return activeRunExpiresAt;
};

const computeThrottleRetryDelayMs = (error, attemptIndex, config) => {
    const explicitRetryAfterMs = Math.max(0, normalizeInteger(error?.retryAfterMs, 0));

    if (explicitRetryAfterMs > 0) {
        return Math.min(Number(config?.throttleBackoffMaxMs || DEFAULT_THROTTLE_BACKOFF_MAX_MS), explicitRetryAfterMs);
    }

    return Math.min(
        Number(config?.throttleBackoffMaxMs || DEFAULT_THROTTLE_BACKOFF_MAX_MS),
        Number(config?.throttleBackoffBaseMs || DEFAULT_THROTTLE_BACKOFF_BASE_MS) * 2 ** Math.max(0, attemptIndex)
    );
};

const verifyOrderWithThrottleRetry = async ({
    orderId,
    referenceOrderId = '',
    config,
    lockOwnerId,
    progressState,
    requestedBy = '',
    targetOrders,
    trigger = '',
    log
} = {}) => {
    let attemptIndex = 0;

    while (true) {
        const cancellationState = await assertShiprocketBulkVerifyNotCancelled();

        try {
            const verification = await verifyOrderPricingAgainstLiveShiprocket(
                { _id: orderId },
                {
                    log,
                    persist: true
                }
            );

            progressState.lastRetryDelayMs = 0;
            progressState.statusNote = '';

            return {
                verification,
                cancellationState
            };
        } catch (error) {
            if (!isShiprocketThrottleError(error) || attemptIndex >= Number(config?.throttleRetryLimit || DEFAULT_THROTTLE_RETRY_LIMIT)) {
                throw error;
            }

            const backoffMs = computeThrottleRetryDelayMs(error, attemptIndex, config);

            attemptIndex += 1;
            progressState.retryScheduledCount += 1;
            progressState.lastRetryDelayMs = backoffMs;
            progressState.statusNote = `Shiprocket throttled live verification for ${referenceOrderId || orderId}. Retrying in ${Math.ceil(backoffMs / 1000)}s.`;

            log?.warn?.(
                {
                    orderId,
                    referenceOrderId,
                    upstreamStatusCode: error?.upstreamStatusCode || null,
                    retryAfterMs: error?.retryAfterMs || null,
                    scheduledBackoffMs: backoffMs,
                    retryAttempt: attemptIndex
                },
                'Shiprocket bulk live verification was throttled; retrying with backoff'
            );

            await refreshActiveRunHeartbeat({
                config,
                lockOwnerId,
                requestedBy,
                trigger,
                progress: buildProgressSnapshot({
                    config,
                    targetOrders,
                    processedCount: progressState.processedCount,
                    clearCount: progressState.clearCount,
                    warningCount: progressState.warningCount,
                    mismatchCount: progressState.mismatchCount,
                    failedCount: progressState.failedCount,
                    retryScheduledCount: progressState.retryScheduledCount,
                    lastRetryDelayMs: progressState.lastRetryDelayMs,
                    statusNote: progressState.statusNote,
                    currentOrderId: progressState.currentOrderId,
                    currentReferenceOrderId: progressState.currentReferenceOrderId,
                    lastProcessedOrderId: progressState.lastProcessedOrderId,
                    recentFailures: progressState.recentFailures
                }),
                cancellationState
            });

            await waitForDelayOrCancellation({
                delayMs: backoffMs,
                config,
                lockOwnerId,
                requestedBy,
                trigger,
                progress: buildProgressSnapshot({
                    config,
                    targetOrders,
                    processedCount: progressState.processedCount,
                    clearCount: progressState.clearCount,
                    warningCount: progressState.warningCount,
                    mismatchCount: progressState.mismatchCount,
                    failedCount: progressState.failedCount,
                    retryScheduledCount: progressState.retryScheduledCount,
                    lastRetryDelayMs: progressState.lastRetryDelayMs,
                    statusNote: progressState.statusNote,
                    currentOrderId: progressState.currentOrderId,
                    currentReferenceOrderId: progressState.currentReferenceOrderId,
                    lastProcessedOrderId: progressState.lastProcessedOrderId,
                    recentFailures: progressState.recentFailures
                })
            });
        }
    }
};

const runShiprocketBulkLiveVerificationJob = async ({
    config,
    lockOwnerId,
    requestedBy = '',
    targetOrders,
    trigger = 'admin_api',
    log
} = {}) => {
    const runStartedAt = Date.now();
    const requestedByText = normalizeText(requestedBy);
    const progressState = buildProgressSnapshot({
        config,
        targetOrders
    });

    try {
        for (let index = 0; index < targetOrders.length; index += 1) {
            const cancellationStateBeforeOrder = await assertShiprocketBulkVerifyNotCancelled();
            const targetOrder = targetOrders[index];
            const orderId = normalizeText(targetOrder?._id);
            const referenceOrderId = normalizeText(targetOrder?.referenceOrderId);

            progressState.currentOrderId = orderId;
            progressState.currentReferenceOrderId = referenceOrderId;
            progressState.statusNote = '';

            try {
                const { verification } = await verifyOrderWithThrottleRetry({
                    orderId,
                    referenceOrderId,
                    config,
                    lockOwnerId,
                    progressState,
                    requestedBy: requestedByText,
                    targetOrders,
                    trigger,
                    log
                });
                const verificationStatus = normalizeText(verification?.status);

                if (verificationStatus === 'mismatch') {
                    progressState.mismatchCount += 1;
                } else if (verificationStatus === 'warning') {
                    progressState.warningCount += 1;
                } else {
                    progressState.clearCount += 1;
                }

                if (verification?.order) {
                    await publishAdminOrderUpsert({
                        order: verification.order,
                        source: 'shiprocket.bulkLiveVerify'
                    });
                }
            } catch (error) {
                if (error?.isShiprocketBulkVerifyCancelled) {
                    throw error;
                }

                progressState.statusNote = '';
                progressState.failedCount += 1;
                progressState.recentFailures = [
                    ...(progressState.recentFailures || []),
                    {
                        orderId,
                        referenceOrderId,
                        message: truncateText(error?.message || 'Live Shiprocket verification failed')
                    }
                ].slice(-5);

                const updatedOrder = await orderModel.findById(orderId);

                if (updatedOrder) {
                    await publishAdminOrderUpsert({
                        order: updatedOrder,
                        source: 'shiprocket.bulkLiveVerify'
                    });
                }
            }

            progressState.processedCount += 1;
            progressState.remainingCount = Math.max(0, targetOrders.length - progressState.processedCount);
            progressState.lastProcessedOrderId = orderId;
            progressState.percentComplete =
                targetOrders.length > 0
                    ? Math.round((progressState.processedCount / targetOrders.length) * 100)
                    : 100;

            await refreshActiveRunHeartbeat({
                config,
                lockOwnerId,
                requestedBy: requestedByText,
                trigger,
                progress: buildProgressSnapshot({
                    config,
                    targetOrders,
                    processedCount: progressState.processedCount,
                    clearCount: progressState.clearCount,
                    warningCount: progressState.warningCount,
                    mismatchCount: progressState.mismatchCount,
                    failedCount: progressState.failedCount,
                    retryScheduledCount: progressState.retryScheduledCount,
                    lastRetryDelayMs: progressState.lastRetryDelayMs,
                    statusNote: progressState.statusNote,
                    currentOrderId: progressState.currentOrderId,
                    currentReferenceOrderId: progressState.currentReferenceOrderId,
                    lastProcessedOrderId: progressState.lastProcessedOrderId,
                    recentFailures: progressState.recentFailures
                }),
                cancellationState: cancellationStateBeforeOrder
            });

            if (config.requestIntervalMs > 0 && index < targetOrders.length - 1) {
                await waitForDelayOrCancellation({
                    delayMs: config.requestIntervalMs,
                    config,
                    lockOwnerId,
                    requestedBy: requestedByText,
                    trigger,
                    progress: buildProgressSnapshot({
                        config,
                        targetOrders,
                        processedCount: progressState.processedCount,
                        clearCount: progressState.clearCount,
                        warningCount: progressState.warningCount,
                        mismatchCount: progressState.mismatchCount,
                        failedCount: progressState.failedCount,
                        retryScheduledCount: progressState.retryScheduledCount,
                        lastRetryDelayMs: progressState.lastRetryDelayMs,
                        statusNote: progressState.statusNote,
                        currentOrderId: progressState.currentOrderId,
                        currentReferenceOrderId: progressState.currentReferenceOrderId,
                        lastProcessedOrderId: progressState.lastProcessedOrderId,
                        recentFailures: progressState.recentFailures
                    })
                });
            }
        }

        const completedProgress = buildProgressSnapshot({
            config,
            targetOrders,
            processedCount: progressState.processedCount,
            clearCount: progressState.clearCount,
            warningCount: progressState.warningCount,
            mismatchCount: progressState.mismatchCount,
            failedCount: progressState.failedCount,
            retryScheduledCount: progressState.retryScheduledCount,
            lastRetryDelayMs: progressState.lastRetryDelayMs,
            lastProcessedOrderId: progressState.lastProcessedOrderId,
            recentFailures: progressState.recentFailures
        });
        const result = {
            success: true,
            skipped: false,
            trigger,
            requestedBy: requestedByText,
            config,
            claimedCount: targetOrders.length,
            outcomes: {
                processed: completedProgress.processedCount,
                clear: completedProgress.clearCount,
                warning: completedProgress.warningCount,
                mismatch: completedProgress.mismatchCount,
                failed: completedProgress.failedCount
            },
            progress: completedProgress,
            retryScheduledCount: completedProgress.retryScheduledCount,
            targetOrders: targetOrders.slice(0, 20)
        };

        await markSystemJobCompleted({
            jobKey: SHIPROCKET_BULK_VERIFY_JOB_KEY,
            provider: SHIPROCKET_BULK_VERIFY_PROVIDER,
            jobType: SHIPROCKET_BULK_VERIFY_JOB_TYPE,
            trigger,
            requestedBy: requestedByText,
            config,
            result,
            durationMs: Date.now() - runStartedAt
        });
    } catch (error) {
        if (error?.isShiprocketBulkVerifyCancelled) {
            const cancelledProgress = buildProgressSnapshot({
                config,
                targetOrders,
                processedCount: progressState.processedCount,
                clearCount: progressState.clearCount,
                warningCount: progressState.warningCount,
                mismatchCount: progressState.mismatchCount,
                failedCount: progressState.failedCount,
                retryScheduledCount: progressState.retryScheduledCount,
                lastRetryDelayMs: progressState.lastRetryDelayMs,
                statusNote: 'Cancellation requested. Ending the current Shiprocket bulk verification run.',
                currentOrderId: progressState.currentOrderId,
                currentReferenceOrderId: progressState.currentReferenceOrderId,
                lastProcessedOrderId: progressState.lastProcessedOrderId,
                recentFailures: progressState.recentFailures
            });
            const cancelledResult = {
                success: true,
                skipped: false,
                cancelled: true,
                trigger,
                requestedBy: requestedByText,
                config,
                claimedCount: targetOrders.length,
                outcomes: {
                    processed: cancelledProgress.processedCount,
                    clear: cancelledProgress.clearCount,
                    warning: cancelledProgress.warningCount,
                    mismatch: cancelledProgress.mismatchCount,
                    failed: cancelledProgress.failedCount
                },
                progress: cancelledProgress,
                retryScheduledCount: cancelledProgress.retryScheduledCount,
                cancelRequestedAt: error.cancelRequestedAt || null,
                cancelRequestedBy: error.cancelRequestedBy || '',
                cancelReason: error.cancelReason || ''
            };

            await markSystemJobCancelled({
                jobKey: SHIPROCKET_BULK_VERIFY_JOB_KEY,
                provider: SHIPROCKET_BULK_VERIFY_PROVIDER,
                jobType: SHIPROCKET_BULK_VERIFY_JOB_TYPE,
                trigger,
                requestedBy: requestedByText,
                config,
                result: cancelledResult,
                durationMs: Date.now() - runStartedAt
            });

            return;
        }

        const failedProgress = buildProgressSnapshot({
            config,
            targetOrders,
            processedCount: progressState.processedCount,
            clearCount: progressState.clearCount,
            warningCount: progressState.warningCount,
            mismatchCount: progressState.mismatchCount,
            failedCount: progressState.failedCount,
            retryScheduledCount: progressState.retryScheduledCount,
            lastRetryDelayMs: progressState.lastRetryDelayMs,
            statusNote: progressState.statusNote,
            currentOrderId: progressState.currentOrderId,
            currentReferenceOrderId: progressState.currentReferenceOrderId,
            lastProcessedOrderId: progressState.lastProcessedOrderId,
            recentFailures: progressState.recentFailures
        });
        const failureResult = {
            success: false,
            skipped: false,
            trigger,
            requestedBy: requestedByText,
            config,
            progress: failedProgress,
            retryScheduledCount: failedProgress.retryScheduledCount,
            errorMessage: truncateText(error?.message || 'Shiprocket bulk live verification failed')
        };

        await markSystemJobFailed({
            jobKey: SHIPROCKET_BULK_VERIFY_JOB_KEY,
            provider: SHIPROCKET_BULK_VERIFY_PROVIDER,
            jobType: SHIPROCKET_BULK_VERIFY_JOB_TYPE,
            trigger,
            requestedBy: requestedByText,
            config,
            result: failureResult,
            errorMessage: failureResult.errorMessage,
            durationMs: Date.now() - runStartedAt
        });

        throw error;
    } finally {
        await releaseDistributedLock({
            key: SHIPROCKET_BULK_VERIFY_LOCK_KEY,
            ownerId: lockOwnerId,
            metadata: {
                releasedAt: new Date().toISOString(),
                trigger,
                requestedBy: requestedByText
            }
        }).catch(() => false);
    }
};

const startShiprocketBulkLiveVerificationJob = async ({
    config: configOverrides,
    requestedBy = '',
    trigger = 'admin_api',
    log
} = {}) => {
    const config = getShiprocketBulkVerifyConfig(configOverrides);
    const requestedByText = normalizeText(requestedBy);
    const lockOwnerId = crypto.randomUUID();
    const lockResult = await acquireDistributedLock({
        key: SHIPROCKET_BULK_VERIFY_LOCK_KEY,
        ownerId: lockOwnerId,
        ttlMs: config.lockTtlMs,
        metadata: {
            trigger,
            requestedBy: requestedByText,
            config
        }
    });

    if (!lockResult.acquired) {
        const currentStatus = await getShiprocketBulkVerifyJobStatus();

        return {
            success: true,
            started: false,
            skipped: true,
            reason: 'job_already_running',
            config,
            job: currentStatus
        };
    }

    const targetOrders = await selectCandidateOrdersForBulkVerify(config);

    if (targetOrders.length === 0) {
        await markSystemJobSkipped({
            jobKey: SHIPROCKET_BULK_VERIFY_JOB_KEY,
            provider: SHIPROCKET_BULK_VERIFY_PROVIDER,
            jobType: SHIPROCKET_BULK_VERIFY_JOB_TYPE,
            trigger,
            requestedBy: requestedByText,
            config,
            reason: 'no_target_orders',
            result: {
                success: true,
                skipped: true,
                reason: 'no_target_orders',
                trigger,
                requestedBy: requestedByText,
                config
            }
        });

        await releaseDistributedLock({
            key: SHIPROCKET_BULK_VERIFY_LOCK_KEY,
            ownerId: lockOwnerId,
            metadata: {
                releasedAt: new Date().toISOString(),
                trigger,
                requestedBy: requestedByText,
                reason: 'no_target_orders'
            }
        }).catch(() => false);

        return {
            success: true,
            started: false,
            skipped: true,
            reason: 'no_target_orders',
            config,
            job: await getShiprocketBulkVerifyJobStatus()
        };
    }

    const startedAt = Date.now();
    const activeRunExpiresAt = new Date(startedAt + config.lockTtlMs);

    await markSystemJobStarted({
        jobKey: SHIPROCKET_BULK_VERIFY_JOB_KEY,
        provider: SHIPROCKET_BULK_VERIFY_PROVIDER,
        jobType: SHIPROCKET_BULK_VERIFY_JOB_TYPE,
        trigger,
        requestedBy: requestedByText,
        ownerId: lockOwnerId,
        expiresAt: activeRunExpiresAt,
        config
    });

    await persistRunningJobProgress({
        config,
        progress: buildProgressSnapshot({
            config,
            targetOrders
        }),
        requestedBy: requestedByText,
        trigger,
        activeRunExpiresAt
    });

    Promise.resolve()
        .then(() =>
            runShiprocketBulkLiveVerificationJob({
                config,
                lockOwnerId,
                requestedBy: requestedByText,
                targetOrders,
                trigger,
                log
            })
        )
        .catch((error) => {
            log?.error?.(
                {
                    err: error,
                    trigger,
                    requestedBy: requestedByText,
                    config
                },
                'Shiprocket bulk live verification job failed'
            );
        });

    return {
        success: true,
        started: true,
        skipped: false,
        config,
        targetCount: targetOrders.length,
        job: await getShiprocketBulkVerifyJobStatus()
    };
};

const cancelShiprocketBulkLiveVerificationJob = async ({ requestedBy = '', reason = 'admin_request' } = {}) => {
    const requestedByText = normalizeText(requestedBy);
    const normalizedReason = truncateText(reason || 'admin_request', 120);
    const [jobState, lock] = await Promise.all([
        getSystemJobState(SHIPROCKET_BULK_VERIFY_JOB_KEY),
        getDistributedLock(SHIPROCKET_BULK_VERIFY_LOCK_KEY)
    ]);
    const serializedJob = {
        ...serializeShiprocketBulkVerifyJobState(jobState),
        lock: serializeLockState(lock)
    };

    if (serializedJob.status !== 'running') {
        return {
            success: true,
            cancelled: false,
            reason: 'no_active_job',
            job: serializedJob
        };
    }

    if (serializedJob.cancelRequestedAt) {
        return {
            success: true,
            cancelled: false,
            reason: 'cancel_already_requested',
            job: serializedJob
        };
    }

    if (!serializedJob.lock?.ownerId) {
        const cancelledResult = {
            ...(jobState?.lastRunResult || {}),
            cancelled: true,
            cancelRequestedAt: new Date().toISOString(),
            cancelRequestedBy: requestedByText,
            cancelReason: normalizedReason,
            progress: {
                ...(jobState?.lastRunResult?.progress || {}),
                statusNote: 'The stale Shiprocket bulk verification run was cancelled.'
            }
        };

        await markSystemJobCancelled({
            jobKey: SHIPROCKET_BULK_VERIFY_JOB_KEY,
            provider: SHIPROCKET_BULK_VERIFY_PROVIDER,
            jobType: SHIPROCKET_BULK_VERIFY_JOB_TYPE,
            trigger: normalizeText(jobState?.lastTrigger || 'admin_api'),
            requestedBy: requestedByText,
            config: jobState?.lastConfig || jobState?.lastRunResult?.config || null,
            result: cancelledResult,
            durationMs: normalizeInteger(jobState?.lastRunDurationMs, 0)
        });

        return {
            success: true,
            cancelled: true,
            reason: 'stale_job_cancelled',
            job: await getShiprocketBulkVerifyJobStatus()
        };
    }

    // Merge into the existing `lastRunResult` object instead of using dot-path
    // `$set`. When a job has just been started, `markSystemJobStarted` resets
    // `lastRunResult` to `null`, and MongoDB cannot create nested fields under
    // a null element ("Cannot create field 'cancelReason' in element
    // {lastRunResult: null}"). Building the full sub-document here avoids that
    // failure while preserving any progress fields already captured by the
    // running worker.
    const cancelRequestedAt = new Date().toISOString();
    const mergedCancelResult = {
        ...(jobState?.lastRunResult || {}),
        cancelRequestedAt,
        cancelRequestedBy: requestedByText,
        cancelReason: normalizedReason,
        updatedAt: cancelRequestedAt
    };

    await updateSystemJobState({
        jobKey: SHIPROCKET_BULK_VERIFY_JOB_KEY,
        updateSet: {
            lastRunResult: mergedCancelResult
        }
    });

    return {
        success: true,
        cancelled: true,
        reason: 'cancel_requested',
        job: await getShiprocketBulkVerifyJobStatus()
    };
};

export {
    cancelShiprocketBulkLiveVerificationJob,
    DEFAULT_BULK_VERIFY_LIMIT,
    DEFAULT_BULK_VERIFY_REQUESTS_PER_MINUTE,
    MAX_BULK_VERIFY_LIMIT,
    MAX_BULK_VERIFY_REQUESTS_PER_MINUTE,
    SHIPROCKET_BULK_VERIFY_JOB_KEY,
    getShiprocketBulkVerifyConfig,
    getShiprocketBulkVerifyJobStatus,
    serializeShiprocketBulkVerifyJobState,
    startShiprocketBulkLiveVerificationJob
};
