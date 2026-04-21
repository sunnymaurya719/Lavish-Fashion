import { normalizeProductFitData } from './productFitProfileService.js';

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_HEALTH_TIMEOUT_MS = 2500;
const DEFAULT_HEALTH_CACHE_TTL_MS = 30_000;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_WINDOW_MS = 30_000;
const DEFAULT_BODY_SCAN_MAX_BASE64_CHARS = 2_000_000;

let consecutiveFailureCount = 0;
let circuitOpenUntil = 0;
let circuitOpenedAt = 0;
let circuitOpenCount = 0;
let circuitCloseCount = 0;
let cachedMlHealth = {
    configured: false,
    healthy: false,
    reachable: false,
    modelLoaded: false,
    modelVersion: '',
    environment: '',
    appName: '',
    reason: 'ml_not_checked',
    latencyMs: null,
    checkedAt: '',
    expiresAt: 0
};

const normalizeUrl = (value) => String(value || '').trim().replace(/\/$/, '');
const normalizeOptionalNumber = (value) => {
    if (value === null || value === undefined || value === '') {
        return undefined;
    }

    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? Number(parsedValue.toFixed(4)) : undefined;
};

const isMlServiceConfigured = () => Boolean(normalizeUrl(process.env.ML_SERVICE_URL));

