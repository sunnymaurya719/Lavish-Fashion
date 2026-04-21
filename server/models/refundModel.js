import mongoose from 'mongoose';

import { REFUND_STATES, RefundState } from '../utils/refundStateMachine.js';

const REFUND_CHANNELS = Object.freeze(['razorpay', 'wallet', 'bank_transfer']);

const REFUND_REASONS = Object.freeze([
    'customer_request',
    'duplicate_payment',
    'fraud',
    'order_cancelled',
    'item_unavailable',
    'damaged_in_transit',
    'wrong_item',
    'quality_issue',
    'admin_adjustment',
    'other'
]);

const isInteger = (value) => Number.isInteger(value);

const refundSchema = new mongoose.Schema(
    {
        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'order',
            required: true,
            index: true
        },

        // Razorpay payment id (`pay_…`). Empty for COD/manual refunds.
        paymentId: {
            type: String,
            default: '',
            trim: true,
            maxlength: 80,
            index: true
        },

        // Set after the gateway accepts the refund. Unique when present.
        // For manual bank transfer we store `manual_<refundId>`.
        gatewayRefundId: {
            type: String,
            default: '',
            trim: true,
            maxlength: 120
        },

        amountInPaise: {
            type: Number,
            required: true,
            min: 1,
            validate: {
                validator: isInteger,
                message: 'amountInPaise must be an integer (paise)'
            }
        },

        currency: {
            type: String,
            default: 'INR',
            trim: true,
            uppercase: true,
            maxlength: 8
        },

        state: {
            type: String,
            enum: REFUND_STATES,
            default: RefundState.INITIATED,
            index: true
        },

        channel: {
            type: String,
            enum: REFUND_CHANNELS,
            required: true
        },

        reason: {
            type: String,
            enum: REFUND_REASONS,
            default: 'customer_request'
        },

        notes: { type: String, default: '', trim: true, maxlength: 1000 },

        // Admin actor identifiers. We store both id (when DB-backed) and
        // email so the audit trail remains useful even if the user record
        // is later deleted.
        initiatedByAdminId: { type: String, default: '', trim: true, maxlength: 64 },
        initiatedByAdminEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
        approvedByAdminId: { type: String, default: '', trim: true, maxlength: 64 },
        approvedByAdminEmail: { type: String, default: '', trim: true, lowercase: true, maxlength: 254 },

        // Manual bank transfer: UTR / reference recorded when an admin
        // marks the transfer settled.
        manualReference: { type: String, default: '', trim: true, maxlength: 120 },
        markedProcessedByAdminEmail: { type: String, default: '', trim: true, lowercase: true, maxlength: 254 },

        // Retry tracking. `nextRetryAt` is null when no retry is pending.
        retryCount: { type: Number, default: 0, min: 0 },
        maxRetries: { type: Number, default: 3, min: 0 },
        nextRetryAt: { type: Date, default: null, index: true },

        // Replay protection. Required for every refund — the controller
        // populates it from the `Idempotency-Key` request header.
        idempotencyKey: { type: String, required: true, trim: true, maxlength: 80 },

        refundInitiatedAt: { type: Date, default: () => new Date() },
        refundProcessedAt: { type: Date, default: null },
        permanentlyFailedAt: { type: Date, default: null },

        failureReason: { type: String, default: '', trim: true, maxlength: 500 },

        // Snapshot of the gateway response for forensic / accounting use.
        // Mixed because Razorpay may evolve the shape; treat as opaque.
        metadata: { type: mongoose.Schema.Types.Mixed, default: null }
    },
    { timestamps: true, strict: true, minimize: false }
);

refundSchema.index({ orderId: 1, state: 1 });
refundSchema.index({ state: 1, nextRetryAt: 1 });
refundSchema.index({ idempotencyKey: 1 }, { unique: true });
refundSchema.index({ gatewayRefundId: 1 }, { unique: true, sparse: true });
refundSchema.index({ createdAt: -1 });

refundSchema.virtual('amountInRupees').get(function getAmountInRupees() {
    return (this.amountInPaise || 0) / 100;
});

refundSchema.set('toJSON', { virtuals: true });
refundSchema.set('toObject', { virtuals: true });

const refundModel = mongoose.models.refund || mongoose.model('refund', refundSchema);

export { REFUND_CHANNELS, REFUND_REASONS };
export default refundModel;
