/**
 * Express middleware: applies the existing `idempotencyService` to
 * refund initiation requests. Scope = `'order:refund'`.
 *
 * On success attaches `req.idempotency = { key, recordId, complete }`.
 * The controller MUST call `req.idempotency.complete(statusCode, body)`
 * after responding so future replays return the same payload.
 *
 * Replays / conflicts / in-progress are short-circuited with the
 * appropriate response BEFORE the controller runs.
 */

import {
    beginIdempotentRequest,
    completeIdempotentRequest
} from '../services/idempotencyService.js';
import { refundLogger } from '../utils/structuredLogger.js';

const HEADER = 'idempotency-key';
const SCOPE = 'order:refund';

const refundIdempotency = async (req, res, next) => {
    const key =
        req.get(HEADER) ||
        req.get('Idempotency-Key') ||
        req.body?.idempotencyKey;

    if (!key || typeof key !== 'string') {
        return res.status(400).json({
            success: false,
            message: 'Idempotency-Key header (or body.idempotencyKey) is required'
        });
    }
    if (key.length > 120) {
        return res.status(400).json({
            success: false,
            message: 'Idempotency-Key must be ≤ 120 characters'
        });
    }

    const userId = req.admin?.id || req.user?._id || req.user?.id;
    if (!userId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    try {
        const result = await beginIdempotentRequest({
            userId,
            scope: SCOPE,
            key,
            payload: req.body
        });

        if (result.action === 'replay') {
            refundLogger.info(
                { event: 'refund_idempotency_replay', key, userId: String(userId) },
                'Replaying cached refund response'
            );
            return res.status(result.statusCode || 200).json(result.body);
        }

        if (result.action === 'conflict' || result.action === 'in_progress') {
            return res.status(result.statusCode || 409).json(result.body);
        }

        if (result.action !== 'proceed') {
            refundLogger.error(
                { event: 'refund_idempotency_unknown_action', action: result.action },
                'Unknown action returned by idempotencyService'
            );
            return res.status(500).json({
                success: false,
                message: 'Idempotency service error'
            });
        }

        // Hand-off to the controller.
        req.idempotency = {
            key,
            recordId: result.recordId,
            complete: (statusCode, body) =>
                completeIdempotentRequest({
                    recordId: result.recordId,
                    statusCode,
                    body
                })
        };
        return next();
    } catch (error) {
        refundLogger.error(
            { event: 'refund_idempotency_failed', err: error.message, key },
            'Idempotency middleware threw'
        );
        return res.status(500).json({
            success: false,
            message: 'Failed to process idempotency check'
        });
    }
};

export default refundIdempotency;
export { refundIdempotency, SCOPE as REFUND_IDEMPOTENCY_SCOPE };
