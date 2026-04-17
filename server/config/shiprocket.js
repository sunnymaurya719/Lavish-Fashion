import axios from 'axios';
import logger from './logger.js';

const DEFAULT_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TOKEN_REFRESH_AFTER_MS = 23 * 60 * 60 * 1000;
const DEFAULT_LENGTH_CM = 30;
const DEFAULT_BREADTH_CM = 20;
const DEFAULT_HEIGHT_CM = 8;
const DEFAULT_WEIGHT_KG = 0.5;

const normalizeEnvValue = (value) => String(value || '').trim();
const normalizeBooleanEnv = (value) => ['1', 'true', 'yes', 'on'].includes(normalizeEnvValue(value).toLowerCase());
const parsePositiveNumber = (value, fallbackValue) => {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallbackValue;
};

let cachedToken = '';
let tokenCreatedAt = 0;
let refreshPromise = null;

const shiprocketLog = logger.child({
    integration: 'shiprocket'
});

const isShiprocketEnabled = () => normalizeBooleanEnv(process.env.SHIPROCKET_ENABLED);

const getShiprocketConfig = () => ({
    enabled: isShiprocketEnabled(),
    email: normalizeEnvValue(process.env.SHIPROCKET_EMAIL),
    password: normalizeEnvValue(process.env.SHIPROCKET_PASSWORD),
    baseUrl: normalizeEnvValue(process.env.SHIPROCKET_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    pickupLocation: normalizeEnvValue(process.env.SHIPROCKET_PICKUP_LOCATION),
    timeoutMs: parsePositiveNumber(process.env.SHIPROCKET_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    tokenTtlMs: parsePositiveNumber(process.env.SHIPROCKET_TOKEN_TTL_MS, DEFAULT_TOKEN_TTL_MS),
    tokenRefreshAfterMs: parsePositiveNumber(
        process.env.SHIPROCKET_TOKEN_REFRESH_AFTER_MS,
        DEFAULT_TOKEN_REFRESH_AFTER_MS
    ),
    defaultDimensions: {
        lengthCm: parsePositiveNumber(process.env.SHIPROCKET_DEFAULT_LENGTH_CM, DEFAULT_LENGTH_CM),
        breadthCm: parsePositiveNumber(process.env.SHIPROCKET_DEFAULT_BREADTH_CM, DEFAULT_BREADTH_CM),
        heightCm: parsePositiveNumber(process.env.SHIPROCKET_DEFAULT_HEIGHT_CM, DEFAULT_HEIGHT_CM),
        weightKg: parsePositiveNumber(process.env.SHIPROCKET_DEFAULT_WEIGHT_KG, DEFAULT_WEIGHT_KG)
    },
    webhookSecret: normalizeEnvValue(process.env.SHIPROCKET_WEBHOOK_SECRET),
    webhookToken: normalizeEnvValue(process.env.SHIPROCKET_WEBHOOK_TOKEN)
});

const isShiprocketConfigured = () => {
    const config = getShiprocketConfig();

    if (!config.enabled) {
        return false;
    }

    return Boolean(config.email && config.password && config.baseUrl && config.pickupLocation);
};

const invalidateToken = () => {
    cachedToken = '';
    tokenCreatedAt = 0;
};

const isCachedTokenUsable = () => {
    const config = getShiprocketConfig();

    if (!cachedToken || !tokenCreatedAt) {
        return false;
    }

    const tokenAgeMs = Date.now() - tokenCreatedAt;
    return tokenAgeMs >= 0 && tokenAgeMs < Math.min(config.tokenRefreshAfterMs, config.tokenTtlMs);
};

const buildShiprocketConfigError = (message, statusCode = 503) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const extractShiprocketUpstreamError = (error) => {
    const upstreamStatusCode = Number(error?.response?.status || 0) || null;
    const upstreamPayload = error?.response?.data || null;
    const upstreamMessage = normalizeEnvValue(
        upstreamPayload?.message ||
            upstreamPayload?.error ||
            upstreamPayload?.detail ||
            upstreamPayload?.status ||
            error?.message
    );

    return {
        upstreamStatusCode,
        upstreamPayload,
        upstreamMessage
    };
};

const generateToken = async ({ force = false } = {}) => {
    const config = getShiprocketConfig();

    if (!config.enabled) {
        throw buildShiprocketConfigError('Shiprocket integration is disabled');
    }

    if (!isShiprocketConfigured()) {
        throw buildShiprocketConfigError('Shiprocket integration is not fully configured');
    }

    if (!force && isCachedTokenUsable()) {
        return cachedToken;
    }

    if (refreshPromise) {
        return refreshPromise;
    }

    refreshPromise = (async () => {
        try {
            shiprocketLog.info({ action: 'generate_token' }, 'Refreshing Shiprocket auth token');

            const response = await axios.post(
                `${config.baseUrl}/auth/login`,
                {
                    email: config.email,
                    password: config.password
                },
                {
                    timeout: config.timeoutMs,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            const token = normalizeEnvValue(response?.data?.token);
            if (!token) {
                throw new Error('Shiprocket auth response did not include a token');
            }

            cachedToken = token;
            tokenCreatedAt = Date.now();

            shiprocketLog.info(
                {
                    action: 'generate_token',
                    tokenCreatedAt
                },
                'Shiprocket auth token refreshed successfully'
            );

            return cachedToken;
        } catch (error) {
            invalidateToken();

            const {
                upstreamStatusCode,
                upstreamPayload,
                upstreamMessage
            } = extractShiprocketUpstreamError(error);
            const credentialHint =
                upstreamStatusCode === 403
                    ? ' Verify SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD are API user credentials created in Shiprocket Settings > API.'
                    : '';
            const normalizedMessage = `Failed to authenticate with Shiprocket${
                upstreamMessage ? `: ${upstreamMessage}` : ''
            }.${credentialHint}`.trim();

            shiprocketLog.error(
                {
                    action: 'generate_token',
                    statusCode: upstreamStatusCode,
                    errorMessage: upstreamMessage || error?.message || 'Failed to refresh Shiprocket token',
                    responseBody: upstreamPayload
                },
                'Failed to refresh Shiprocket auth token'
            );

            const normalizedError = buildShiprocketConfigError(normalizedMessage, 502);
            normalizedError.upstreamStatusCode = upstreamStatusCode;
            normalizedError.upstreamPayload = upstreamPayload;
            normalizedError.code = error?.code || '';
            normalizedError.cause = error;
            throw normalizedError;
        } finally {
            refreshPromise = null;
        }
    })();

    return refreshPromise;
};

const getValidToken = async () => {
    if (isCachedTokenUsable()) {
        return cachedToken;
    }

    return generateToken();
};

export {
    generateToken,
    getShiprocketConfig,
    getValidToken,
    invalidateToken,
    isShiprocketConfigured,
    isShiprocketEnabled
};
