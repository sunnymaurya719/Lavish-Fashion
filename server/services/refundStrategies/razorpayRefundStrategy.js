/**
 * Razorpay refund strategy.
 *
 * Talks to the Razorpay SDK and translates the response shape into the
 * normalized `{ gatewayRefundId, channel, raw }` contract that the
 * orchestrator expects. Maps gateway errors to typed `GatewayError`s
 * with explicit retryability so the retry job knows what to do.
 */

import {
    createRefund as razorpayCreateRefund,
    isRazorpayConfigured
} from '../razorpayService.js';
import { paiseToRupees } from '../../utils/paise.util.js';
import { GatewayError, RefundError } from '../../utils/refundErrors.js';
import { refundLogger } from '../../utils/structuredLogger.js';

const CHANNEL = 'razorpay';

// HTTP status codes from Razorpay we should retry. Anything in 5xx
// territory plus 429 (rate limit). Everything else (400/401/404…) is a
// permanent client-side problem.
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

const isRetryableHttpStatus = (status) => {
    if (!Number.isFinite(status)) return false;
    if (RETRYABLE_STATUS_CODES.has(status)) return true;
    return status >= 500 && status < 600;
};

const isNetworkLikeError = (error) => {
    const code = error?.code;
    return (
        code === 'ECONNRESET' ||
        code === 'ETIMEDOUT' ||
        code === 'ENOTFOUND' ||
        code === 'EAI_AGAIN' ||
        code === 'ECONNABORTED'
    );
};

const translateError = (error) => {
    if (error instanceof GatewayError) return error;

    const status = error?.statusCode || error?.error?.statusCode;
    const description = error?.error?.description || error?.message || 'Razorpay refund failed';
    const retryable = isRetryableHttpStatus(status) || isNetworkLikeError(error);

    return new GatewayError(description, {
        retryable,
        statusCode: 502,
        cause: error,
        details: {
            gatewayStatusCode: status || null,
            gatewayCode: error?.error?.code || null,
            gatewayReason: error?.error?.reason || null
        }
    });
};

/**
 * @param {object} input
 * @param {object} input.refund        Persisted Refund document (mongoose)
 * @param {object} input.order         Persisted Order document
 * @param {string} input.idempotencyKey
 * @param {object} [input.log]         Bound child logger
 * @returns {Promise<{ gatewayRefundId: string, channel: 'razorpay', raw: object }>}
 */
const execute = async ({ refund, order, idempotencyKey, log = refundLogger }) => {
    if (!isRazorpayConfigured()) {
        throw new RefundError('Razorpay is not configured on server', {
            statusCode: 503,
            code: 'RAZORPAY_NOT_CONFIGURED'
        });
    }

    const paymentId = refund.paymentId || order.razorpayPaymentId;
    if (!paymentId) {
        throw new RefundError('Order has no captured Razorpay payment to refund', {
            statusCode: 400,
            code: 'REFUND_NO_PAYMENT_ID'
        });
    }

    log.info(
        {
            event: 'refund_strategy_razorpay_call_started',
            paymentId,
            amountInPaise: refund.amountInPaise,
            idempotencyKey
        },
        'Calling Razorpay createRefund'
    );

    let raw;
    try {
        raw = await razorpayCreateRefund({
            paymentId,
            amountInRupees: paiseToRupees(refund.amountInPaise),
            idempotencyKey,
            // The receipt has a 40-char cap. The idempotency key (a short
            // uuid in practice) fits comfortably; we slice defensively.
            receipt: String(idempotencyKey || refund._id).slice(0, 40),
            notes: {
                refund_id: String(refund._id),
                order_id: String(order._id),
                reason: refund.reason || 'customer_request'
            },
            speed: 'normal'
        });
    } catch (error) {
        const translated = translateError(error);
        log.warn(
            {
                event: 'refund_strategy_razorpay_call_failed',
                err: translated.message,
                retryable: translated.retryable,
                gatewayStatusCode: translated.details?.gatewayStatusCode
            },
            'Razorpay refund call failed'
        );
        throw translated;
    }

    if (!raw?.id) {
        throw new GatewayError('Razorpay refund response missing id', {
            retryable: false,
            cause: new Error('missing id in response'),
            details: { raw }
        });
    }

    log.info(
        {
            event: 'refund_strategy_razorpay_call_succeeded',
            gatewayRefundId: raw.id,
            gatewayStatus: raw.status
        },
        'Razorpay accepted refund'
    );

    return {
        gatewayRefundId: String(raw.id),
        channel: CHANNEL,
        raw
    };
};

export { CHANNEL, execute };
export default { CHANNEL, execute };
