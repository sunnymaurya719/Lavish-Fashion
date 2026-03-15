import crypto from 'crypto';
import idempotencyKeyModel from '../models/idempotencyKeyModel.js';

const hashPayload = (payload) => crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');

const beginIdempotentRequest = async ({ userId, scope, key, payload }) => {
    const requestHash = hashPayload(payload);

    const existing = await idempotencyKeyModel.findOne({ userId, scope, key });

    if (existing) {
        if (existing.requestHash !== requestHash) {
            return {
                action: 'conflict',
                statusCode: 409,
                body: {
                    success: false,
                    message: 'Idempotency key already used with different payload'
                }
            };
        }

        if (existing.state === 'completed') {
            return {
                action: 'replay',
                statusCode: existing.statusCode || 200,
                body: existing.responseBody || { success: true }
            };
        }

        return {
            action: 'in_progress',
            statusCode: 409,
            body: {
                success: false,
                message: 'Request with this idempotency key is already in progress'
            }
        };
    }

    try {
        const created = await idempotencyKeyModel.create({
            userId,
            scope,
            key,
            requestHash,
            state: 'in_progress'
        });

        return {
            action: 'proceed',
            recordId: created._id
        };
    } catch (error) {
        if (error?.code === 11000) {
            return {
                action: 'in_progress',
                statusCode: 409,
                body: {
                    success: false,
                    message: 'Request with this idempotency key is already in progress'
                }
            };
        }

        throw error;
    }
};

const completeIdempotentRequest = async ({ recordId, statusCode, body }) => {
    if (!recordId) {
        return;
    }

    await idempotencyKeyModel.findByIdAndUpdate(recordId, {
        state: 'completed',
        statusCode,
        responseBody: body
    });
};

export { beginIdempotentRequest, completeIdempotentRequest };
