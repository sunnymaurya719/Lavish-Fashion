/**
 * Thin wrapper around the existing pino logger that enforces an `event`
 * field on every log line so refund logs are searchable in production.
 *
 * Usage:
 *   import { refundLogger, withRefundContext } from '../utils/structuredLogger.js';
 *
 *   refundLogger.info({ event: 'refund_initiate_started', orderId, amountInPaise });
 *   const log = withRefundContext(refundLogger, { refundId });
 *   log.warn({ event: 'refund_state_downgrade_blocked' });
 */

import logger from '../config/logger.js';

const refundLogger = logger.child({ subsystem: 'refund' });

/**
 * Returns a child logger pre-bound with refund context (refundId,
 * orderId, etc.) so call sites do not have to repeat them.
 */
const withRefundContext = (log, context = {}) => {
    const base = log || refundLogger;
    if (!context || typeof context !== 'object') return base;
    return base.child(context);
};

export { refundLogger, withRefundContext };
