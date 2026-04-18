import crypto from 'crypto';
import logger from '../config/logger.js';
import {
    getShiprocketWebhookDrainConfig,
    getShiprocketWebhookStatus,
    runShiprocketWebhookDrain
} from '../services/shiprocketWebhookService.js';

const normalizeText = (value) => String(value || '').trim();

const secureCompare = (leftValue, rightValue) => {
    const leftBuffer = Buffer.from(String(leftValue || ''), 'utf8');
    const rightBuffer = Buffer.from(String(rightValue || ''), 'utf8');

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const getCronAuthorizationHeader = (req) => normalizeText(req?.headers?.authorization);

const buildDrainLog = (req, mode) => (req.log?.child
    ? req.log.child({
        controller: 'shiprocketWebhookDrain',
        mode
    })
    : logger.child({
        controller: 'shiprocketWebhookDrain',
        mode
    }));

const validateCronSecret = (req) => {
    const cronSecret = normalizeText(process.env.CRON_SECRET);

    if (!cronSecret) {
        return {
            valid: false,
            configured: false
        };
    }

    const expectedAuthorization = `Bearer ${cronSecret}`;
    const receivedAuthorization = getCronAuthorizationHeader(req);

    return {
        valid: secureCompare(receivedAuthorization, expectedAuthorization),
        configured: true
    };
};

const buildManualOverrides = (body = {}) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return {};
    }

    return {
        batchSize: body.batchSize,
        timeBudgetMs: body.timeBudgetMs,
        processingStaleAfterMs: body.processingStaleAfterMs,
        lockTtlMs: body.lockTtlMs
    };
};

const handleShiprocketWebhookDrainCron = async (req, res) => {
    const drainLog = buildDrainLog(req, 'cron');
    const cronAuth = validateCronSecret(req);

    if (!cronAuth.configured) {
        drainLog.error('Rejected Shiprocket webhook drain because CRON_SECRET is not configured');
        return res.status(503).json({
            success: false,
            message: 'CRON_SECRET is not configured'
        });
    }

    if (!cronAuth.valid) {
        drainLog.warn(
            {
                userAgent: normalizeText(req?.headers?.['user-agent'])
            },
            'Rejected Shiprocket webhook drain because cron authorization failed'
        );
        return res.status(401).json({
            success: false,
            message: 'Unauthorized'
        });
    }

    try {
        const result = await runShiprocketWebhookDrain({
            trigger: 'cron',
            requestedBy: normalizeText(req?.headers?.['user-agent']) || 'cron',
            log: drainLog
        });

        return res.status(200).json(result);
    } catch (error) {
        drainLog.error(
            {
                err: error,
                errorMessage: error?.message || 'Shiprocket webhook drain failed'
            },
            'Shiprocket webhook drain failed during cron execution'
        );

        return res.status(500).json({
            success: false,
            message: error?.message || 'Shiprocket webhook drain failed'
        });
    }
};

const handleShiprocketWebhookDrainAdmin = async (req, res) => {
    const drainLog = buildDrainLog(req, 'admin');
    const overrides = buildManualOverrides(req.body);

    try {
        const result = await runShiprocketWebhookDrain({
            trigger: 'admin',
            requestedBy: normalizeText(req?.admin?.email) || 'admin',
            overrides,
            log: drainLog
        });

        return res.status(200).json(result);
    } catch (error) {
        drainLog.error(
            {
                err: error,
                errorMessage: error?.message || 'Manual Shiprocket webhook drain failed',
                requestedConfig: getShiprocketWebhookDrainConfig(overrides)
            },
            'Manual Shiprocket webhook drain failed'
        );

        return res.status(500).json({
            success: false,
            message: error?.message || 'Manual Shiprocket webhook drain failed'
        });
    }
};

const handleShiprocketWebhookStatus = async (req, res) => {
    const statusLog = buildDrainLog(req, 'status');

    try {
        const status = await getShiprocketWebhookStatus();

        statusLog.info(
            {
                requestedBy: normalizeText(req?.admin?.email) || 'admin',
                queue: status.queue,
                lastDrainRunTimestamp: status.drain.lastDrainRunTimestamp
            },
            'Fetched Shiprocket webhook queue status'
        );

        return res.status(200).json({
            success: true,
            ...status
        });
    } catch (error) {
        statusLog.error(
            {
                err: error,
                errorMessage: error?.message || 'Shiprocket webhook status lookup failed'
            },
            'Shiprocket webhook status lookup failed'
        );

        return res.status(500).json({
            success: false,
            message: error?.message || 'Shiprocket webhook status lookup failed'
        });
    }
};

export {
    handleShiprocketWebhookStatus,
    handleShiprocketWebhookDrainAdmin,
    handleShiprocketWebhookDrainCron
};
