import crypto from 'crypto';
import orderModel from '../models/orderModel.js';
import logger from '../config/logger.js';

const GRAPH_API_BASE_URL = 'https://graph.facebook.com';
const DEFAULT_GRAPH_API_VERSION = 'v25.0';
const DEFAULT_TEMPLATE_LANGUAGE_CODE = 'en_US';
const DEFAULT_LOCK_TTL_MS = 90 * 1000;
const DEFAULT_MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 250;
const EXPECTED_TEMPLATE_PARAMETER_COUNT = 4;
const MIN_E164_DIGITS = 8;
const MAX_E164_DIGITS = 15;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403]);
const REQUIRED_WHATSAPP_ENV_VARS = [
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_TEMPLATE_ORDER_PLACED',
    'WHATSAPP_TEMPLATE_OUT_FOR_DELIVERY',
    'WHATSAPP_TEMPLATE_DELIVERED',
    'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    'WHATSAPP_APP_SECRET'
];

const notificationConfigs = {
    placed: {
        templateEnv: 'WHATSAPP_TEMPLATE_ORDER_PLACED',
        defaultTemplate: 'order_placed',
        statusLabel: 'Order placed',
        sentField: 'placedSent',
        sendingField: 'placedSending',
        lockExpiresAtField: 'placedLockExpiresAt',
        lastAttemptAtField: 'placedLastAttemptAt',
        sentAtField: 'placedSentAt',
        messageIdField: 'placedMessageId',
        webhookStatusField: 'placedWebhookStatus',
        webhookTimestampField: 'placedWebhookTimestamp',
        lastErrorField: 'placedLastError'
    },
    shipped: {
        templateEnv: 'WHATSAPP_TEMPLATE_ORDER_SHIPPED',
        defaultTemplate: 'order_shipped',
        statusLabel: 'Shipped',
        sentField: 'shippedSent',
        sendingField: 'shippedSending',
        lockExpiresAtField: 'shippedLockExpiresAt',
        lastAttemptAtField: 'shippedLastAttemptAt',
        sentAtField: 'shippedSentAt',
        messageIdField: 'shippedMessageId',
        webhookStatusField: 'shippedWebhookStatus',
        webhookTimestampField: 'shippedWebhookTimestamp',
        lastErrorField: 'shippedLastError'
    },
    outForDelivery: {
        templateEnv: 'WHATSAPP_TEMPLATE_OUT_FOR_DELIVERY',
        defaultTemplate: 'order_out_for_delivery',
        statusLabel: 'Out for delivery',
        sentField: 'outForDeliverySent',
        sendingField: 'outForDeliverySending',
        lockExpiresAtField: 'outForDeliveryLockExpiresAt',
        lastAttemptAtField: 'outForDeliveryLastAttemptAt',
        sentAtField: 'outForDeliverySentAt',
        messageIdField: 'outForDeliveryMessageId',
        webhookStatusField: 'outForDeliveryWebhookStatus',
        webhookTimestampField: 'outForDeliveryWebhookTimestamp',
        lastErrorField: 'outForDeliveryLastError'
    },
    delivered: {
        templateEnv: 'WHATSAPP_TEMPLATE_DELIVERED',
        defaultTemplate: 'order_delivered',
        statusLabel: 'Delivered',
        sentField: 'deliveredSent',
        sendingField: 'deliveredSending',
        lockExpiresAtField: 'deliveredLockExpiresAt',
        lastAttemptAtField: 'deliveredLastAttemptAt',
        sentAtField: 'deliveredSentAt',
        messageIdField: 'deliveredMessageId',
        webhookStatusField: 'deliveredWebhookStatus',
        webhookTimestampField: 'deliveredWebhookTimestamp',
        lastErrorField: 'deliveredLastError'
    },
    cancelled: {
        templateEnv: 'WHATSAPP_TEMPLATE_ORDER_CANCELLED',
        defaultTemplate: 'order_cancelled',
        statusLabel: 'Cancelled',
        sentField: 'cancelledSent',
        sendingField: 'cancelledSending',
        lockExpiresAtField: 'cancelledLockExpiresAt',
        lastAttemptAtField: 'cancelledLastAttemptAt',
        sentAtField: 'cancelledSentAt',
        messageIdField: 'cancelledMessageId',
        webhookStatusField: 'cancelledWebhookStatus',
        webhookTimestampField: 'cancelledWebhookTimestamp',
        lastErrorField: 'cancelledLastError'
    }
};

