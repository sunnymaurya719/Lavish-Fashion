import logger from '../config/logger.js';
import {
    isShiprocketWebhookAuthorized,
    recordShiprocketWebhookEvent,
    sanitizeWebhookHeaders,
    scheduleShiprocketWebhookProcessing
} from '../services/shiprocketWebhookService.js';

const handleShiprocketWebhook = async (req, res) => {
    const requestStartedAt = Date.now();
    const webhookLog = req.log?.child
        ? req.log.child({ controller: 'shiprocketWebhook' })
        : logger.child({ controller: 'shiprocketWebhook' });

    if (!isShiprocketWebhookAuthorized(req)) {
        webhookLog.warn(
            {
                headers: sanitizeWebhookHeaders(req.headers)
            },
            'Rejected Shiprocket webhook because x-api-key validation failed'
        );

        return res.status(403).json({
            success: false,
            message: 'Invalid Shiprocket webhook credentials'
        });
    }

    try {
        const eventRecord = await recordShiprocketWebhookEvent({
            payload: req.body || {},
            headers: req.headers,
            requestId: req.requestId || req.id || '',
            log: webhookLog
        });
        let backgroundDispatch = 'duplicate';

        if (!eventRecord.duplicate && eventRecord.eventId) {
            backgroundDispatch = scheduleShiprocketWebhookProcessing({
                eventId: eventRecord.eventId,
                waitUntil: req.waitUntil || res.locals?.waitUntil,
                log: webhookLog
            });
        }

        webhookLog.info(
            {
                eventId: eventRecord.eventId,
                eventKey: eventRecord.eventKey,
                duplicate: eventRecord.duplicate,
                backgroundDispatch,
                responseTimeMs: Date.now() - requestStartedAt
            },
            'Acknowledged Shiprocket webhook request'
        );

        return res.status(200).json({
            received: true,
            duplicate: eventRecord.duplicate
        });
    } catch (error) {
        webhookLog.error(
            {
                err: error,
                errorMessage: error?.message || 'Shiprocket webhook enqueue failed'
            },
            'Shiprocket webhook enqueue failed after request acceptance'
        );

        // Shiprocket retries aggressively on non-200 responses. Once the caller
        // is authenticated, fail safe and acknowledge the delivery attempt.
        return res.status(200).json({
            received: true
        });
    }
};

export { handleShiprocketWebhook };
