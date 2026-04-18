import jwt from 'jsonwebtoken';
import request from 'supertest';
import shiprocketWebhookEventModel from '../../models/shiprocketWebhookEventModel.js';
import { recordShiprocketWebhookEvent } from '../../services/shiprocketWebhookService.js';

const createAdminAuthToken = (email = process.env.ADMIN_EMAIL) =>
    jwt.sign(
        {
            role: 'admin',
            email
        },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );

const insertShiprocketWebhookPayload = async ({
    payload,
    headers = {},
    requestId = 'shiprocket_test_request',
    processingStatus = 'queued',
    processingAttempts = 0,
    lastProcessingStartedAt = null,
    nextRetryAt = null
} = {}) => {
    const eventRecord = await recordShiprocketWebhookEvent({
        payload: payload || {},
        headers: {
            'x-api-key': process.env.SHIPROCKET_WEBHOOK_API_KEY,
            ...headers
        },
        requestId
    });

    if (!eventRecord.eventId || processingStatus === 'queued') {
        return eventRecord;
    }

    await shiprocketWebhookEventModel.findByIdAndUpdate(eventRecord.eventId, {
        $set: {
            processingStatus,
            processingAttempts,
            lastProcessingStartedAt,
            nextRetryAt
        }
    });

    return {
        ...eventRecord,
        eventId: String(eventRecord.eventId)
    };
};

const triggerShiprocketWebhookDrain = async ({
    app,
    mode = 'cron',
    overrides = {},
    cronSecret = process.env.CRON_SECRET,
    adminEmail = process.env.ADMIN_EMAIL
} = {}) => {
    if (mode === 'admin') {
        return request(app)
            .post('/api/system/shiprocket/webhook-drain')
            .set('Authorization', `Bearer ${createAdminAuthToken(adminEmail)}`)
            .send(overrides);
    }

    return request(app)
        .get('/api/system/shiprocket/webhook-drain')
        .set('Authorization', `Bearer ${cronSecret}`)
        .set('User-Agent', 'vercel-cron/1.0');
};

const fetchShiprocketWebhookStatus = async ({
    app,
    adminEmail = process.env.ADMIN_EMAIL
} = {}) =>
    request(app)
        .get('/api/system/shiprocket/webhook-status')
        .set('Authorization', `Bearer ${createAdminAuthToken(adminEmail)}`);

export {
    createAdminAuthToken,
    fetchShiprocketWebhookStatus,
    insertShiprocketWebhookPayload,
    triggerShiprocketWebhookDrain
};