const normalizeEnvValue = (value) => String(value || '').trim();
const getNotificationPath = (fieldName) => `whatsappNotifications.${fieldName}`;
const truncateMessage = (value, maxLength = 300) => String(value || '').trim().slice(0, maxLength);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeCountryDialCode = (value) => String(value || '').replace(/[^\d]/g, '');
const normalizePhoneDigits = (value) => {
    const digitsOnly = String(value || '').replace(/[^\d]/g, '');
    return digitsOnly.startsWith('00') ? digitsOnly.slice(2) : digitsOnly;
};
const parsePositiveIntegerConfig = (value, fallbackValue) => {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? Math.floor(parsedValue) : fallbackValue;
};
const getRetryDelayMs = (attempt) => BASE_RETRY_DELAY_MS * (2 ** Math.max(attempt - 1, 0));
const isValidE164Digits = (value) => {
    const digitCount = String(value || '').length;
    return /^\d+$/.test(String(value || '')) && digitCount >= MIN_E164_DIGITS && digitCount <= MAX_E164_DIGITS;
};

let cachedWhatsAppConfig = null;

class WhatsAppRequestError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'WhatsAppRequestError';
        Object.assign(this, details);
    }
}

const getNotificationConfig = (notificationType) => {
    const config = notificationConfigs[notificationType];

    if (!config) {
        throw new Error(`Unsupported WhatsApp notification type: ${notificationType}`);
    }

    return config;
};

const loadWhatsAppConfig = () => {
    const missingEnvVars = REQUIRED_WHATSAPP_ENV_VARS.filter((envName) => !normalizeEnvValue(process.env[envName]));

    if (missingEnvVars.length > 0) {
        throw new Error(
            `Missing required WhatsApp environment variables: ${missingEnvVars.join(', ')}`
        );
    }

    const phoneNumberId = normalizeEnvValue(process.env.WHATSAPP_PHONE_NUMBER_ID);
    if (!/^\d+$/.test(phoneNumberId)) {
        throw new Error('WHATSAPP_PHONE_NUMBER_ID must contain only digits');
    }

    const defaultCountryCode = normalizeCountryDialCode(process.env.WHATSAPP_DEFAULT_COUNTRY_CODE);
    if (defaultCountryCode && !/^\d{1,4}$/.test(defaultCountryCode)) {
        throw new Error('WHATSAPP_DEFAULT_COUNTRY_CODE must contain 1 to 4 digits');
    }

    const templateNames = Object.entries(notificationConfigs).reduce((accumulator, [notificationType, config]) => {
        const templateName = normalizeEnvValue(process.env[config.templateEnv] || config.defaultTemplate);

        if (!templateName) {
            throw new Error(`Missing WhatsApp template name for ${notificationType}`);
        }

        accumulator[notificationType] = templateName;
        return accumulator;
    }, {});

    return {
        accessToken: normalizeEnvValue(process.env.WHATSAPP_ACCESS_TOKEN),
        appSecret: normalizeEnvValue(process.env.WHATSAPP_APP_SECRET),
        defaultCountryCode,
        graphApiVersion: normalizeEnvValue(process.env.WHATSAPP_GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION),
        maxRetryAttempts: parsePositiveIntegerConfig(process.env.WHATSAPP_MAX_RETRIES, DEFAULT_MAX_RETRIES),
        notificationLockTtlMs: parsePositiveIntegerConfig(
            process.env.WHATSAPP_NOTIFICATION_LOCK_TTL_MS,
            DEFAULT_LOCK_TTL_MS
        ),
        phoneNumberId,
        templateLanguageCode: normalizeEnvValue(
            process.env.WHATSAPP_TEMPLATE_LANGUAGE_CODE || DEFAULT_TEMPLATE_LANGUAGE_CODE
        ),
        templateNames,
        webhookVerifyToken: normalizeEnvValue(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)
    };
};

