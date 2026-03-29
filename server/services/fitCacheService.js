import crypto from 'crypto';

const DEFAULT_FIT_CACHE_TTL_SECONDS = 43_200;
const DEFAULT_SCAN_CACHE_TTL_SECONDS = 1_800;
const REDIS_RETRY_WINDOW_MS = 60_000;
const MEMORY_CACHE_MAX_ENTRIES = 500;
const memoryCache = new Map();

let redisClient = null;
let redisConnectPromise = null;
let redisUnavailableUntil = 0;
let redisPackageMissing = false;

const normalizeString = (value) => String(value || '').trim();
const normalizeOptionalNumber = (value) => {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? Number(parsedValue.toFixed(4)) : null;
};

const cloneJsonValue = (value) => JSON.parse(JSON.stringify(value));
const createHash = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);

const getTtlSeconds = (envName, fallbackValue) => {
    const parsedValue = Number(process.env[envName] || fallbackValue);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? Math.floor(parsedValue) : fallbackValue;
};

const getRecommendationCacheTtlSeconds = () => getTtlSeconds('FIT_CACHE_TTL_SECONDS', DEFAULT_FIT_CACHE_TTL_SECONDS);
const getBodyScanCacheTtlSeconds = () => getTtlSeconds('FIT_SCAN_SESSION_TTL_SECONDS', DEFAULT_SCAN_CACHE_TTL_SECONDS);

const pruneMemoryCache = () => {
    const now = Date.now();

    for (const [key, entry] of memoryCache.entries()) {
        if (Number(entry?.expiresAt || 0) <= now) {
            memoryCache.delete(key);
        }
    }

    while (memoryCache.size > MEMORY_CACHE_MAX_ENTRIES) {
        const oldestKey = memoryCache.keys().next().value;

        if (!oldestKey) {
            break;
        }

        memoryCache.delete(oldestKey);
    }
};

const readMemoryCache = (key) => {
    if (!key) {
        return null;
    }

    pruneMemoryCache();

    const entry = memoryCache.get(key);
    if (!entry) {
        return null;
    }

    if (Number(entry.expiresAt || 0) <= Date.now()) {
        memoryCache.delete(key);
        return null;
    }

    return cloneJsonValue(entry.value);
};

const writeMemoryCache = (key, value, ttlSeconds) => {
    if (!key || !ttlSeconds) {
        return;
    }

    memoryCache.set(key, {
        value: cloneJsonValue(value),
        expiresAt: Date.now() + ttlSeconds * 1000
    });
    pruneMemoryCache();
};

const isRedisConfigured = () => Boolean(normalizeString(process.env.REDIS_URL));

const logCacheWarning = ({ log = null, requestId = '', event = '', message = '' }) => {
    log?.warn(
        {
            event,
            requestId,
            message
        },
        'Fit cache degraded gracefully'
    );
};

const resolveRedisClient = async ({ log = null, requestId = '' } = {}) => {
    if (!isRedisConfigured() || redisPackageMissing) {
        return null;
    }

    if (redisClient?.isOpen) {
        return redisClient;
    }

    if (Date.now() < redisUnavailableUntil) {
        return null;
    }

    if (redisConnectPromise) {
        return redisConnectPromise;
    }

    redisConnectPromise = (async () => {
        let nextClient = null;

        try {
            const redisModule = await import('redis');
            nextClient = redisModule.createClient({
                url: normalizeString(process.env.REDIS_URL),
                socket: {
                    reconnectStrategy: false
                }
            });

            nextClient.on('error', () => {});
            nextClient.on('end', () => {
                if (redisClient === nextClient) {
                    redisClient = null;
                }
            });

            await nextClient.connect();
            redisClient = nextClient;
            redisUnavailableUntil = 0;
            return nextClient;
        } catch (error) {
            if (/Cannot find package 'redis'|ERR_MODULE_NOT_FOUND/i.test(String(error?.message || ''))) {
                redisPackageMissing = true;
            } else {
                redisUnavailableUntil = Date.now() + REDIS_RETRY_WINDOW_MS;
            }

            if (nextClient?.isOpen) {
                await nextClient.quit().catch(() => {});
            }

            logCacheWarning({
                log,
                requestId,
                event: 'fit.cache.redis_unavailable',
                message: error?.message || 'Redis cache client could not be initialized'
            });
            return null;
        } finally {
            redisConnectPromise = null;
        }
    })();

    return redisConnectPromise;
};

const readJsonCacheValue = async ({ key, log = null, requestId = '' } = {}) => {
    if (!key) {
        return null;
    }

    const client = await resolveRedisClient({ log, requestId });

    if (client) {
        try {
            const payload = await client.get(key);
            return payload ? JSON.parse(payload) : null;
        } catch (error) {
            logCacheWarning({
                log,
                requestId,
                event: 'fit.cache.redis_read_failed',
                message: error?.message || 'Redis cache read failed'
            });
        }
    }

    return readMemoryCache(key);
};

const writeJsonCacheValue = async ({ key, value, ttlSeconds, log = null, requestId = '' } = {}) => {
    if (!key || !ttlSeconds) {
        return;
    }

    const client = await resolveRedisClient({ log, requestId });

    if (client) {
        try {
            await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
            return;
        } catch (error) {
            logCacheWarning({
                log,
                requestId,
                event: 'fit.cache.redis_write_failed',
                message: error?.message || 'Redis cache write failed'
            });
        }
    }

    writeMemoryCache(key, value, ttlSeconds);
};