const getMlTimeoutMs = () => {
    const parsedTimeout = Number(process.env.ML_SERVICE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
    return Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS;
};

const getMlHealthTimeoutMs = () => {
    const parsedTimeout = Number(process.env.ML_SERVICE_HEALTH_TIMEOUT_MS || DEFAULT_HEALTH_TIMEOUT_MS);
    return Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_HEALTH_TIMEOUT_MS;
};

const getMlHealthCacheTtlMs = () => {
    const parsedTtl = Number(process.env.ML_SERVICE_HEALTH_CACHE_TTL_MS || DEFAULT_HEALTH_CACHE_TTL_MS);
    return Number.isFinite(parsedTtl) && parsedTtl >= 0 ? parsedTtl : DEFAULT_HEALTH_CACHE_TTL_MS;
};

const createMlGatewayError = (message, fallbackReason, metadata = {}) => {
    const error = new Error(message);
    error.fallbackReason = fallbackReason;
    Object.assign(error, metadata);
    return error;
};

const buildMlHeaders = ({ requestId = '' } = {}) => {
    const headers = {
        'Content-Type': 'application/json'
    };

    const sharedSecret = String(process.env.ML_SERVICE_SHARED_SECRET || '').trim();
    if (sharedSecret) {
        headers['x-ml-service-secret'] = sharedSecret;
    }

    if (requestId) {
        headers['x-request-id'] = requestId;
    }

    return headers;
};

const createMlHealthSnapshot = ({
    configured = false,
    healthy = false,
    reachable = false,
    modelLoaded = false,
    modelVersion = '',
    environment = '',
    appName = '',
    reason = '',
    latencyMs = null,
    checkedAt = new Date().toISOString(),
    ttlMs = getMlHealthCacheTtlMs()
} = {}) => ({
    configured,
    healthy,
    reachable,
    modelLoaded,
    modelVersion,
    environment,
    appName,
    reason,
    latencyMs,
    checkedAt,
    expiresAt: Date.now() + ttlMs
});

const sanitizeBodyFeatures = (bodyFeatures = null) => {
    if (!bodyFeatures || typeof bodyFeatures !== 'object') {
        return undefined;
    }

    const normalizedBodyFeatures = {
        shoulderRatio: bodyFeatures.shoulderRatio === null || bodyFeatures.shoulderRatio === undefined ? undefined : Number(bodyFeatures.shoulderRatio),
        hipRatio: bodyFeatures.hipRatio === null || bodyFeatures.hipRatio === undefined ? undefined : Number(bodyFeatures.hipRatio),
        torsoRatio: bodyFeatures.torsoRatio === null || bodyFeatures.torsoRatio === undefined ? undefined : Number(bodyFeatures.torsoRatio),
        scanQuality: bodyFeatures.scanQuality === null || bodyFeatures.scanQuality === undefined ? undefined : Number(bodyFeatures.scanQuality)
    };

    return Object.values(normalizedBodyFeatures).some((value) => value !== undefined) ? normalizedBodyFeatures : undefined;
};

const sanitizeLandmarks = (landmarks = []) => {
    if (!Array.isArray(landmarks)) {
        return undefined;
    }

    const normalizedLandmarks = landmarks
        .filter((landmark) => landmark && typeof landmark === 'object')
        .map((landmark) => ({
            x: Number(landmark.x),
            y: Number(landmark.y),
            ...(landmark.visibility === undefined || landmark.visibility === null
                ? {}
                : { visibility: Number(landmark.visibility) })
        }))
        .filter(
            (landmark) =>
                Number.isFinite(landmark.x) &&
                Number.isFinite(landmark.y) &&
                (landmark.visibility === undefined || Number.isFinite(landmark.visibility))
        );

    return normalizedLandmarks.length > 0 ? normalizedLandmarks : undefined;
};

const buildRecommendationPayload = ({ product, userMetrics, bodyFeatures = null, requestId = '' }) => {
    const normalizedProduct = normalizeProductFitData(product);

    return {
        mode: bodyFeatures ? 'hybrid' : 'manual',
        requestId,
        product: {
            id: String(normalizedProduct?._id || ''),
            category: normalizedProduct.category,
            subCategory: normalizedProduct.subCategory,
            sizes: Array.isArray(normalizedProduct.sizes) ? normalizedProduct.sizes : [],
            sizeScale: normalizedProduct.sizeScale,
            fitProfile: normalizedProduct.fitProfile,
            fitProfileSummary: normalizedProduct.fitProfileSummary
                ? {
                    ready: Boolean(normalizedProduct.fitProfileSummary.ready),
                    measurementTemplate: normalizedProduct.fitProfileSummary.measurementTemplate
                }
                : undefined
        },
        userMetrics: {
            heightCm: Number(userMetrics.heightCm),
            weightKg: Number(userMetrics.weightKg),
            preferredFit: userMetrics.preferredFit || 'regular'
        },
        ...(bodyFeatures ? { bodyFeatures } : {})
    };
};

const buildBodyScanPayload = ({ heightCm, weightKg = null, imageBase64 = '', landmarks = undefined }) => ({
    heightCm: Number(heightCm),
    ...(weightKg === null || weightKg === undefined ? {} : { weightKg: Number(weightKg) }),
    ...(String(imageBase64 || '').trim() ? { imageBase64: String(imageBase64).trim() } : {}),
    ...(landmarks ? { landmarks } : {})
});

const getBodyScanMaxBase64Chars = () => {
    const parsedLimit = Number(process.env.ML_BODY_SCAN_MAX_BASE64_CHARS || DEFAULT_BODY_SCAN_MAX_BASE64_CHARS);
    return Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_BODY_SCAN_MAX_BASE64_CHARS;
};

const openCircuitIfNeeded = ({ requestId = '', log = null, reason = 'unknown' } = {}) => {
    consecutiveFailureCount += 1;

    if (consecutiveFailureCount >= CIRCUIT_FAILURE_THRESHOLD && Date.now() >= circuitOpenUntil) {
        circuitOpenUntil = Date.now() + CIRCUIT_OPEN_WINDOW_MS;
        circuitOpenedAt = Date.now();
        circuitOpenCount += 1;
        log?.warn?.(
            {
                event: 'fit.ml.circuit.open',
                requestId,
                reason,
                consecutiveFailureCount,
                openWindowMs: CIRCUIT_OPEN_WINDOW_MS,
                openCount: circuitOpenCount
            },
            'ML gateway circuit breaker opened'
        );
    }
};

const markMlGatewaySuccess = ({ requestId = '', log = null } = {}) => {
    const wasOpen = circuitOpenUntil > 0 || consecutiveFailureCount > 0;
    if (circuitOpenUntil > 0) {
        circuitCloseCount += 1;
        log?.info?.(
            {
                event: 'fit.ml.circuit.close',
                requestId,
                openedForMs: circuitOpenedAt ? Date.now() - circuitOpenedAt : null,
                closeCount: circuitCloseCount
            },
            'ML gateway circuit breaker closed after successful response'
        );
    } else if (wasOpen) {
        log?.info?.(
            {
                event: 'fit.ml.circuit.recovery',
                requestId,
                clearedFailureCount: consecutiveFailureCount
            },
            'ML gateway recovered after transient failures'
        );
    }
    consecutiveFailureCount = 0;
    circuitOpenUntil = 0;
    circuitOpenedAt = 0;
};

const getMlCircuitSnapshot = () => {
    const now = Date.now();
    return {
        consecutiveFailureCount,
        failureThreshold: CIRCUIT_FAILURE_THRESHOLD,
        openUntil: circuitOpenUntil,
        msUntilHalfOpen: circuitOpenUntil > now ? circuitOpenUntil - now : 0,
        isOpen: now < circuitOpenUntil,
        openCount: circuitOpenCount,
        closeCount: circuitCloseCount
    };
};

const ensureMlGatewayAvailable = () => {
    if (!isMlServiceConfigured()) {
        throw createMlGatewayError('ML service is not configured', 'ml_not_configured', { statusCode: 503 });
    }

    if (Date.now() < circuitOpenUntil) {
        throw createMlGatewayError('ML service circuit is temporarily open', 'ml_circuit_open', { statusCode: 503 });
    }
};

const probeMlServiceHealth = async ({ force = false, requestId = '', log = null } = {}) => {
    if (!isMlServiceConfigured()) {
        cachedMlHealth = createMlHealthSnapshot({
            configured: false,
            healthy: false,
            reachable: false,
            modelLoaded: false,
            reason: 'ml_not_configured'
        });
        return { ...cachedMlHealth };
    }

    if (!force && cachedMlHealth.expiresAt > Date.now()) {
        return { ...cachedMlHealth };
    }

    const serviceUrl = `${normalizeUrl(process.env.ML_SERVICE_URL)}/health`;
    const timeoutMs = getMlHealthTimeoutMs();
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
        const response = await fetch(serviceUrl, {
            method: 'GET',
            headers: requestId ? { 'x-request-id': requestId } : {},
            signal: abortController.signal
        });
        const latencyMs = Date.now() - startedAt;
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
            cachedMlHealth = createMlHealthSnapshot({
                configured: true,
                healthy: false,
                reachable: false,
                modelLoaded: false,
                reason: response.status >= 500 ? 'ml_health_http_5xx' : 'ml_health_http_4xx',
                latencyMs
            });
            log?.warn?.(
                {
                    event: 'fit.ml.health.http_error',
                    requestId,
                    latencyMs,
                    statusCode: response.status
                },
                'ML health probe returned an unsuccessful response'
            );
            return { ...cachedMlHealth };
        }

        cachedMlHealth = createMlHealthSnapshot({
            configured: true,
            healthy: true,
            reachable: true,
            modelLoaded: Boolean(payload?.modelLoaded),
            modelVersion: String(payload?.modelVersion || '').trim(),
            environment: String(payload?.environment || '').trim(),
            appName: String(payload?.appName || '').trim(),
            reason: '',
            latencyMs
        });

        return { ...cachedMlHealth };
    } catch (error) {
        const latencyMs = Date.now() - startedAt;
        cachedMlHealth = createMlHealthSnapshot({
            configured: true,
            healthy: false,
            reachable: false,
            modelLoaded: false,
            reason: error?.name === 'AbortError' ? 'ml_health_timeout' : 'ml_health_request_failed',
            latencyMs
        });
        log?.warn?.(
            {
                event: 'fit.ml.health.failure',
                requestId,
                latencyMs,
                message: error?.message || 'Unknown ML health probe error'
            },
            'ML health probe failed'
        );
        return { ...cachedMlHealth };
    } finally {
        clearTimeout(timeoutHandle);
    }
};