const getWhatsAppConfig = () => {
    if (!cachedWhatsAppConfig) {
        cachedWhatsAppConfig = Object.freeze(loadWhatsAppConfig());
    }

    return cachedWhatsAppConfig;
};

const inferCountryDialCode = (order = {}) => {
    const { defaultCountryCode } = getWhatsAppConfig();

    if (defaultCountryCode) {
        return defaultCountryCode;
    }

    const normalizedCountry = String(order?.address?.country || '')
        .trim()
        .toLowerCase();

    if (normalizedCountry === 'india' || normalizedCountry === 'in') {
        return '91';
    }

    return '';
};

/**
 * Normalize stored delivery numbers into the digit-only E.164 shape expected by
 * the WhatsApp Cloud API. We accept common local formats, infer the country
 * code when possible, and reject anything outside the 8-15 digit range.
 */
const resolveRecipientPhone = (order = {}) => {
    const normalizedPhone = normalizePhoneDigits(order?.phone || order?.address?.phone || '');
    const countryDialCode = inferCountryDialCode(order);

    if (!normalizedPhone) {
        return '';
    }

    let recipientPhone = normalizedPhone;

    if (countryDialCode) {
        if (recipientPhone.length === 10) {
            recipientPhone = `${countryDialCode}${recipientPhone}`;
        } else if (recipientPhone.length === 11 && recipientPhone.startsWith('0')) {
            recipientPhone = `${countryDialCode}${recipientPhone.slice(1)}`;
        }
    }

    return isValidE164Digits(recipientPhone) ? recipientPhone : '';
};

const resolveRecipientPhoneInput = (value = '') => {
    const normalizedPhone = normalizePhoneDigits(value);
    return isValidE164Digits(normalizedPhone) ? normalizedPhone : '';
};

const getCustomerName = (order = {}) => {
    const nameParts = [
        normalizeEnvValue(order?.address?.firstName),
        normalizeEnvValue(order?.address?.lastName)
    ].filter(Boolean);

    return nameParts.join(' ') || 'Customer';
};

const getOrderCode = (orderId = '') => {
    const normalizedOrderId = normalizeEnvValue(orderId);
    return normalizedOrderId ? `LF-${normalizedOrderId.slice(-8).toUpperCase()}` : '';
};

const getOrderTemplateCode = (order = {}) => {
    const preferredCode =
        normalizeEnvValue(order?.shiprocket?.referenceOrderId) ||
        normalizeEnvValue(order?.publicOrderCode) ||
        normalizeEnvValue(order?._id);

    return getOrderCode(preferredCode);
};

const formatOrderAmount = (value) => {
    const amount = Number(value);

    if (!Number.isFinite(amount) || amount < 0) {
        return '';
    }

    const roundedAmount = Math.round((amount + Number.EPSILON) * 100) / 100;
    return Number.isInteger(roundedAmount) ? String(roundedAmount) : roundedAmount.toFixed(2);
};

const getTemplateName = (notificationType) => {
    const { templateNames } = getWhatsAppConfig();
    return normalizeEnvValue(templateNames[notificationType]);
};

const sanitizeTemplateParameter = (value, label) => {
    const sanitizedValue = normalizeEnvValue(value);

    if (!sanitizedValue) {
        throw new Error(`WhatsApp template parameter "${label}" cannot be empty`);
    }

    return sanitizedValue;
};

