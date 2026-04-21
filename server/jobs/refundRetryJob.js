/**
 * Refund retry job. Runs every 10 minutes.
 *
 * Picks up refunds in `state: FAILED` whose `nextRetryAt` has elapsed
 * and whose `retryCount < maxRetries`, then calls `refundService.retry()`
 * for each. Manual bank-transfer refunds are NEVER picked up here —
 * they require explicit admin action via `mark-processed`.
 */

import refundModel from '../models/refundModel.js';
import { retry as retryRefund } from '../services/refundService.js';
import { RefundState } from '../utils/refundStateMachine.js';
import { refundLogger } from '../utils/structuredLogger.js';

import { runLockedJob } from './_runLockedJob.js';

const JOB_KEY = 'refund.retry';
const BATCH_SIZE = 50;

const findDueRefunds = () =>
    refundModel
        .find({
            state: RefundState.FAILED,
            channel: { $ne: 'bank_transfer' },
            $expr: { $lt: ['$retryCount', '$maxRetries'] },
            $or: [
                { nextRetryAt: { $lte: new Date() } },
                { nextRetryAt: null }
            ]
        })
        .sort({ nextRetryAt: 1 })
        .limit(BATCH_SIZE);

const runRefundRetryJobOnce = async ({ log = refundLogger } = {}) =>
    runLockedJob({
        jobKey: JOB_KEY,
        jobType: 'cron',
        trigger: 'cron-tick:10m',
        log,
        fn: async ({ log: jobLog }) => {
            const due = await findDueRefunds();
            jobLog.info({ event: 'refund_retry_batch_loaded', count: due.length });

            const results = { attempted: 0, succeeded: 0, failed: 0, exhausted: 0 };

            for (const refund of due) {
                results.attempted += 1;
                try {
                    const after = await retryRefund({ refundId: refund._id, log: jobLog });
                    if (after?.state === RefundState.PERMANENTLY_FAILED) {
                        results.exhausted += 1;
                    } else {
                        results.succeeded += 1;
                    }
                } catch (error) {
                    results.failed += 1;
                    jobLog.warn(
                        {
                            event: 'refund_retry_attempt_failed',
                            refundId: String(refund._id),
                            err: error.message
                        },
                        'Refund retry attempt failed'
                    );
                }
            }

            return results;
        }
    });

export { JOB_KEY, runRefundRetryJobOnce };