const ML_FALLBACK_PREDICTION_SOURCES = new Set([
    'heuristic_fallback',
    'model_length_mismatch',
    'model_error'
]);

const ML_MODEL_VERSION_MAX_LENGTH = 60;

const annotateModelVersionForFallback = (rawModelVersion, predictionSource) => {
    const normalizedVersion = String(rawModelVersion || '').trim();
    const normalizedSource = String(predictionSource || '').trim().toLowerCase();
    if (!ML_FALLBACK_PREDICTION_SOURCES.has(normalizedSource)) {
        return normalizedVersion;
    }
    if (normalizedVersion.toLowerCase().startsWith('ml-fallback')) {
        return normalizedVersion.slice(0, ML_MODEL_VERSION_MAX_LENGTH);
    }
    const annotated = normalizedVersion ? `ml-fallback:${normalizedVersion}` : 'ml-fallback';
    return annotated.slice(0, ML_MODEL_VERSION_MAX_LENGTH);
};

const normalizeMlRecommendationResponse = (payload) => {
    const recommendationSize = String(payload?.recommendation?.size || '').trim();

    if (!recommendationSize) {
        throw createMlGatewayError('ML service returned an invalid recommendation payload', 'ml_invalid_payload', {
            statusCode: 502
        });
    }

    return {
        source: String(payload?.source || 'ml').trim() || 'ml',
        recommendation: {
            size: recommendationSize,
            confidence: Number(payload?.recommendation?.confidence || 0),
            reason: String(payload?.recommendation?.reason || '').trim(),
            range: String(payload?.recommendation?.range || '').trim()
        },
        alternatives: Array.isArray(payload?.alternatives)
            ? payload.alternatives
                .filter((item) => item?.size)
                .slice(0, 2)
                .map((item) => ({
                    size: String(item.size).trim(),
                    confidence: Number(item.confidence || 0)
                }))
            : [],
        insights: {
            fitBias: String(payload?.insights?.fitBias || 'true_to_size').trim(),
            crowdSignal: String(payload?.insights?.crowdSignal || '').trim()
        },
        meta: {
            modelVersion: annotateModelVersionForFallback(
                payload?.meta?.modelVersion || 'ml-service',
                payload?.meta?.predictionSource
            ),
            fitTemplate: String(payload?.meta?.fitTemplate || '').trim(),
            predictionSource: String(payload?.meta?.predictionSource || 'remote_service').trim(),
            modelLoaded: Boolean(payload?.meta?.modelLoaded)
        }
    };
};

