/**
 * Routes a refund to the appropriate strategy based on the order's
 * payment method. Decoupled so we can add a wallet strategy later
 * without touching the orchestrator.
 */

import { RefundError } from '../utils/refundErrors.js';

import * as manualBankTransferStrategy from './refundStrategies/manualBankTransferStrategy.js';
import * as razorpayRefundStrategy from './refundStrategies/razorpayRefundStrategy.js';

const STRATEGIES = Object.freeze({
    razorpay: razorpayRefundStrategy,
    bank_transfer: manualBankTransferStrategy
});

const chooseChannel = (order) => {
    if (!order) {
        throw new RefundError('Cannot choose refund channel without an order', {
            code: 'REFUND_ROUTER_NO_ORDER'
        });
    }
    if (order.paymentMethod === 'Razorpay') return 'razorpay';
    if (order.paymentMethod === 'COD') return 'bank_transfer';
    throw new RefundError(
        `Unsupported payment method for refund: ${order.paymentMethod}`,
        { statusCode: 400, code: 'REFUND_UNSUPPORTED_PAYMENT_METHOD' }
    );
};

const chooseStrategy = (order) => {
    const channel = chooseChannel(order);
    const strategy = STRATEGIES[channel];
    if (!strategy) {
        throw new RefundError(`No strategy registered for channel ${channel}`, {
            code: 'REFUND_STRATEGY_NOT_FOUND'
        });
    }
    return { channel, strategy };
};

export { chooseChannel, chooseStrategy };
