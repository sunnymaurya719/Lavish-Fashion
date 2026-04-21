import mongoose from 'mongoose';

import { LedgerImmutabilityError } from '../utils/refundErrors.js';

const LEDGER_TYPES = Object.freeze(['payment', 'refund', 'wallet_credit', 'adjustment']);

const LEDGER_SOURCES = Object.freeze(['razorpay', 'wallet', 'cod', 'manual', 'system']);

const ledgerEntrySchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: LEDGER_TYPES,
            required: true,
            index: true
        },

        // SIGNED amount — positive credits (money in / refund credit posted),
        // negative debits (refund payout / wallet debit). Always integer
        // paise. Sum across an order's entries equals the net cash position
        // of that order from our perspective.
        amountInPaise: {
            type: Number,
            required: true,
            validate: {
                validator: Number.isInteger,
                message: 'amountInPaise must be an integer (paise)'
            }
        },

        currency: {
            type: String,
            default: 'INR',
            uppercase: true,
            trim: true,
            maxlength: 8
        },

        // External reference — Razorpay payment id, refund id, manual UTR,
        // or our own idempotency key when no external id exists yet.
        referenceId: { type: String, default: '', trim: true, maxlength: 120, index: true },

        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'order',
            required: true,
            index: true
        },

        refundId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'refund',
            default: null,
            index: true
        },

        source: {
            type: String,
            enum: LEDGER_SOURCES,
            required: true
        },

        description: { type: String, default: '', trim: true, maxlength: 500 },

        // Append-only: timestamps.updatedAt is intentionally disabled.
        createdAt: { type: Date, default: () => new Date(), immutable: true }
    },
    { strict: true, minimize: false, timestamps: false }
);

ledgerEntrySchema.index({ orderId: 1, createdAt: -1 });
ledgerEntrySchema.index({ refundId: 1, createdAt: -1 });

// ── Append-only enforcement ────────────────────────────────────────────────
// A ledger that can be edited is no ledger. Any modify-after-insert
// operation throws synchronously so the caller cannot silently succeed.

const blockUpdate = function blockUpdate(next) {
    next(new LedgerImmutabilityError());
};

ledgerEntrySchema.pre('updateOne', blockUpdate);
ledgerEntrySchema.pre('updateMany', blockUpdate);
ledgerEntrySchema.pre('findOneAndUpdate', blockUpdate);
ledgerEntrySchema.pre('replaceOne', blockUpdate);

ledgerEntrySchema.pre('save', function preventResave(next) {
    if (!this.isNew) {
        return next(new LedgerImmutabilityError());
    }
    return next();
});

// Document.deleteOne / deleteMany are also disallowed — corrections must
// be expressed as compensating entries, never destructive deletes.
ledgerEntrySchema.pre('deleteOne', blockUpdate);
ledgerEntrySchema.pre('deleteMany', blockUpdate);
ledgerEntrySchema.pre('findOneAndDelete', blockUpdate);

const ledgerEntryModel =
    mongoose.models.ledger_entry || mongoose.model('ledger_entry', ledgerEntrySchema);

export { LEDGER_SOURCES, LEDGER_TYPES };
export default ledgerEntryModel;
