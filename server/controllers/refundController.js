/**
 * HTTP controllers for the new refund subsystem. Thin glue between
 * Express, the validation layer, and `refundService`. All business
 * logic lives in the service.
 */

import crypto from 'crypto';

import refundModel from '../models/refundModel.js';
import * as ledgerService from '../services/ledgerService.js';
import * as refundService from '../services/refundService.js';
import { isRefundError, RefundError } from '../utils/refundErrors.js';
import { refundLogger, withRefundContext } from '../utils/structuredLogger.js';

const writeError = (res, error, fallbackStatus = 500) => {
    if (isRefundError(error)) {
        return res.status(error.statusCode || fallbackStatus).json({
            success: false,
            message: error.message,
            code: error.code,
            details: error.details || undefined
        });
    }
    refundLogger.error(
        { event: 'refund_controller_unexpected_error', err: error?.message, stack: error?.stack },
        'Unexpected error in refund controller'
    );
    return res.status(fallbackStatus).json({
        success: false,
        message: error?.message || 'Refund operation failed'
    });
};

/**
 * POST /api/refund
 * Body: refundInitiateSchema
 * Header: Idempotency-Key (preferred) OR body.idempotencyKey
 */
const initiateRefund = async (req, res) => {
    const log = withRefundContext(refundLogger, {
        adminEmail: req.admin?.email,
        route: 'POST /api/refund'
    });

    try {
        const idempotencyKey = req.idempotency?.key || req.body.idempotencyKey;
        if (!idempotencyKey) {
            return res.status(400).json({
                success: false,
                message: 'idempotencyKey is required (header Idempotency-Key or body.idempotencyKey)'
            });
        }

        const { refund, replayed } = await refundService.initiateRefund({
            orderId: req.body.orderId,
            amountInPaise: req.body.amountInPaise,
            reason: req.body.reason,
            notes: req.body.notes,
            idempotencyKey,
            approvedByAdminId: req.body.approvedByAdminId,
            approvedByAdminEmail: req.body.approvedByAdminEmail,
            metadata: req.body.metadata,
            admin: {
                id: req.admin.id,
                email: req.admin.email,
                role: req.admin.role
            },
            log
        });

        const statusCode = replayed ? 200 : 201;
        const responseBody = {
            success: true,
            message: replayed ? 'Refund already processed (idempotent replay)' : 'Refund initiated',
            data: { refund }
        };

        // Cache the response for future replays.
        if (req.idempotency?.complete) {
            req.idempotency.complete(statusCode, responseBody).catch((err) =>
                log.warn(
                    { event: 'refund_idempotency_complete_failed', err: err.message },
                    'Failed to mark idempotency record complete'
                )
            );
        }

        return res.status(statusCode).json(responseBody);
    } catch (error) {
        return writeError(res, error);
    }
};

/**
 * GET /api/refund/:id
 */
const getRefund = async (req, res) => {
    try {
        const refund = await refundModel.findById(req.params.id).lean();
        if (!refund) {
            return res.status(404).json({ success: false, message: 'Refund not found' });
        }
        return res.json({ success: true, data: { refund } });
    } catch (error) {
        return writeError(res, error);
    }
};

/**
 * GET /api/refund/order/:orderId
 */
const listOrderRefunds = async (req, res) => {
    try {
        const refunds = await refundModel
            .find({ orderId: req.params.orderId })
            .sort({ createdAt: -1 })
            .lean();
        return res.json({ success: true, data: { refunds } });
    } catch (error) {
        return writeError(res, error);
    }
};

/**
 * GET /api/refund/order/:orderId/ledger
 */
const getOrderLedger = async (req, res) => {
    try {
        const entries = await ledgerService.getOrderLedger(req.params.orderId);
        const balanceInPaise = await ledgerService.getBalance(req.params.orderId);
        return res.json({
            success: true,
            data: { entries, balanceInPaise }
        });
    } catch (error) {
        return writeError(res, error);
    }
};

/**
 * PATCH /api/refund/:id/mark-processed
 * Body: refundMarkProcessedSchema
 * Used by admins to clear a manual bank-transfer refund once the
 * UTR / NEFT confirmation lands.
 */
const markManualRefundProcessed = async (req, res) => {
    const log = withRefundContext(refundLogger, {
        refundId: req.params.id,
        adminEmail: req.admin?.email,
        route: 'PATCH /api/refund/:id/mark-processed'
    });

    try {
        const refund = await refundService.markManualRefundProcessed({
            refundId: req.params.id,
            utrReference: req.body.utrReference,
            notes: req.body.notes,
            admin: {
                id: req.admin.id,
                email: req.admin.email,
                role: req.admin.role
            },
            log
        });
        return res.json({
            success: true,
            message: 'Refund marked as processed',
            data: { refund }
        });
    } catch (error) {
        return writeError(res, error);
    }
};

/**
 * POST /api/refund/:id/retry
 * Admin-driven manual retry of a FAILED refund (in addition to the
 * background retry job).
 */
const retryRefund = async (req, res) => {
    const log = withRefundContext(refundLogger, {
        refundId: req.params.id,
        adminEmail: req.admin?.email,
        route: 'POST /api/refund/:id/retry'
    });
    try {
        const refund = await refundService.retry({ refundId: req.params.id, log });
        return res.json({ success: true, message: 'Refund retry attempted', data: { refund } });
    } catch (error) {
        return writeError(res, error);
    }
};

/**
 * Helper used by the legacy shim. Returns a deterministic idempotency
 * key derived from (orderId, amount, adminId) so that legacy callers
 * that re-submit the same form do not get a duplicate refund.
 */
const buildLegacyIdempotencyKey = ({ orderId, amountInPaise, adminId }) =>
    crypto
        .createHash('sha256')
        .update(`legacy:${orderId}:${amountInPaise}:${adminId || 'anon'}`)
        .digest('hex')
        .slice(0, 40);

export {
    buildLegacyIdempotencyKey,
    getOrderLedger,
    getRefund,
    initiateRefund,
    listOrderRefunds,
    markManualRefundProcessed,
    retryRefund,
    writeError
};

// Re-exporting RefundError for consumers that want to detect typed errors.
export { RefundError };