const buildOrderTemplateParameters = (order, statusLabel) => {
    const parameterValues = [
        sanitizeTemplateParameter(getCustomerName(order), 'customerName'),
        sanitizeTemplateParameter(getOrderTemplateCode(order), 'orderCode'),
        sanitizeTemplateParameter(formatOrderAmount(order?.amount), 'orderAmount'),
        sanitizeTemplateParameter(statusLabel, 'deliveryStatus')
    ];

    if (parameterValues.length !== EXPECTED_TEMPLATE_PARAMETER_COUNT) {
        throw new Error(
            `WhatsApp template payload must include exactly ${EXPECTED_TEMPLATE_PARAMETER_COUNT} parameters`
        );
    }

    return parameterValues;
};

const buildDirectTemplateParameters = (parameters = []) => {
    if (!Array.isArray(parameters) || parameters.length === 0) {
        throw new Error('WhatsApp template parameters must be a non-empty array');
    }

    return parameters.map((parameter, index) =>
        sanitizeTemplateParameter(parameter, `parameter_${index + 1}`)
    );
};

const buildRequestLogPayload = (payload = {}) => ({
    messaging_product: payload.messaging_product,
    recipient_type: payload.recipient_type,
    to: normalizeEnvValue(payload.to),
    type: payload.type,
    template: {
        name: normalizeEnvValue(payload?.template?.name),
        language: {
            code: normalizeEnvValue(payload?.template?.language?.code)
        },
        components: (Array.isArray(payload?.template?.components) ? payload.template.components : []).map((component) => ({
            type: component?.type,
            parameters: (Array.isArray(component?.parameters) ? component.parameters : []).map((parameter) => ({
                type: parameter?.type,
                text: normalizeEnvValue(parameter?.text)
            }))
        }))
    }
});

const buildTemplateLogContext = (requestPayload = {}) => ({
    templateName: requestPayload?.template?.name || '',
    recipientPhone: requestPayload?.to || '',
    parameters: requestPayload?.template?.components?.[0]?.parameters?.map((parameter) => parameter.text) || []
});

const buildTemplatePayload = ({ order, notificationType }) => {
    const config = getWhatsAppConfig();
    const templateName = getTemplateName(notificationType);
    const recipientPhone = resolveRecipientPhone(order);
    const { statusLabel } = getNotificationConfig(notificationType);
    const parameterValues = buildOrderTemplateParameters(order, statusLabel);

    if (!templateName) {
        throw new Error(`WhatsApp template name is missing for ${notificationType}`);
    }

    if (!recipientPhone) {
        throw new Error('Order is missing a valid WhatsApp-compatible phone number');
    }

    return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientPhone,
        type: 'template',
        template: {
            name: templateName,
            language: {
                code: config.templateLanguageCode
            },
            components: [
                {
                    type: 'body',
                    parameters: parameterValues.map((text) => ({
                        type: 'text',
                        text
                    }))
                }
            ]
        }
    };
};

const buildDirectTemplatePayload = ({ to, templateName, parameters, languageCode }) => {
    const config = getWhatsAppConfig();
    const recipientPhone = resolveRecipientPhoneInput(to);
    const normalizedTemplateName = normalizeEnvValue(templateName);
    const parameterValues = buildDirectTemplateParameters(parameters);

    if (!normalizedTemplateName) {
        throw new Error('WhatsApp template name is required');
    }

    if (!recipientPhone) {
        throw new Error('A valid WhatsApp recipient phone number is required');
    }

    return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientPhone,
        type: 'template',
        template: {
            name: normalizedTemplateName,
            language: {
                code: normalizeEnvValue(languageCode || config.templateLanguageCode)
            },
            components: [
                {
                    type: 'body',
                    parameters: parameterValues.map((text) => ({
                        type: 'text',
                        text
                    }))
                }
            ]
        }
    };
};

const parseResponseJson = async (response) => {
    const responseText = typeof response?.text === 'function' ? await response.text() : '';

    if (!responseText) {
        return {};
    }

    try {
        return JSON.parse(responseText);
    } catch {
        return {
            rawResponseBody: responseText
        };
    }
};