const normalizeMlBodyScanResponse = (payload) => {
    const normalizedBodyFeatures = {
        shoulderRatio: normalizeOptionalNumber(payload?.bodyFeatures?.shoulderRatio),
        hipRatio: normalizeOptionalNumber(payload?.bodyFeatures?.hipRatio),
        torsoRatio: normalizeOptionalNumber(payload?.bodyFeatures?.torsoRatio),
        scanQuality: normalizeOptionalNumber(payload?.bodyFeatures?.scanQuality)
    };

    if (Object.values(normalizedBodyFeatures).some((value) => value === undefined)) {
        throw createMlGatewayError('ML service returned invalid body features', 'ml_invalid_body_scan_payload', {
            statusCode: 502
        });
    }

    return {
        bodyFeatures: normalizedBodyFeatures,
        meta: {
            source: String(payload?.meta?.source || 'ml_service').trim(),
            imageStored: Boolean(payload?.meta?.imageStored)
        }
    };
};

const requestMlSizeRecommendation = async ({ product, userMetrics, bodyFeatures = null, requestId = '', log = null }) => {
    ensureMlGatewayAvailable();

    const normalizedBodyFeatures = sanitizeBodyFeatures(bodyFeatures);
    const serviceUrl = `${normalizeUrl(process.env.ML_SERVICE_URL)}/recommend-size`;
    const timeoutMs = getMlTimeoutMs();
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
        const response = await fetch(serviceUrl, {
            method: 'POST',
            headers: buildMlHeaders({ requestId }),
            body: JSON.stringify(
                buildRecommendationPayload({
                    product,
                    userMetrics,
                    bodyFeatures: normalizedBodyFeatures,
                    requestId
                })
            ),
            signal: abortController.signal
        });
        const latencyMs = Date.now() - startedAt;
        const responsePayload = await response.json().catch(() => null);

        if (!response.ok) {
            openCircuitIfNeeded({
                requestId,
                log,
                reason: response.status >= 500 ? 'ml_http_5xx' : 'ml_http_4xx'
            });
            log?.warn(
                {
                    event: 'fit.ml.http_error',
                    requestId,
                    latencyMs,
                    statusCode: response.status
                },
                'ML service returned an unsuccessful response'
            );
            throw createMlGatewayError(
                'ML service returned an unsuccessful response',
                response.status >= 500 ? 'ml_http_5xx' : 'ml_http_4xx',
                { statusCode: response.status }
            );
        }

        const normalizedResponse = normalizeMlRecommendationResponse(responsePayload);
        markMlGatewaySuccess({ requestId, log });
        log?.info(
            {
                event: 'fit.ml.success',
                requestId,
                latencyMs,
                modelVersion: normalizedResponse.meta.modelVersion
            },
            'ML fit recommendation completed'
        );

        return normalizedResponse;
    } catch (error) {
        if (error?.fallbackReason) {
            throw error;
        }

        const latencyMs = Date.now() - startedAt;
        openCircuitIfNeeded({
            requestId,
            log,
            reason: error?.name === 'AbortError' ? 'ml_timeout' : 'ml_request_failed'
        });
        log?.warn(
            {
                event: 'fit.ml.failure',
                requestId,
                latencyMs,
                message: error?.message || 'Unknown ML gateway error'
            },
            'ML fit recommendation failed'
        );
        throw createMlGatewayError(
            error?.name === 'AbortError' ? 'ML service timed out' : 'ML service request failed',
            error?.name === 'AbortError' ? 'ml_timeout' : 'ml_request_failed',
            { cause: error }
        );
    } finally {
        clearTimeout(timeoutHandle);
    }
};

