/**
 * Refund subsystem routes. Mounted at `/api/refund` in app.js.
 */

import express from 'express';

import {
    getOrderLedger,
    getRefund,
    initiateRefund,
    listOrderRefunds,
    markManualRefundProcessed,
    retryRefund
} from '../controllers/refundController.js';
import { adminAuth, authorizePermissions } from '../middleware/permissions.js';
import refundIdempotency from '../middleware/refundIdempotency.js';
import enforceRefundLimits from '../middleware/refundPermissions.js';
import validateRequest from '../middleware/validateRequest.js';
import {
    refundIdParamSchema,
    refundInitiateSchema,
    refundMarkProcessedSchema,
    refundOrderIdParamSchema
} from '../validation/schemas.js';

const refundRouter = express.Router();

// Initiate a refund. Strict order: auth → permissions → body validation
// → role-based amount/dual-control gate → idempotency → controller.
refundRouter.post(
    '/',
    adminAuth,
    authorizePermissions('refunds.initiate'),
    validateRequest(refundInitiateSchema),
    enforceRefundLimits,
    refundIdempotency,
    initiateRefund
);

// Get a single refund by id.
refundRouter.get(
    '/:id',
    adminAuth,
    authorizePermissions('refunds.view'),
    validateRequest(refundIdParamSchema, 'params'),
    getRefund
);

// List all refunds for an order.
refundRouter.get(
    '/order/:orderId',
    adminAuth,
    authorizePermissions('refunds.view'),
    validateRequest(refundOrderIdParamSchema, 'params'),
    listOrderRefunds
);

// View the append-only ledger for an order.
refundRouter.get(
    '/order/:orderId/ledger',
    adminAuth,
    authorizePermissions('refunds.view_ledger'),
    validateRequest(refundOrderIdParamSchema, 'params'),
    getOrderLedger
);

// Mark a manual bank-transfer refund as processed (admin records UTR).
refundRouter.patch(
    '/:id/mark-processed',
    adminAuth,
    authorizePermissions('refunds.mark_processed'),
    validateRequest(refundIdParamSchema, 'params'),
    validateRequest(refundMarkProcessedSchema),
    markManualRefundProcessed
);

// Retry a FAILED refund. Reuses the same permissions as initiate.
refundRouter.post(
    '/:id/retry',
    adminAuth,
    authorizePermissions('refunds.initiate'),
    validateRequest(refundIdParamSchema, 'params'),
    retryRefund
);

export default refundRouter;