const buildGraphApiErrorMessage = (statusCode, payload = {}) => {
    const apiError = payload?.error || {};
    const fragments = [
        apiError.message,
        apiError.error_user_title,
        apiError.error_user_msg
    ].filter(Boolean);

    if (fragments.length > 0) {
        return `WhatsApp API ${statusCode}: ${fragments.join(' | ')}`;
    }

    return `WhatsApp API request failed with status ${statusCode}`;
};

const normalizeWhatsAppRequestError = (error, details = {}) => {
    if (error instanceof WhatsAppRequestError) {
        return error;
    }

    return new WhatsAppRequestError(error?.message || 'WhatsApp API request failed', details);
};

const shouldRetryRequestError = (error) => {
    if (Number.isFinite(error?.statusCode)) {
        if (NON_RETRYABLE_STATUS_CODES.has(error.statusCode)) {
            return false;
        }

        return RETRYABLE_STATUS_CODES.has(error.statusCode);
    }

    return true;
};

/**
 * Send a template message through the Meta Cloud API with structured logging
 * and exponential backoff. Client-side validation errors fail fast, while
 * transient platform or network failures retry at 250ms, 500ms, and 1000ms.
 */
const sendTemplateMessageRequest = async (payload, { log }) => {
    const config = getWhatsAppConfig();
    const endpoint = `${GRAPH_API_BASE_URL}/${config.graphApiVersion}/${config.phoneNumberId}/messages`;
    const requestPayload = buildRequestLogPayload(payload);
    const templateLogContext = buildTemplateLogContext(requestPayload);

    log?.debug(
        {
            endpoint,
            ...templateLogContext
        },
        'Sending WhatsApp template message'
    );

    for (let attempt = 1; attempt <= config.maxRetryAttempts; attempt += 1) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const responseBody = await parseResponseJson(response);

            if (response.ok) {
                return {
                    messageId: normalizeEnvValue(responseBody?.messages?.[0]?.id),
                    responseBody
                };
            }

            const requestError = new WhatsAppRequestError(
                buildGraphApiErrorMessage(response.status, responseBody),
                {
                    endpoint,
                    requestPayload,
                    responseBody,
                    statusCode: response.status
                }
            );

            if (attempt < config.maxRetryAttempts && shouldRetryRequestError(requestError)) {
                const retryDelayMs = getRetryDelayMs(attempt);

                log?.warn(
                    {
                        attempt,
                        endpoint,
                        ...templateLogContext,
                        requestPayload,
                        responseBody,
                        retryDelayMs,
                        statusCode: response.status
                    },
                    'Retrying WhatsApp API request after transient API failure'
                );

                await delay(retryDelayMs);
                continue;
            }

            throw requestError;
        } catch (error) {
            const requestError = normalizeWhatsAppRequestError(error, {
                endpoint,
                requestPayload
            });

            if (Number.isFinite(requestError.statusCode)) {
                throw requestError;
            }

            if (attempt < config.maxRetryAttempts && shouldRetryRequestError(requestError)) {
                const retryDelayMs = getRetryDelayMs(attempt);

                log?.warn(
                    {
                        attempt,
                        endpoint,
                        ...templateLogContext,
                        errorMessage: requestError.message,
                        requestPayload,
                        retryDelayMs
                    },
                    'Retrying WhatsApp API request after network failure'
                );

                await delay(retryDelayMs);
                continue;
            }

            throw requestError;
        }
    }

    throw new WhatsAppRequestError('WhatsApp API request failed after all retries', {
        endpoint,
        requestPayload
    });
};

const acquireNotificationLock = async (orderId, notificationType) => {
    const config = getNotificationConfig(notificationType);
    const now = Date.now();
    const lockExpiresAt = now + getWhatsAppConfig().notificationLockTtlMs;

    return orderModel.findOneAndUpdate(
        {
            _id: orderId,
            [getNotificationPath(config.sentField)]: { $ne: true },
            $or: [
                { [getNotificationPath(config.sendingField)]: { $ne: true } },
                { [getNotificationPath(config.lockExpiresAtField)]: null },
                { [getNotificationPath(config.lockExpiresAtField)]: { $exists: false } },
                { [getNotificationPath(config.lockExpiresAtField)]: { $lte: now } }
            ]
        },
        {
            $set: {
                [getNotificationPath(config.sendingField)]: true,
                [getNotificationPath(config.lockExpiresAtField)]: lockExpiresAt,
                [getNotificationPath(config.lastAttemptAtField)]: now,
                [getNotificationPath(config.lastErrorField)]: ''
            }
        },
        { new: true }
    );
};

