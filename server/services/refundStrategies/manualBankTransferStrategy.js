/**
 * Manual bank-transfer refund strategy (used for COD orders).
 *
 * There is no gateway to call. The strategy simply records that the
 * refund was queued for manual processing — an admin will later call
 * `markRefundProcessed()` once the bank transfer settles, supplying the
 * UTR / NEFT reference.
 *
 * The synthetic gateway id is `manual_<refundId>` so the unique sparse
 * index on `gatewayRefundId` still applies (preventing double-acceptance
 * by mistake).
 */

import { refundLogger } from '../../utils/structuredLogger.js';

const CHANNEL = 'bank_transfer';

const execute = async ({ refund, order, log = refundLogger }) => {
    const gatewayRefundId = `manual_${String(refund._id)}`;

    log.info(
        {
            event: 'refund_strategy_manual_queued',
            orderId: String(order._id),
            refundId: String(refund._id),
            gatewayRefundId,
            amountInPaise: refund.amountInPaise
        },
        'Manual bank transfer queued — awaiting admin to mark processed'
    );

    return {
        gatewayRefundId,
        channel: CHANNEL,
        raw: {
            channel: CHANNEL,
            queuedAt: new Date().toISOString(),
            note: 'Awaiting admin to record bank transfer reference'
        },
        // Hint to the orchestrator: do NOT auto-transition to `pending`.
        // Manual refunds stay in `initiated` until an admin marks them
        // processed via `refundService.markManualRefundProcessed`.
        skipPendingTransition: true
    };
};

export { CHANNEL, execute };
export default { CHANNEL, execute };
