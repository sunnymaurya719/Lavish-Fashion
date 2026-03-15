import crypto from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_whsec_test';
process.env.RAZORPAY_KEY_SECRET = 'rzp_key_secret_test';

const stripeRetrieveMock = vi.fn();
const stripeConstructEventMock = vi.fn();

vi.mock('stripe', () => ({
    default: class StripeMock {
        constructor() {
            this.checkout = {
                sessions: {
                    retrieve: stripeRetrieveMock,
                    create: vi.fn()
                }
            };
            this.webhooks = {
                constructEvent: stripeConstructEventMock
            };
        }
    }
}));

vi.mock('razorpay', () => ({
    default: class RazorpayMock {
        constructor() {
            this.orders = {
                create: vi.fn()
            };
        }
    }
}));

const orderModelMock = {
    findById: vi.fn(),
    findOne: vi.fn(),
    findByIdAndUpdate: vi.fn()
};

const userModelMock = {
    findByIdAndUpdate: vi.fn()
};

const productModelMock = {
    find: vi.fn()
};

const beginIdempotentRequestMock = vi.fn();
const completeIdempotentRequestMock = vi.fn();

vi.mock('../models/orderModel.js', () => ({
    default: orderModelMock
}));

vi.mock('../models/userModel.js', () => ({
    default: userModelMock
}));

vi.mock('../models/productModel.js', () => ({
    default: productModelMock
}));

vi.mock('../services/idempotencyService.js', () => ({
    beginIdempotentRequest: beginIdempotentRequestMock,
    completeIdempotentRequest: completeIdempotentRequestMock
}));

const {
    placeOrderStripe,
    placeOrderRazorpay,
    verifyStripe,
    verifyRazorpay,
    handleStripeWebhook,
    handleRazorpayWebhook
} = await import('../controllers/orderController.js');

const createRes = () => {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    res.send = vi.fn(() => res);
    return res;
};