const markNotificationSuccess = async (orderId, notificationType, messageId = '') => {
    const config = getNotificationConfig(notificationType);
    const now = Date.now();

    return orderModel.findByIdAndUpdate(
        orderId,
        {
            $set: {
                [getNotificationPath(config.sentField)]: true,
                [getNotificationPath(config.sendingField)]: false,
                [getNotificationPath(config.lockExpiresAtField)]: null,
                [getNotificationPath(config.sentAtField)]: now,
                [getNotificationPath(config.messageIdField)]: messageId,
                [getNotificationPath(config.webhookStatusField)]: 'accepted',
                [getNotificationPath(config.webhookTimestampField)]: now,
                [getNotificationPath(config.lastErrorField)]: ''
            }
        },
        { new: true }
    );
};

const markNotificationFailure = async (orderId, notificationType, error) => {
    const config = getNotificationConfig(notificationType);

    return orderModel.findByIdAndUpdate(
        orderId,
        {
            $set: {
                [getNotificationPath(config.sendingField)]: false,
                [getNotificationPath(config.lockExpiresAtField)]: null,
                [getNotificationPath(config.lastErrorField)]: truncateMessage(
                    error?.message || 'WhatsApp send failed',
                    320
                )
            }
        },
        { new: true }
    );
};

const buildNotificationLogger = ({ log, notificationType, orderId }) => {
    if (log?.child) {
        return log.child({
            integration: 'whatsapp',
            notificationType,
            orderId: String(orderId || '')
        });
    }

    return logger.child({
        integration: 'whatsapp',
        notificationType,
        orderId: String(orderId || '')
    });
};

const sendOrderNotification = async (order, notificationType, options = {}) => {
    const orderId = String(order?._id || '');

    if (!orderId) {
        return {
            success: false,
            skipped: true,
            reason: 'missing_order_id'
        };
    }

    const notificationLog = buildNotificationLogger({
        log: options.log,
        notificationType,
        orderId
    });

    try {
        const lockedOrder = await acquireNotificationLock(orderId, notificationType);

        if (!lockedOrder) {
            notificationLog.info('Skipping WhatsApp notification because it is already sent or currently in flight');
            return {
                success: true,
                skipped: true,
                reason: 'already_sent_or_in_flight'
            };
        }

        const payload = buildTemplatePayload({ order: lockedOrder, notificationType });
        const result = await sendTemplateMessageRequest(payload, {
            log: notificationLog
        });

        await markNotificationSuccess(orderId, notificationType, result.messageId);

        notificationLog.info(
            {
                messageId: result.messageId,
                recipientPhone: payload.to,
                templateName: payload.template.name
            },
            'WhatsApp template message sent successfully'
        );

        return {
            success: true,
            skipped: false,
            messageId: result.messageId
        };
    } catch (error) {
        await markNotificationFailure(orderId, notificationType, error).catch(() => null);
        notificationLog.error(
            {
                errorMessage: error?.message || 'WhatsApp send failed',
                requestPayload: error?.requestPayload,
                responseBody: error?.responseBody,
                statusCode: error?.statusCode
            },
            'WhatsApp template message failed'
        );

        return {
            success: false,
            skipped: false,
            error: truncateMessage(error?.message || 'WhatsApp send failed', 320)
        };
    }
};

const parseWebhookTimestamp = (value) => {
    const numericValue = Number(value || 0);

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return null;
    }

    return numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue;
};

