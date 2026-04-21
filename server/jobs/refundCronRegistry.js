/**
 * Cron registry for refund-subsystem jobs.
 *
 *   - refund.retry              every 10 minutes
 *   - refund.reconciliation     daily at 02:00 IST
 *   - refund.balance_monitor    daily at 09:00 IST
 *
 * All schedules use the `Asia/Kolkata` timezone. Disabled in tests.
 *
 * Each cron tick is fire-and-forget; the job itself is wrapped in a
 * distributed lock and tracked via the system job state service.
 *
 * Set `REFUND_CRON_DISABLED=true` to fully disable cron registration
 * (useful for one-off worker processes that should not run jobs).
 */

import cron from 'node-cron';

import { runBalanceMonitorJobOnce } from './razorpayBalanceMonitorJob.js';
import { runRefundReconciliationJobOnce } from './refundReconciliationJob.js';
import { runRefundRetryJobOnce } from './refundRetryJob.js';
import { refundLogger } from '../utils/structuredLogger.js';

const TIMEZONE = 'Asia/Kolkata';

const isDisabled = () =>
    process.env.NODE_ENV === 'test' ||
    String(process.env.REFUND_CRON_DISABLED || '').toLowerCase() === 'true';

const SCHEDULES = Object.freeze([
    {
        cron: '*/10 * * * *',
        name: 'refund.retry',
        run: runRefundRetryJobOnce
    },
    {
        cron: '0 2 * * *',
        name: 'refund.reconciliation',
        run: runRefundReconciliationJobOnce
    },
    {
        cron: '0 9 * * *',
        name: 'refund.balance_monitor',
        run: runBalanceMonitorJobOnce
    }
]);

const wrapTick = (name, fn) => () => {
    fn({ log: refundLogger.child({ jobKey: name }) }).catch((error) => {
        refundLogger.error(
            { event: 'refund_cron_tick_failed', jobKey: name, err: error.message },
            `Cron tick for ${name} threw`
        );
    });
};

let registered = false;

const registerRefundCronJobs = () => {
    if (registered) {
        refundLogger.warn(
            { event: 'refund_cron_already_registered' },
            'registerRefundCronJobs called more than once — ignoring'
        );
        return [];
    }
    if (isDisabled()) {
        refundLogger.info(
            { event: 'refund_cron_disabled' },
            'Refund cron jobs disabled by environment'
        );
        return [];
    }

    const tasks = SCHEDULES.map(({ cron: schedule, name, run }) => {
        if (!cron.validate(schedule)) {
            refundLogger.error(
                { event: 'refund_cron_invalid_schedule', name, schedule },
                'Invalid cron schedule — skipping'
            );
            return null;
        }
        const task = cron.schedule(schedule, wrapTick(name, run), {
            scheduled: true,
            timezone: TIMEZONE
        });
        refundLogger.info(
            { event: 'refund_cron_registered', name, schedule, timezone: TIMEZONE },
            `Cron registered: ${name} @ ${schedule}`
        );
        return { name, task };
    }).filter(Boolean);

    registered = true;
    return tasks;
};

export { registerRefundCronJobs, SCHEDULES };
