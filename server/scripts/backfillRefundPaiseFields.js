/**
 * Idempotent backfill: populate paise-denominated fields on every order
 * from the legacy rupee fields (`order.amount`, `order.refundedAmount`,
 * per-item `price`).
 *
 * Run with:
 *   npm --prefix server run backfill:refund-paise
 *
 * Re-running is safe: orders that already have `amountInPaise > 0` are
 * skipped unless `--force` is passed.
 *
 * Reports a summary to stdout. Exits non-zero on any unexpected error
 * so CI / deploy pipelines can detect failure.
 */

import 'dotenv/config';

import mongoose from 'mongoose';

import connectDB from '../config/mongodb.js';
import logger from '../config/logger.js';
import orderModel from '../models/orderModel.js';
import { paiseFromOrderRupees } from '../utils/paise.util.js';

const PAGE_SIZE = 200;

const log = logger.child({ subsystem: 'refund', script: 'backfillRefundPaiseFields' });

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');

const safeRupeeToPaise = (value, label) => {
    try {
        return paiseFromOrderRupees(value || 0);
    } catch (error) {
        log.warn({ event: 'backfill_paise_skip_bad_value', label, value, err: error.message });
        return null;
    }
};

const buildItemUpdate = (items = []) => {
    let touched = false;
    const next = items.map((item) => {
        const plain = item.toObject ? item.toObject() : { ...item };
        const pricePaise = safeRupeeToPaise(plain.price, 'item.price');
        const refundedPaise = Number.isInteger(plain.refundedAmountPaise)
            ? plain.refundedAmountPaise
            : 0;
        const status = plain.refundStatus && ['none', 'partial', 'full'].includes(plain.refundStatus)
            ? plain.refundStatus
            : 'none';

        const needsWrite =
            (pricePaise !== null && plain.pricePaise !== pricePaise) ||
            plain.refundedAmountPaise !== refundedPaise ||
            plain.refundStatus !== status;

        if (needsWrite) touched = true;

        return {
            ...plain,
            pricePaise: pricePaise !== null ? pricePaise : (plain.pricePaise || 0),
            refundedAmountPaise: refundedPaise,
            refundStatus: status
        };
    });

    return { items: next, touched };
};

const processOrder = async (order) => {
    const orderTotalPaise = safeRupeeToPaise(order.amount, 'order.amount');
    if (orderTotalPaise === null) {
        return { skipped: true, reason: 'unparseable_amount' };
    }

    const refundedPaise = safeRupeeToPaise(order.refundedAmount || 0, 'order.refundedAmount');
    if (refundedPaise === null) {
        return { skipped: true, reason: 'unparseable_refundedAmount' };
    }

    const refundablePaise = Math.max(0, orderTotalPaise - refundedPaise);

    const { items: nextItems, touched: itemsTouched } = buildItemUpdate(order.items || []);

    const needsOrderWrite =
        FORCE ||
        order.amountInPaise !== orderTotalPaise ||
        order.refundedAmountInPaise !== refundedPaise ||
        order.refundableAmountInPaise !== refundablePaise ||
        itemsTouched;

    if (!needsOrderWrite) {
        return { skipped: true, reason: 'already_migrated' };
    }

    if (DRY_RUN) {
        return {
            updated: true,
            preview: {
                amountInPaise: orderTotalPaise,
                refundedAmountInPaise: refundedPaise,
                refundableAmountInPaise: refundablePaise,
                itemsTouched
            }
        };
    }

    order.amountInPaise = orderTotalPaise;
    order.refundedAmountInPaise = refundedPaise;
    order.refundableAmountInPaise = refundablePaise;
    if (itemsTouched) {
        order.items = nextItems;
    }
    await order.save();

    return { updated: true };
};

const run = async () => {
    log.info({ event: 'backfill_paise_start', force: FORCE, dryRun: DRY_RUN });

    await connectDB();

    const filter = FORCE ? {} : { amountInPaise: { $in: [0, null] } };

    const totals = { scanned: 0, updated: 0, skipped: 0, failed: 0 };

    // Cursor with batch — avoid loading every order into memory.
    const cursor = orderModel.find(filter).cursor({ batchSize: PAGE_SIZE });

    for await (const order of cursor) {
        totals.scanned += 1;
        try {
            const result = await processOrder(order);
            if (result.updated) totals.updated += 1;
            if (result.skipped) totals.skipped += 1;
        } catch (error) {
            totals.failed += 1;
            log.error(
                {
                    event: 'backfill_paise_order_failed',
                    orderId: String(order._id),
                    err: error.message
                },
                'Order backfill failed'
            );
        }

        if (totals.scanned % 500 === 0) {
            log.info({ event: 'backfill_paise_progress', ...totals });
        }
    }

    log.info({ event: 'backfill_paise_complete', ...totals });

    await mongoose.disconnect();
    return totals;
};

run()
    .then((totals) => {
        process.stdout.write(`${JSON.stringify({ ok: totals.failed === 0, totals }, null, 2)}\n`);
        process.exit(totals.failed === 0 ? 0 : 1);
    })
    .catch((error) => {
        log.error({ event: 'backfill_paise_fatal', err: error.message }, 'Backfill failed');
        process.stderr.write(`${error?.stack || error?.message || error}\n`);
        process.exit(1);
    });
