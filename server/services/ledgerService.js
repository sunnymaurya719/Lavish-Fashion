/**
 * Append-only ledger service. Every call writes one immutable row.
 * Mistakes are corrected by writing a compensating row (same magnitude,
 * opposite sign) — never by editing or deleting the original.
 *
 * All amounts are SIGNED integer paise:
 *   payment        → positive  (money received)
 *   refund         → negative  (money paid back)
 *   wallet_credit  → positive  (credit issued to user wallet)
 *   adjustment     → either    (manual correction)
 */

import ledgerEntryModel from '../models/ledgerEntryModel.js';
import { assertPaise } from '../utils/paise.util.js';
import { RefundError } from '../utils/refundErrors.js';
import { refundLogger } from '../utils/structuredLogger.js';

const SOURCES = new Set(['razorpay', 'wallet', 'cod', 'manual', 'system']);
const TYPES = new Set(['payment', 'refund', 'wallet_credit', 'adjustment']);

const validateBaseEntry = ({ type, amountInPaise, source, orderId }) => {
    if (!TYPES.has(type)) {
        throw new RefundError(`Invalid ledger type: ${type}`, { code: 'LEDGER_INVALID_TYPE' });
    }
    if (!SOURCES.has(source)) {
        throw new RefundError(`Invalid ledger source: ${source}`, { code: 'LEDGER_INVALID_SOURCE' });
    }
    if (!Number.isInteger(amountInPaise) || amountInPaise === 0) {
        throw new RefundError(
            `Ledger amountInPaise must be a non-zero integer (got ${amountInPaise})`,
            { code: 'LEDGER_INVALID_AMOUNT' }
        );
    }
    if (!orderId) {
        throw new RefundError('Ledger entry requires orderId', { code: 'LEDGER_MISSING_ORDER' });
    }
};

const writeEntry = async (
    {
        type,
        amountInPaise,
        currency = 'INR',
        referenceId = '',
        orderId,
        refundId = null,
        source,
        description = ''
    },
    { session } = {}
) => {
    validateBaseEntry({ type, amountInPaise, source, orderId });

    const docs = await ledgerEntryModel.create(
        [
            {
                type,
                amountInPaise,
                currency,
                referenceId: String(referenceId || '').slice(0, 120),
                orderId,
                refundId,
                source,
                description: String(description || '').slice(0, 500)
            }
        ],
        session ? { session } : undefined
    );

    const entry = docs[0];
    refundLogger.info(
        {
            event: 'ledger_entry_written',
            type,
            amountInPaise,
            orderId: String(orderId),
            refundId: refundId ? String(refundId) : null,
            source,
            referenceId
        },
        'Ledger entry recorded'
    );
    return entry;
};

const recordPayment = (input, options) =>
    writeEntry({ ...input, type: 'payment' }, options);

const recordRefund = (input, options) =>
    writeEntry({ ...input, type: 'refund' }, options);

const recordWalletCredit = (input, options) =>
    writeEntry({ ...input, type: 'wallet_credit' }, options);

const recordAdjustment = (input, options) =>
    writeEntry({ ...input, type: 'adjustment' }, options);

const getOrderLedger = (orderId) => {
    if (!orderId) return Promise.resolve([]);
    return ledgerEntryModel
        .find({ orderId })
        .sort({ createdAt: 1 })
        .lean();
};

/**
 * Net balance for an order: positive = we owe nothing, negative = we still
 * owe a refund. Sums all signed entries.
 */
const getBalance = async (orderId) => {
    if (!orderId) return 0;
    const result = await ledgerEntryModel.aggregate([
        { $match: { orderId } },
        { $group: { _id: null, total: { $sum: '$amountInPaise' } } }
    ]);
    const total = result[0]?.total ?? 0;
    assertPaise(Math.abs(total), 'getBalance result');
    return total;
};

/**
 * Range export for the finance team. Returns an iterable cursor —
 * caller is responsible for streaming / closing.
 */
const exportForAccounting = async ({ from, to }) => {
    if (!(from instanceof Date) || !(to instanceof Date)) {
        throw new RefundError('exportForAccounting requires from/to Dates', {
            code: 'LEDGER_INVALID_RANGE'
        });
    }
    return ledgerEntryModel
        .find({ createdAt: { $gte: from, $lte: to } })
        .sort({ createdAt: 1 })
        .lean();
};

export {
    exportForAccounting,
    getBalance,
    getOrderLedger,
    recordAdjustment,
    recordPayment,
    recordRefund,
    recordWalletCredit
};