const normalizeSizeMeasurementsForCache = (sizeMeasurements = []) =>
    (Array.isArray(sizeMeasurements) ? sizeMeasurements : [])
        .map((entry) => ({
            size: normalizeString(entry?.size).toUpperCase(),
            chest: normalizeOptionalNumber(entry?.chest),
            waist: normalizeOptionalNumber(entry?.waist),
            hip: normalizeOptionalNumber(entry?.hip),
            shoulder: normalizeOptionalNumber(entry?.shoulder),
            sleeveLength: normalizeOptionalNumber(entry?.sleeveLength),
            inseam: normalizeOptionalNumber(entry?.inseam),
            garmentLength: normalizeOptionalNumber(entry?.garmentLength)
        }))
        .sort((left, right) => left.size.localeCompare(right.size));

const buildFitRecommendationCacheKey = ({ product, userId = '', userMetrics = {}, bodyFeatures = null }) => {
    const productId = normalizeString(product?._id);

    if (!productId) {
        return '';
    }

    const keyPayload = {
        subject: normalizeString(userId) ? `user:${normalizeString(userId)}` : 'anon',
        product: {
            id: productId,
            updatedAt: normalizeString(product?.updatedAt || product?.date),
            fitEnabled: Boolean(product?.fitEnabled),
            sizeScale: normalizeString(product?.sizeScale),
            sizes: Array.isArray(product?.sizes) ? product.sizes.map((size) => normalizeString(size).toUpperCase()) : [],
            fitProfile: {
                measurementTemplate: normalizeString(product?.fitProfile?.measurementTemplate),
                fitBias: normalizeString(product?.fitProfile?.fitBias),
                stretchScore: normalizeOptionalNumber(product?.fitProfile?.stretchScore),
                sizeMeasurements: normalizeSizeMeasurementsForCache(product?.fitProfile?.sizeMeasurements)
            }
        },
        userMetrics: {
            heightCm: normalizeOptionalNumber(userMetrics?.heightCm),
            weightKg: normalizeOptionalNumber(userMetrics?.weightKg),
            preferredFit: normalizeString(userMetrics?.preferredFit || 'regular').toLowerCase()
        },
        bodyFeatures: bodyFeatures
            ? {
                shoulderRatio: normalizeOptionalNumber(bodyFeatures?.shoulderRatio),
                hipRatio: normalizeOptionalNumber(bodyFeatures?.hipRatio),
                torsoRatio: normalizeOptionalNumber(bodyFeatures?.torsoRatio),
                scanQuality: normalizeOptionalNumber(bodyFeatures?.scanQuality)
            }
            : null
    };

    return `fit:v1:recommend:${productId}:${createHash(JSON.stringify(keyPayload))}`;
};

const getCachedFitRecommendation = async ({ product, userId = '', userMetrics = {}, bodyFeatures = null, log = null, requestId = '' }) =>
    readJsonCacheValue({
        key: buildFitRecommendationCacheKey({ product, userId, userMetrics, bodyFeatures }),
        log,
        requestId
    });

const setCachedFitRecommendation = async ({
    product,
    userId = '',
    userMetrics = {},
    bodyFeatures = null,
    recommendation,
    log = null,
    requestId = ''
}) =>
    writeJsonCacheValue({
        key: buildFitRecommendationCacheKey({ product, userId, userMetrics, bodyFeatures }),
        value: recommendation,
        ttlSeconds: getRecommendationCacheTtlSeconds(),
        log,
        requestId
    });

const buildBodyScanCacheKey = ({ scanInput = {} } = {}) => {
    const heightCm = normalizeOptionalNumber(scanInput?.heightCm);
    const weightKg = normalizeOptionalNumber(scanInput?.weightKg);
    const imageBase64 = normalizeString(scanInput?.imageBase64);
    const normalizedLandmarks = Array.isArray(scanInput?.landmarks)
        ? scanInput.landmarks
            .map((landmark) => ({
                x: normalizeOptionalNumber(landmark?.x),
                y: normalizeOptionalNumber(landmark?.y),
                visibility: normalizeOptionalNumber(landmark?.visibility)
            }))
            .filter((landmark) => landmark.x !== null && landmark.y !== null)
        : [];

    if (!imageBase64 && normalizedLandmarks.length === 0) {
        return '';
    }

    const keyPayload = {
        heightCm,
        weightKg,
        imageHash: imageBase64 ? createHash(imageBase64) : '',
        landmarksHash: normalizedLandmarks.length > 0 ? createHash(JSON.stringify(normalizedLandmarks)) : ''
    };

    return `fit:v1:body-scan:${createHash(JSON.stringify(keyPayload))}`;
};

const getCachedBodyScanAnalysis = async ({ scanInput = {}, log = null, requestId = '' } = {}) =>
    readJsonCacheValue({
        key: buildBodyScanCacheKey({ scanInput }),
        log,
        requestId
    });

const setCachedBodyScanAnalysis = async ({ scanInput = {}, result, log = null, requestId = '' } = {}) =>
    writeJsonCacheValue({
        key: buildBodyScanCacheKey({ scanInput }),
        value: result,
        ttlSeconds: getBodyScanCacheTtlSeconds(),
        log,
        requestId
    });

export {
    buildBodyScanCacheKey,
    buildFitRecommendationCacheKey,
    getCachedBodyScanAnalysis,
    getCachedFitRecommendation,
    setCachedBodyScanAnalysis,
    setCachedFitRecommendation
};