const requestMlBodyScanAnalysis = async ({ heightCm, weightKg = null, imageBase64 = '', landmarks = [], requestId = '', log = null }) => {
    ensureMlGatewayAvailable();

    const normalizedImageBase64 = String(imageBase64 || '').trim();
    const bodyScanMaxBase64Chars = getBodyScanMaxBase64Chars();
    if (normalizedImageBase64.length > bodyScanMaxBase64Chars) {
        log?.warn?.(
            {
                event: 'fit.ml.body_scan.payload_too_large',
                requestId,
                imageBase64Length: normalizedImageBase64.length,
                maxBase64Chars: bodyScanMaxBase64Chars
            },
            'Rejecting ML body scan request: imageBase64 exceeds configured limit'
        );
        throw createMlGatewayError(
            'ML body scan image payload exceeds the configured size limit',
            'ml_body_scan_payload_too_large',
            { statusCode: 413 }
        );
    }

    const serviceUrl = `${normalizeUrl(process.env.ML_SERVICE_URL)}/analyze-body`;
    const timeoutMs = getMlTimeoutMs();
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
        const response = await fetch(serviceUrl, {
            method: 'POST',
            headers: buildMlHeaders({ requestId }),
            body: JSON.stringify(
                buildBodyScanPayload({
                    heightCm,
                    weightKg,
                    imageBase64: normalizedImageBase64,
                    landmarks: sanitizeLandmarks(landmarks)
                })
            ),
            signal: abortController.signal
        });
        const latencyMs = Date.now() - startedAt;
        const responsePayload = await response.json().catch(() => null);

        if (!response.ok) {
            openCircuitIfNeeded({
                requestId,
                log,
                reason: response.status >= 500 ? 'ml_body_scan_5xx' : 'ml_body_scan_4xx'
            });
            log?.warn(
                {
                    event: 'fit.ml.body_scan.http_error',
                    requestId,
                    latencyMs,
                    statusCode: response.status
                },
                'ML body scan analysis returned an unsuccessful response'
            );
            throw createMlGatewayError(
                'ML body scan analysis returned an unsuccessful response',
                response.status >= 500 ? 'ml_body_scan_5xx' : 'ml_body_scan_4xx',
                { statusCode: response.status }
            );
        }

        const normalizedResponse = normalizeMlBodyScanResponse(responsePayload);
        markMlGatewaySuccess({ requestId, log });
        log?.info(
            {
                event: 'fit.ml.body_scan.success',
                requestId,
                latencyMs,
                source: normalizedResponse.meta.source
            },
            'ML body scan analysis completed'
        );

        return normalizedResponse;
    } catch (error) {
        if (error?.fallbackReason) {
            throw error;
        }

        const latencyMs = Date.now() - startedAt;
        openCircuitIfNeeded({
            requestId,
            log,
            reason: error?.name === 'AbortError' ? 'ml_body_scan_timeout' : 'ml_body_scan_failed'
        });
        log?.warn(
            {
                event: 'fit.ml.body_scan.failure',
                requestId,
                latencyMs,
                message: error?.message || 'Unknown ML body scan error'
            },
            'ML body scan analysis failed'
        );
        throw createMlGatewayError(
            error?.name === 'AbortError' ? 'ML body scan analysis timed out' : 'ML body scan request failed',
            error?.name === 'AbortError' ? 'ml_body_scan_timeout' : 'ml_body_scan_failed',
            {
                cause: error,
                statusCode: error?.statusCode
            }
        );
    } finally {
        clearTimeout(timeoutHandle);
    }
};

export { annotateModelVersionForFallback, getMlCircuitSnapshot, isMlServiceConfigured, probeMlServiceHealth, requestMlBodyScanAnalysis, requestMlSizeRecommendation };