const extractWebhookErrorMessage = (errors = []) => {
    const firstError = Array.isArray(errors) ? errors[0] : null;

    if (!firstError || typeof firstError !== 'object') {
        return '';
    }

    return truncateMessage(
        firstError.message || firstError.title || firstError.error_user_msg || firstError.error_data?.details || '',
        320
    );
};

const findNotificationTypeByMessageId = (order, messageId) => Object.entries(notificationConfigs).find(([, config]) =>
    String(order?.whatsappNotifications?.[config.messageIdField] || '') === String(messageId || '')
)?.[0] || '';

const updateNotificationWebhookStatus = async ({ messageId, status, timestamp, errors = [] }) => {
    if (!messageId) {
        return null;
    }

    const order = await orderModel.findOne({
        $or: Object.values(notificationConfigs).map((config) => ({
            [getNotificationPath(config.messageIdField)]: String(messageId)
        }))
    });

    if (!order) {
        return null;
    }

    const notificationType = findNotificationTypeByMessageId(order, messageId);

    if (!notificationType) {
        return null;
    }

    const config = getNotificationConfig(notificationType);
    const webhookTimestamp = parseWebhookTimestamp(timestamp);
    const errorMessage = extractWebhookErrorMessage(errors);

    await orderModel.findByIdAndUpdate(order._id, {
        $set: {
            [getNotificationPath(config.webhookStatusField)]: truncateMessage(status || '', 60),
            [getNotificationPath(config.webhookTimestampField)]: webhookTimestamp,
            [getNotificationPath(config.lastErrorField)]:
                errorMessage || order?.whatsappNotifications?.[config.lastErrorField] || ''
        }
    });

    return {
        orderId: String(order._id),
        notificationType
    };
};

const captureRawRequestBody = (req, _res, buffer) => {
    req.rawBody = Buffer.isBuffer(buffer)
        ? Buffer.from(buffer)
        : Buffer.from(String(buffer || ''), 'utf8');
};