describe('orderController unit tests', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('returns 400 when Stripe order creation misses idempotency key', async () => {
        const req = {
            headers: {},
            userId: 'user_1',
            body: { items: [], address: {} },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await placeOrderStripe(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(beginIdempotentRequestMock).not.toHaveBeenCalled();
    });

    it('returns replay payload from idempotency service for Stripe order creation', async () => {
        beginIdempotentRequestMock.mockResolvedValueOnce({
            action: 'replay',
            statusCode: 200,
            body: { success: true, session: { id: 'cs_replay' } }
        });

        const req = {
            headers: { 'idempotency-key': 'idem_1' },
            userId: 'user_1',
            body: { items: [{ _id: '507f1f77bcf86cd799439011', quantity: 1, size: 'M' }], address: {} },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await placeOrderStripe(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ success: true, session: { id: 'cs_replay' } });
    });

    it('returns conflict from idempotency service for Razorpay order creation', async () => {
        beginIdempotentRequestMock.mockResolvedValueOnce({
            action: 'conflict',
            statusCode: 409,
            body: { success: false, message: 'Idempotency key already used with different payload' }
        });

        const req = {
            headers: { 'idempotency-key': 'idem_2' },
            userId: 'user_1',
            body: { items: [{ _id: '507f1f77bcf86cd799439011', quantity: 1, size: 'L' }], address: {} },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await placeOrderRazorpay(req, res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ success: false, message: expect.stringContaining('Idempotency key already used') })
        );
    });

    it('returns 400 for invalid Stripe order id in verifyStripe', async () => {
        const req = {
            userId: 'user_1',
            body: { orderId: 'invalid_order_id', success: 'true', session_id: 'cs_1' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await verifyStripe(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when Stripe verify request misses session id', async () => {
        orderModelMock.findById.mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439011', userId: 'user_1', payment: false });

        const req = {
            userId: 'user_1',
            body: { orderId: '507f1f77bcf86cd799439011', success: 'true' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await verifyStripe(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('returns 400 when Stripe session does not belong to order/user', async () => {
        orderModelMock.findById.mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439011', userId: 'user_1', payment: false });
        stripeRetrieveMock.mockResolvedValueOnce({
            id: 'cs_test_1',
            client_reference_id: '507f1f77bcf86cd799439099',
            metadata: { orderId: '507f1f77bcf86cd799439099', userId: 'user_2' },
            payment_status: 'paid'
        });

        const req = {
            userId: 'user_1',
            body: { orderId: '507f1f77bcf86cd799439011', success: 'true', session_id: 'cs_test_1' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await verifyStripe(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(orderModelMock.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 402 when Stripe payment status is not paid', async () => {
        orderModelMock.findById.mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439011', userId: 'user_1', payment: false });
        stripeRetrieveMock.mockResolvedValueOnce({
            id: 'cs_test_1',
            client_reference_id: '507f1f77bcf86cd799439011',
            metadata: { orderId: '507f1f77bcf86cd799439011', userId: 'user_1' },
            payment_status: 'unpaid'
        });

        const req = {
            userId: 'user_1',
            body: { orderId: '507f1f77bcf86cd799439011', success: 'true', session_id: 'cs_test_1' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await verifyStripe(req, res);

        expect(res.status).toHaveBeenCalledWith(402);
    });

    it('returns 400 when Razorpay verify is missing required fields', async () => {
        const req = {
            userId: 'user_1',
            body: { razorpay_order_id: 'order_1' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await verifyRazorpay(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 for invalid Razorpay signature in verifyRazorpay', async () => {
        const req = {
            userId: 'user_1',
            body: {
                razorpay_order_id: 'order_1',
                razorpay_payment_id: 'pay_1',
                razorpay_signature: 'invalid_sig'
            },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await verifyRazorpay(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(orderModelMock.findOne).not.toHaveBeenCalled();
    });

    it('returns 404 when Razorpay order does not belong to user', async () => {
        const generatedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update('order_1|pay_1')
            .digest('hex');

        orderModelMock.findOne.mockResolvedValueOnce({ _id: 'order_local_1', userId: 'different_user', payment: false });

        const req = {
            userId: 'user_1',
            body: {
                razorpay_order_id: 'order_1',
                razorpay_payment_id: 'pay_1',
                razorpay_signature: generatedSignature
            },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await verifyRazorpay(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 when Stripe webhook signature is missing', async () => {
        const req = {
            headers: {},
            body: Buffer.from('{}'),
            log: { error: vi.fn() }
        };
        const res = createRes();

        await handleStripeWebhook(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.send).toHaveBeenCalledWith('Missing Stripe signature');
    });

    it('returns 400 when Stripe webhook payload fails schema validation', async () => {
        stripeConstructEventMock.mockReturnValueOnce({ id: 'evt_1', type: 'checkout.session.completed' });

        const req = {
            headers: { 'stripe-signature': 'sig_1' },
            body: Buffer.from('{}'),
            log: { error: vi.fn() }
        };
        const res = createRes();

        await handleStripeWebhook(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.send).toHaveBeenCalledWith('Invalid Stripe webhook payload');
    });

    it('marks order as paid for valid checkout.session.completed webhook', async () => {
        stripeConstructEventMock.mockReturnValueOnce({
            id: 'evt_paid_1',
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: 'cs_test_1',
                    client_reference_id: '507f1f77bcf86cd799439011',
                    payment_intent: 'pi_1',
                    metadata: {
                        orderId: '507f1f77bcf86cd799439011',
                        userId: 'user_1'
                    }
                }
            }
        });

        orderModelMock.findById.mockResolvedValueOnce({
            _id: '507f1f77bcf86cd799439011',
            userId: 'user_1',
            payment: false,
            gatewayEventId: null
        });
        orderModelMock.findByIdAndUpdate.mockResolvedValueOnce({
            _id: '507f1f77bcf86cd799439011',
            payment: true
        });

        const req = {
            headers: { 'stripe-signature': 'sig_1' },
            body: Buffer.from('{}'),
            log: { error: vi.fn() }
        };
        const res = createRes();

        await handleStripeWebhook(req, res);

        expect(orderModelMock.findByIdAndUpdate).toHaveBeenCalledWith(
            '507f1f77bcf86cd799439011',
            expect.objectContaining({
                payment: true,
                paymentStatus: 'paid',
                stripeSessionId: 'cs_test_1',
                stripePaymentIntentId: 'pi_1'
            }),
            { new: true }
        );
        expect(userModelMock.findByIdAndUpdate).toHaveBeenCalledWith('user_1', { cartData: {} });
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 400 for invalid Razorpay webhook signature', async () => {
        const req = {
            headers: { 'x-razorpay-signature': 'bad_signature' },
            body: Buffer.from(JSON.stringify({ event: 'payment.captured', payload: {} })),
            log: { error: vi.fn() }
        };
        const res = createRes();

        await handleRazorpayWebhook(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.send).toHaveBeenCalledWith('Invalid webhook signature');
    });

    it('returns 200 when Razorpay webhook has no order_id', async () => {
        const payload = {
            event: 'payment.captured',
            payload: {
                payment: {
                    entity: {
                        id: 'pay_1'
                    }
                }
            }
        };
        const body = Buffer.from(JSON.stringify(payload));
        const signature = crypto
            .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
            .update(body)
            .digest('hex');

        const req = {
            headers: { 'x-razorpay-signature': signature },
            body,
            log: { error: vi.fn() }
        };
        const res = createRes();

        await handleRazorpayWebhook(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ received: true });
    });

    it('marks Razorpay order as failed for payment.failed webhook', async () => {
        const payload = {
            event: 'payment.failed',
            payload: {
                payment: {
                    entity: {
                        id: 'pay_1',
                        order_id: 'order_1',
                        status: 'failed'
                    }
                }
            }
        };
        const body = Buffer.from(JSON.stringify(payload));
        const signature = crypto
            .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
            .update(body)
            .digest('hex');

        orderModelMock.findOne.mockResolvedValueOnce({
            _id: 'order_local_1',
            userId: 'user_1',
            payment: false,
            gatewayEventId: null
        });

        const req = {
            headers: { 'x-razorpay-signature': signature },
            body,
            log: { error: vi.fn() }
        };
        const res = createRes();

        await handleRazorpayWebhook(req, res);

        expect(orderModelMock.findByIdAndUpdate).toHaveBeenCalledWith(
            'order_local_1',
            expect.objectContaining({
                paymentStatus: 'failed',
                razorpayOrderId: 'order_1',
                razorpayPaymentId: 'pay_1'
            }),
            { new: true }
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ received: true });
    });
});
