/**
 * Daily refund reconciliation job. Runs at 02:00 IST.
 *
 * Picks up gateway-backed refunds (`channel: 'razorpay'`) that have been
 * stuck in INITIATED or PENDING for > 2 hours, queries Razorpay for the
 * authoritative status, and applies the result via the same code path
 * that handles webhooks. This protects us against missed/dropped
 * webhooks.
 *
 * Manual bank-transfer refunds are skipped — there is no gateway to
 * reconcile against.
 */

import refundModel from '../models/refundModel.js';
import { fetchRefund as razorpayFetchRefund } from '../services/razorpayService.js';
import { processWebhookUpdate } from '../services/refundService.js';
import { RefundState } from '../utils/refundStateMachine.js';
import { refundLogger } from '../utils/structuredLogger.js';

import { runLockedJob } from './_runLockedJob.js';

const JOB_KEY = 'refund.reconciliation';
const STUCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
const BATCH_SIZE = 100;

const findStuckRefunds = () =>
    refundModel
        .find({
            channel: 'razorpay',
            state: { $in: [RefundState.INITIATED, RefundState.PENDING] },
            gatewayRefundId: { $ne: null },
            refundInitiatedAt: { $lte: new Date(Date.now() - STUCK_THRESHOLD_MS) }
        })
        .sort({ refundInitiatedAt: 1 })
        .limit(BATCH_SIZE);

const runRefundReconciliationJobOnce = async ({ log = refundLogger } = {}) =>
    runLockedJob({
        jobKey: JOB_KEY,
        jobType: 'cron',
        trigger: 'cron-tick:daily',
        lockTtlMs: 30 * 60 * 1000,
        log,
        fn: async ({ log: jobLog }) => {
            const stuck = await findStuckRefunds();
            jobLog.info({ event: 'refund_reconcile_batch_loaded', count: stuck.length });

            const results = { scanned: 0, updated: 0, unchanged: 0, errors: 0 };

            for (const refund of stuck) {
                results.scanned += 1;
                try {
                    const refundEntity = await razorpayFetchRefund({
                        paymentId: refund.paymentId,
                        refundId: refund.gatewayRefundId
                    });

                    const before = refund.state;
                    await processWebhookUpdate({
                        event: 'reconciliation.fetch',
                        refundEntity,
                        log: jobLog
                    });

                    const after = await refundModel
                        .findById(refund._id)
                        .select('state')
                        .lean();
                    if (after?.state !== before) {
                        results.updated += 1;
                    } else {
                        results.unchanged += 1;
                    }
                } catch (error) {
                    results.errors += 1;
                    jobLog.warn(
                        {
                            event: 'refund_reconcile_fetch_failed',
                            refundId: String(refund._id),
                            err: error.message
                        },
                        'Reconcile fetch failed'
                    );
                }
            }

            return results;
        }
    });

export { JOB_KEY, runRefundReconciliationJobOnce };