const secureCompare = (leftValue, rightValue) => {
    const leftBuffer = Buffer.from(String(leftValue || ''), 'utf8');
    const rightBuffer = Buffer.from(String(rightValue || ''), 'utf8');

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

/**
 * Verify Meta's x-hub-signature-256 using the raw request body captured by the
 * JSON parser verify hook. When the raw body is missing or malformed, we log
 * the attempt and fail safely instead of trusting the payload.
 */
const isValidWhatsAppWebhookSignature = (req, log) => {
    const { appSecret } = getWhatsAppConfig();

    if (!appSecret) {
        return true;
    }

    const signatureHeader = normalizeEnvValue(req?.headers?.['x-hub-signature-256']);

    if (!Buffer.isBuffer(req?.rawBody) || req.rawBody.length === 0) {
        log?.warn(
            {
                hasRawBody: false,
                signaturePresent: Boolean(signatureHeader)
            },
            'Rejected WhatsApp webhook event because rawBody was not captured'
        );
        return false;
    }

    if (!signatureHeader.startsWith('sha256=')) {
        log?.warn(
            {
                hasRawBody: true,
                signaturePresent: Boolean(signatureHeader)
            },
            'Rejected WhatsApp webhook event because the signature header was missing or malformed'
        );
        return false;
    }

    const expectedSignature = `sha256=${crypto
        .createHmac('sha256', appSecret)
        .update(req.rawBody)
        .digest('hex')}`;

    return secureCompare(expectedSignature, signatureHeader);
};

const extractWebhookStatusEntries = (payload = {}) => {
    const entries = Array.isArray(payload?.entry) ? payload.entry : [];

    return entries.flatMap((entry) =>
        (Array.isArray(entry?.changes) ? entry.changes : []).flatMap((change) =>
            (Array.isArray(change?.value?.statuses) ? change.value.statuses : []).map((statusEntry) => ({
                errors: Array.isArray(statusEntry?.errors) ? statusEntry.errors : [],
                messageId: normalizeEnvValue(statusEntry?.id),
                status: normalizeEnvValue(statusEntry?.status),
                timestamp: statusEntry?.timestamp
            }))
        )
    );
};

const sendOrderPlacedMessage = async (order, options = {}) => sendOrderNotification(order, 'placed', options);
const sendShippedMessage = async (order, options = {}) => sendOrderNotification(order, 'shipped', options);
const sendOutForDeliveryMessage = async (order, options = {}) => sendOrderNotification(order, 'outForDelivery', options);
const sendDeliveredMessage = async (order, options = {}) => sendOrderNotification(order, 'delivered', options);
const sendCancelledMessage = async (order, options = {}) => sendOrderNotification(order, 'cancelled', options);

const sendTemplateMessage = async ({ to, templateName, parameters, languageCode, log } = {}) => {
    const templateLog = log?.child
        ? log.child({ integration: 'whatsapp', action: 'send_template_message' })
        : logger.child({ integration: 'whatsapp', action: 'send_template_message' });

    const payload = buildDirectTemplatePayload({
        to,
        templateName,
        parameters,
        languageCode
    });
    const result = await sendTemplateMessageRequest(payload, {
        log: templateLog
    });

    return {
        success: true,
        messageId: result.messageId,
        responseBody: result.responseBody
    };
};

const handleWhatsAppWebhookVerification = async (req, res) => {
    try {
        const { webhookVerifyToken } = getWhatsAppConfig();
        const mode = normalizeEnvValue(req?.query?.['hub.mode']);
        const challenge = normalizeEnvValue(req?.query?.['hub.challenge']);
        const providedToken = normalizeEnvValue(req?.query?.['hub.verify_token']);

        if (!webhookVerifyToken) {
            return res.status(503).send('WhatsApp webhook verify token is not configured');
        }

        if (mode === 'subscribe' && providedToken && secureCompare(webhookVerifyToken, providedToken)) {
            return res.status(200).send(challenge);
        }

        return res.sendStatus(403);
    } catch (error) {
        logger.error(
            {
                errorMessage: error?.message || 'WhatsApp webhook verification failed'
            },
            'Failed to verify WhatsApp webhook subscription'
        );
        return res.status(503).send('WhatsApp webhook verification is unavailable');
    }
};

const handleWhatsAppWebhookEvent = async (req, res) => {
    const webhookLog = buildNotificationLogger({
        log: req.log,
        notificationType: 'webhook',
        orderId: ''
    });

    try {
        if (!isValidWhatsAppWebhookSignature(req, webhookLog)) {
            webhookLog.warn(
                {
                    hasRawBody: Buffer.isBuffer(req?.rawBody),
                    signatureHeaderPresent: Boolean(req?.headers?.['x-hub-signature-256'])
                },
                'Rejected WhatsApp webhook event because the signature was invalid'
            );
            return res.status(401).json({ success: false, message: 'Invalid WhatsApp webhook signature' });
        }

        const statusEntries = extractWebhookStatusEntries(req.body);
        const updateResults = [];

        for (const entry of statusEntries) {
            const updateResult = await updateNotificationWebhookStatus(entry);

            if (updateResult) {
                updateResults.push(updateResult);
            }
        }

        webhookLog.info(
            {
                receivedStatusCount: statusEntries.length,
                updatedStatusCount: updateResults.length
            },
            'Processed WhatsApp webhook event'
        );

        return res.status(200).json({ received: true });
    } catch (error) {
        webhookLog.error(
            {
                errorMessage: error?.message || 'Failed to process WhatsApp webhook'
            },
            'WhatsApp webhook processing failed'
        );

        return res.status(500).json({ success: false, message: 'Failed to process WhatsApp webhook' });
    }
};

export {
    captureRawRequestBody,
    handleWhatsAppWebhookEvent,
    handleWhatsAppWebhookVerification,
    sendCancelledMessage,
    sendDeliveredMessage,
    sendOrderPlacedMessage,
    sendShippedMessage,
    sendOutForDeliveryMessage,
    sendTemplateMessage
};
