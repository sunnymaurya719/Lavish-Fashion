/**
 * Helper that wraps a job function with:
 *   - Distributed lock (skip if another instance holds it).
 *   - System job state tracking (started → completed | failed | skipped).
 *   - Structured logging with `event` field convention.
 *   - A short jitter so multiple replicas don't collide on the same tick.
 *
 * Usage:
 *   await runLockedJob({ jobKey, jobType, fn: async () => { … } });
 */

import crypto from 'crypto';

import {
    acquireDistributedLock,
    releaseDistributedLock
} from '../services/distributedLockService.js';
import {
    markSystemJobCompleted,
    markSystemJobFailed,
    markSystemJobSkipped,
    markSystemJobStarted
} from '../services/systemJobStateService.js';
import { refundLogger } from '../utils/structuredLogger.js';

const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} input
 * @param {string} input.jobKey         e.g. 'refund.retry'
 * @param {string} input.jobType        e.g. 'cron'
 * @param {string} [input.trigger]      e.g. 'cron-tick'
 * @param {number} [input.lockTtlMs]
 * @param {number} [input.jitterMs]
 * @param {(ctx: { log: object }) => Promise<object>} input.fn   Returns a result object that becomes the job's `result` payload.
 * @param {object} [input.log]
 */
const runLockedJob = async ({
    jobKey,
    jobType = 'cron',
    trigger = 'cron-tick',
    lockTtlMs = DEFAULT_LOCK_TTL_MS,
    jitterMs = 0,
    fn,
    log = refundLogger
}) => {
    if (!jobKey || typeof fn !== 'function') {
        throw new Error('runLockedJob requires jobKey and fn');
    }

    if (jitterMs > 0) {
        await sleep(Math.floor(Math.random() * jitterMs));
    }

    const ownerId = `${process.pid}:${crypto.randomBytes(4).toString('hex')}`;
    const startedAt = Date.now();
    const jobLog = log.child({ jobKey, jobType, ownerId });

    const lock = await acquireDistributedLock({
        key: jobKey,
        ownerId,
        ttlMs: lockTtlMs,
        metadata: { jobType, trigger }
    });

    if (!lock) {
        await markSystemJobSkipped({
            jobKey,
            provider: 'system',
            jobType,
            trigger,
            requestedBy: 'cron'
        }).catch(() => {});
        jobLog.info({ event: 'job_skipped_no_lock' }, 'Skipping job — another instance holds the lock');
        return { skipped: true };
    }

    try {
        await markSystemJobStarted({
            jobKey,
            provider: 'system',
            jobType,
            trigger,
            requestedBy: 'cron',
            ownerId,
            expiresAt: new Date(startedAt + lockTtlMs)
        });
    } catch (error) {
        jobLog.warn(
            { event: 'job_state_started_failed', err: error.message },
            'Failed to record job-start state (continuing anyway)'
        );
    }

    jobLog.info({ event: 'job_started' }, `Job ${jobKey} started`);

    try {
        const result = await fn({ log: jobLog });
        const durationMs = Date.now() - startedAt;
        await markSystemJobCompleted({
            jobKey,
            provider: 'system',
            jobType,
            durationMs,
            result: result && typeof result === 'object' ? result : { result }
        }).catch(() => {});
        jobLog.info(
            { event: 'job_completed', durationMs, result },
            `Job ${jobKey} completed`
        );
        return { ok: true, result };
    } catch (error) {
        const durationMs = Date.now() - startedAt;
        await markSystemJobFailed({
            jobKey,
            provider: 'system',
            jobType,
            durationMs,
            errorMessage: error?.message || 'unknown'
        }).catch(() => {});
        jobLog.error(
            { event: 'job_failed', err: error.message, durationMs },
            `Job ${jobKey} failed`
        );
        return { ok: false, error };
    } finally {
        await releaseDistributedLock({ key: jobKey, ownerId }).catch((err) =>
            jobLog.warn(
                { event: 'job_lock_release_failed', err: err.message },
                'Failed to release distributed lock'
            )
        );
    }
};

export { runLockedJob };
