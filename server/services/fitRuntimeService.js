const DEFAULT_FIT_ROLLOUT_PERCENT = 100;
const DEFAULT_FIT_CONFIDENCE_MIN = 0.6;

const normalizeString = (value) => String(value || '').trim();
const normalizeBooleanEnv = (value, fallbackValue = false) => {
    if (value === undefined || value === null || value === '') {
        return fallbackValue;
    }

    return normalizeString(value).toLowerCase() === 'true';
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getFitRolloutPercent = () => {
    const parsedValue = Number(process.env.FIT_ENABLE_PERCENT || DEFAULT_FIT_ROLLOUT_PERCENT);
    return Number.isFinite(parsedValue)
        ? clamp(Math.round(parsedValue), 0, 100)
        : DEFAULT_FIT_ROLLOUT_PERCENT;
};

const getFitConfidenceMin = () => {
    const parsedValue = Number(process.env.FIT_CONFIDENCE_MIN || DEFAULT_FIT_CONFIDENCE_MIN);
    return Number.isFinite(parsedValue)
        ? Number(clamp(parsedValue, 0.35, 0.95).toFixed(2))
        : DEFAULT_FIT_CONFIDENCE_MIN;
};

const isFitAssistantGloballyEnabled = () => normalizeBooleanEnv(process.env.FIT_ASSISTANT_ENABLED, true);
const isFitCameraGloballyEnabled = () => normalizeBooleanEnv(process.env.FIT_CAMERA_ENABLED, false);

const buildDeterministicFitBucket = (seed) => {
    const normalizedSeed = normalizeString(seed) || 'fit-default';
    let hashValue = 5381;

    for (let index = 0; index < normalizedSeed.length; index += 1) {
        hashValue = ((hashValue << 5) + hashValue + normalizedSeed.charCodeAt(index)) >>> 0;
    }

    return hashValue % 100;
};

const isFitRolloutActiveForProduct = (productId, rolloutPercent = getFitRolloutPercent()) => {
    const normalizedPercent = Number.isFinite(Number(rolloutPercent))
        ? clamp(Math.round(Number(rolloutPercent)), 0, 100)
        : DEFAULT_FIT_ROLLOUT_PERCENT;

    if (normalizedPercent <= 0) {
        return false;
    }

    if (normalizedPercent >= 100) {
        return true;
    }

    return buildDeterministicFitBucket(productId) < normalizedPercent;
};

const createFitAvailabilityError = (message, statusCode = 403) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const assertFitAssistantAvailableForProduct = (product) => {
    if (!isFitAssistantGloballyEnabled()) {
        throw createFitAvailabilityError('Fit assistant is disabled on this store right now.', 503);
    }

    if (!product?.fitEnabled) {
        throw createFitAvailabilityError('Fit assistant is not enabled for this product yet.', 403);
    }

    if (!isFitRolloutActiveForProduct(String(product?._id || ''))) {
        throw createFitAvailabilityError('Fit assistant is not enabled for this product yet.', 403);
    }
};

export {
    assertFitAssistantAvailableForProduct,
    buildDeterministicFitBucket,
    createFitAvailabilityError,
    getFitConfidenceMin,
    getFitRolloutPercent,
    isFitAssistantGloballyEnabled,
    isFitCameraGloballyEnabled,
    isFitRolloutActiveForProduct
};
