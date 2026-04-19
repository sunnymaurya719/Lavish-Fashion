import systemJobStateModel from '../models/systemJobStateModel.js';

const normalizeText = (value) => String(value || '').trim();
const normalizeNumber = (value, fallbackValue = 0) => {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : fallbackValue;
};

const updateSystemJobState = async ({ jobKey, updateSet = {}, additionalUpdate = {}, defaults = {} } = {}) => {
    if (!normalizeText(jobKey)) {
        return null;
    }

    const setOnInsert = {
        jobKey: normalizeText(jobKey),
        ...defaults
    };

    for (const updateKey of Object.keys(updateSet || {})) {
        delete setOnInsert[updateKey];
    }

    return systemJobStateModel.findOneAndUpdate(
        { jobKey: normalizeText(jobKey) },
        {
            $set: updateSet,
            ...additionalUpdate,
            $setOnInsert: setOnInsert
        },
        {
            new: true,
            upsert: true,
            setDefaultsOnInsert: true
        }
    );
};

const markSystemJobStarted = async ({
    jobKey,
    provider = '',
    jobType = '',
    trigger = '',
    requestedBy = '',
    ownerId = '',
    expiresAt = null,
    config = null
} = {}) => {
    const startedAt = new Date();

    return updateSystemJobState({
        jobKey,
        defaults: {
            provider: normalizeText(provider),
            jobType: normalizeText(jobType)
        },
        updateSet: {
            provider: normalizeText(provider),
            jobType: normalizeText(jobType),
            lastRunStatus: 'running',
            lastRunStartedAt: startedAt,
            lastRunFinishedAt: null,
            lastTrigger: normalizeText(trigger),
            lastRequestedBy: normalizeText(requestedBy),
            lastRunDurationMs: 0,
            lastClaimedCount: 0,
            lastProcessedCount: 0,
            lastRetryScheduledCount: 0,
            lastConfig: config,
            lastMetricsBefore: null,
            lastMetricsAfter: null,
            lastRunResult: null,
            lastError: '',
            activeRunOwnerId: normalizeText(ownerId),
            activeRunExpiresAt: expiresAt || null
        }
    });
};

const markSystemJobSkipped = async ({
    jobKey,
    provider = '',
    jobType = '',
    trigger = '',
    requestedBy = '',
    config = null,
    reason = '',
    result = null
} = {}) => {
    const finishedAt = new Date();

    return updateSystemJobState({
        jobKey,
        defaults: {
            provider: normalizeText(provider),
            jobType: normalizeText(jobType)
        },
        updateSet: {
            provider: normalizeText(provider),
            jobType: normalizeText(jobType),
            lastRunStatus: 'skipped',
            lastRunStartedAt: finishedAt,
            lastRunFinishedAt: finishedAt,
            lastSkippedRunAt: finishedAt,
            lastTrigger: normalizeText(trigger),
            lastRequestedBy: normalizeText(requestedBy),
            lastRunDurationMs: 0,
            lastClaimedCount: 0,
            lastProcessedCount: 0,
            lastRetryScheduledCount: 0,
            lastConfig: config,
            lastRunResult: result,
            lastError: normalizeText(reason),
            activeRunOwnerId: '',
            activeRunExpiresAt: null
        }
    });
};

const markSystemJobCompleted = async ({
    jobKey,
    provider = '',
    jobType = '',
    trigger = '',
    requestedBy = '',
    config = null,
    metricsBefore = null,
    metricsAfter = null,
    result = null,
    durationMs = 0
} = {}) => {
    const finishedAt = new Date();
    const claimedCount = normalizeNumber(result?.claimedCount);
    const processedCount = normalizeNumber(result?.outcomes?.processed);
    const retryScheduledCount = normalizeNumber(result?.retryScheduledCount);

    return updateSystemJobState({
        jobKey,
        defaults: {
            provider: normalizeText(provider),
            jobType: normalizeText(jobType)
        },
        updateSet: {
            provider: normalizeText(provider),
            jobType: normalizeText(jobType),
            lastRunStatus: 'completed',
            lastRunFinishedAt: finishedAt,
            lastSuccessfulRunAt: finishedAt,
            lastTrigger: normalizeText(trigger),
            lastRequestedBy: normalizeText(requestedBy),
            lastRunDurationMs: normalizeNumber(durationMs),
            lastClaimedCount: claimedCount,
            lastProcessedCount: processedCount,
            lastRetryScheduledCount: retryScheduledCount,
            lastConfig: config,
            lastMetricsBefore: metricsBefore,
            lastMetricsAfter: metricsAfter,
            lastRunResult: result,
            lastError: '',
            activeRunOwnerId: '',
            activeRunExpiresAt: null
        }
    });
};

const markSystemJobFailed = async ({
    jobKey,
    provider = '',
    jobType = '',
    trigger = '',
    requestedBy = '',
    config = null,
    metricsBefore = null,
    result = null,
    errorMessage = '',
    durationMs = 0
} = {}) => {
    const finishedAt = new Date();

    return updateSystemJobState({
        jobKey,
        defaults: {
            provider: normalizeText(provider),
            jobType: normalizeText(jobType)
        },
        updateSet: {
            provider: normalizeText(provider),
            jobType: normalizeText(jobType),
            lastRunStatus: 'failed',
            lastRunFinishedAt: finishedAt,
            lastFailedRunAt: finishedAt,
            lastTrigger: normalizeText(trigger),
            lastRequestedBy: normalizeText(requestedBy),
            lastRunDurationMs: normalizeNumber(durationMs),
            lastConfig: config,
            lastMetricsBefore: metricsBefore,
            lastRunResult: result,
            lastError: normalizeText(errorMessage),
            activeRunOwnerId: '',
            activeRunExpiresAt: null
        }
    });
};

const markSystemJobCancelled = async ({
    jobKey,
    provider = '',
    jobType = '',
    trigger = '',
    requestedBy = '',
    config = null,
    result = null,
    durationMs = 0
} = {}) => {
    const finishedAt = new Date();
    const claimedCount = normalizeNumber(result?.claimedCount);
    const processedCount = normalizeNumber(result?.outcomes?.processed);
    const retryScheduledCount = normalizeNumber(result?.retryScheduledCount);

    return updateSystemJobState({
        jobKey,
        defaults: {
            provider: normalizeText(provider),
            jobType: normalizeText(jobType)
        },
        updateSet: {
            provider: normalizeText(provider),
            jobType: normalizeText(jobType),
            lastRunStatus: 'cancelled',
            lastRunFinishedAt: finishedAt,
            lastTrigger: normalizeText(trigger),
            lastRequestedBy: normalizeText(requestedBy),
            lastRunDurationMs: normalizeNumber(durationMs),
            lastClaimedCount: claimedCount,
            lastProcessedCount: processedCount,
            lastRetryScheduledCount: retryScheduledCount,
            lastConfig: config,
            lastRunResult: result,
            lastError: '',
            activeRunOwnerId: '',
            activeRunExpiresAt: null
        }
    });
};

const getSystemJobState = async (jobKey) => {
    if (!normalizeText(jobKey)) {
        return null;
    }

    return systemJobStateModel.findOne({ jobKey: normalizeText(jobKey) }).lean();
};

export {
    getSystemJobState,
    markSystemJobCancelled,
    markSystemJobCompleted,
    markSystemJobFailed,
    markSystemJobSkipped,
    markSystemJobStarted,
    updateSystemJobState
};
