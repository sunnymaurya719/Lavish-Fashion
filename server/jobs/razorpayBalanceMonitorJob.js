/**
 * Razorpay balance monitor. Runs daily at 09:00 IST.
 *
 * Fetches the merchant's current Razorpay balance and compares it to:
 *   1. A configurable low-balance threshold (`LOW_BALANCE_THRESHOLD_PAISE`,
 *      default ₹10,000 = 1,000,000 paise).
 *   2. The total amount of in-flight refunds we still owe out
 *      (refunds in INITIATED or PENDING).
 *
 * If either check fails, the job logs at `error` level with a critical
 * `event` so existing log alerting can fire. We deliberately do NOT
 * throw — the result is delivered through the `result` field of the
 * job state record and the structured log.
 */

import refundModel from '../models/refundModel.js';
import {
    fetchBalance as razorpayFetchBalance,
    isRazorpayConfigured
} from '../services/razorpayService.js';
import { paiseToRupees } from '../utils/paise.util.js';
import { RefundState } from '../utils/refundStateMachine.js';
import { refundLogger } from '../utils/structuredLogger.js';

import { runLockedJob } from './_runLockedJob.js';

const JOB_KEY = 'refund.balance_monitor';

const parseThreshold = () => {
    const raw = Number(process.env.RAZORPAY_LOW_BALANCE_THRESHOLD_PAISE);
    if (Number.isInteger(raw) && raw > 0) return raw;
    return 1_000_000; // ₹10,000 default
};

const getInFlightRefundTotalPaise = async () => {
    const result = await refundModel.aggregate([
        {
            $match: {
                state: { $in: [RefundState.INITIATED, RefundState.PENDING] }
            }
        },
        { $group: { _id: null, total: { $sum: '$amountInPaise' } } }
    ]);
    return result[0]?.total ?? 0;
};

const runBalanceMonitorJobOnce = async ({ log = refundLogger } = {}) =>
    runLockedJob({
        jobKey: JOB_KEY,
        jobType: 'cron',
        trigger: 'cron-tick:daily',
        log,
        fn: async ({ log: jobLog }) => {
            if (!isRazorpayConfigured()) {
                jobLog.info(
                    { event: 'razorpay_balance_skipped_not_configured' },
                    'Skipping balance monitor — Razorpay not configured'
                );
                return { skipped: true };
            }

            const threshold = parseThreshold();
            const balance = await razorpayFetchBalance();
            if (!balance) {
                jobLog.warn(
                    { event: 'razorpay_balance_unavailable' },
                    'Razorpay balance API returned no data'
                );
                return { skipped: true };
            }

            const inFlightPaise = await getInFlightRefundTotalPaise();

            const lowBalance = balance.balanceInPaise < threshold;
            const insufficientForRefunds = balance.balanceInPaise < inFlightPaise;
            const critical = lowBalance || insufficientForRefunds;

            const summary = {
                balanceInPaise: balance.balanceInPaise,
                balanceInRupees: paiseToRupees(balance.balanceInPaise),
                thresholdInPaise: threshold,
                inFlightRefundPaise: inFlightPaise,
                lowBalance,
                insufficientForRefunds
            };

            if (critical) {
                jobLog.error(
                    {
                        event: 'razorpay_balance_critical',
                        ...summary
                    },
                    'CRITICAL: Razorpay balance below threshold or insufficient for in-flight refunds'
                );
            } else {
                jobLog.info(
                    { event: 'razorpay_balance_ok', ...summary },
                    'Razorpay balance check OK'
                );
            }

            return summary;
        }
    });

export { JOB_KEY, runBalanceMonitorJobOnce };
