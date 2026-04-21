/**
 * Integration test for the refund orchestrator. Uses an in-memory
 * Mongo so we can exercise the actual atomic `findOneAndUpdate`
 * concurrency primitive — which is the most important thing about
 * this whole subsystem.
 *
 * Strategies are mocked so we don't make real Razorpay calls.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Mock strategies BEFORE importing refundService so the dynamic
// imports inside the service pick up the mocked versions.
vi.mock('../services/refundStrategies/razorpayRefundStrategy.js', () => {
    const fn = vi.fn(async ({ refund }) => ({
        gatewayRefundId: `rzp_${refund._id}`,
        channel: 'razorpay',
        raw: { id: `rzp_${refund._id}`, status: 'pending' }
    }));
    return { execute: fn, CHANNEL: 'razorpay', default: { execute: fn, CHANNEL: 'razorpay' } };
});

vi.mock('../services/realtimeService.js', () => ({
    publishAdminOrderUpsert: vi.fn(async () => undefined)
}));

let mongoServer;
let orderModel;
let refundModel;
let ledgerEntryModel;
let refundService;
let razorpayStrategy;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri(), { dbName: 'refund-service-test' });

    ({ default: orderModel } = await import('../models/orderModel.js'));
    ({ default: refundModel } = await import('../models/refundModel.js'));
    ({ default: ledgerEntryModel } = await import('../models/ledgerEntryModel.js'));
    refundService = await import('../services/refundService.js');
    razorpayStrategy = await import('../services/refundStrategies/razorpayRefundStrategy.js');
}, 120000);

afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
    await orderModel.deleteMany({});
    await refundModel.deleteMany({});
    // ledgerEntryModel has an immutability guard on `deleteMany` for safety
    // in production; bypass it via the raw driver for test cleanup.
    await ledgerEntryModel.collection.deleteMany({});
    razorpayStrategy.execute.mockClear();
});

const makeOrder = async (overrides = {}) =>
    orderModel.create({
        userId: new mongoose.Types.ObjectId(),
        items: [
            {
                _id: new mongoose.Types.ObjectId(),
                name: 'Test',
                price: 1000,
                pricePaise: 100000,
                quantity: 1,
                size: 'M'
            }
        ],
        amount: 1000,
        amountInPaise: 100000,
        refundedAmount: 0,
        refundedAmountInPaise: 0,
        refundableAmountInPaise: 100000,
        address: {
            firstName: 'A',
            lastName: 'B',
            street: 's',
            city: 'c',
            state: 's',
            country: 'in',
            zipcode: '123456',
            pincode: '123456',
            phone: '9999999999'
        },
        paymentMethod: 'Razorpay',
        payment: true,
        razorpayPaymentId: 'pay_test_123',
        date: Date.now(),
        ...overrides
    });

const ADMIN = { id: new mongoose.Types.ObjectId().toString(), email: 'a@x.com', role: 'admin' };

describe('refundService.initiateRefund', () => {
    it('happy path: persists refund, transitions to PENDING, posts ledger, decrements refundable', async () => {
        const order = await makeOrder();

        const { refund } = await refundService.initiateRefund({
            orderId: order._id,
            amountInPaise: 30000,
            reason: 'customer_request',
            idempotencyKey: 'idem-1',
            admin: ADMIN
        });

        expect(refund.state).toBe('pending');
        expect(refund.amountInPaise).toBe(30000);
        expect(refund.gatewayRefundId).toBe(`rzp_${refund._id}`);

        const after = await orderModel.findById(order._id).lean();
        expect(after.refundableAmountInPaise).toBe(70000);

        const entries = await ledgerEntryModel.find({ orderId: order._id }).lean();
        expect(entries).toHaveLength(1);
        expect(entries[0].amountInPaise).toBe(-30000);
        expect(entries[0].type).toBe('refund');
    });

    it('rejects refund exceeding refundable amount with InsufficientRefundableAmountError', async () => {
        const order = await makeOrder();
        await expect(
            refundService.initiateRefund({
                orderId: order._id,
                amountInPaise: 200000,
                idempotencyKey: 'idem-too-big',
                admin: ADMIN
            })
        ).rejects.toMatchObject({ code: 'INSUFFICIENT_REFUNDABLE_AMOUNT' });

        const after = await orderModel.findById(order._id).lean();
        expect(after.refundableAmountInPaise).toBe(100000);
    });

    it('replays existing refund when idempotency key collides', async () => {
        const order = await makeOrder();
        const { refund } = await refundService.initiateRefund({
            orderId: order._id,
            amountInPaise: 10000,
            idempotencyKey: 'idem-replay',
            admin: ADMIN
        });
        const result = await refundService.initiateRefund({
            orderId: order._id,
            amountInPaise: 10000,
            idempotencyKey: 'idem-replay',
            admin: ADMIN
        });
        expect(result.replayed).toBe(true);
        expect(String(result.refund._id)).toBe(String(refund._id));

        const refundCount = await refundModel.countDocuments();
        expect(refundCount).toBe(1);
    });

    it('compensates (releases refundable + marks FAILED) when strategy throws', async () => {
        razorpayStrategy.execute.mockImplementationOnce(async () => {
            const err = new Error('gateway boom');
            err.code = 'GATEWAY_ERROR';
            err.statusCode = 502;
            err.retryable = true;
            throw err;
        });

        const order = await makeOrder();

        await expect(
            refundService.initiateRefund({
                orderId: order._id,
                amountInPaise: 40000,
                idempotencyKey: 'idem-fail',
                admin: ADMIN
            })
        ).rejects.toThrow();

        const after = await orderModel.findById(order._id).lean();
        // Compensating release puts the 40000 back.
        expect(after.refundableAmountInPaise).toBe(100000);

        const refunds = await refundModel.find({}).lean();
        expect(refunds).toHaveLength(1);
        expect(refunds[0].state).toBe('failed');
        expect(refunds[0].failureReason).toBe('gateway boom');
    });

    it('RACE TEST: two parallel refunds of 60k on a 100k order — exactly one succeeds', async () => {
        const order = await makeOrder();

        const results = await Promise.allSettled([
            refundService.initiateRefund({
                orderId: order._id,
                amountInPaise: 60000,
                idempotencyKey: 'race-A',
                admin: ADMIN
            }),
            refundService.initiateRefund({
                orderId: order._id,
                amountInPaise: 60000,
                idempotencyKey: 'race-B',
                admin: ADMIN
            })
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason.code).toBe('INSUFFICIENT_REFUNDABLE_AMOUNT');

        const after = await orderModel.findById(order._id).lean();
        expect(after.refundableAmountInPaise).toBe(40000);
    });
});

describe('refundService.markManualRefundProcessed', () => {
    it('transitions a manual bank-transfer refund to PROCESSED and posts ledger', async () => {
        const order = await makeOrder({ paymentMethod: 'COD' });

        const { refund } = await refundService.initiateRefund({
            orderId: order._id,
            amountInPaise: 50000,
            idempotencyKey: 'cod-1',
            admin: ADMIN
        });
        expect(refund.state).toBe('initiated');
        expect(refund.channel).toBe('bank_transfer');

        // Ledger should NOT have an entry yet.
        const ledgerBefore = await ledgerEntryModel.find({ refundId: refund._id }).lean();
        expect(ledgerBefore).toHaveLength(0);

        const updated = await refundService.markManualRefundProcessed({
            refundId: refund._id,
            utrReference: 'NEFT-REF-999',
            admin: ADMIN
        });
        expect(updated.state).toBe('processed');
        expect(updated.manualReference).toBe('NEFT-REF-999');

        const ledgerAfter = await ledgerEntryModel.find({ refundId: refund._id }).lean();
        expect(ledgerAfter).toHaveLength(1);
        expect(ledgerAfter[0].amountInPaise).toBe(-50000);
        expect(ledgerAfter[0].source).toBe('manual');
    });

    it('rejects markManualRefundProcessed for a Razorpay refund', async () => {
        const order = await makeOrder();
        const { refund } = await refundService.initiateRefund({
            orderId: order._id,
            amountInPaise: 1000,
            idempotencyKey: 'rzp-1',
            admin: ADMIN
        });
        await expect(
            refundService.markManualRefundProcessed({
                refundId: refund._id,
                utrReference: 'X',
                admin: ADMIN
            })
        ).rejects.toMatchObject({ code: 'REFUND_NOT_MANUAL' });
    });
});

describe('refundService.processWebhookUpdate', () => {
    it('transitions PENDING → PROCESSED on processed webhook', async () => {
        const order = await makeOrder();
        const { refund } = await refundService.initiateRefund({
            orderId: order._id,
            amountInPaise: 25000,
            idempotencyKey: 'wh-1',
            admin: ADMIN
        });

        const result = await refundService.processWebhookUpdate({
            event: 'refund.processed',
            refundEntity: { id: refund.gatewayRefundId, status: 'processed' }
        });
        expect(result.state).toBe('processed');
    });

    it('ignores out-of-order webhook attempting to regress PROCESSED → PENDING', async () => {
        const order = await makeOrder();
        const { refund } = await refundService.initiateRefund({
            orderId: order._id,
            amountInPaise: 25000,
            idempotencyKey: 'wh-2',
            admin: ADMIN
        });
        await refundService.processWebhookUpdate({
            event: 'refund.processed',
            refundEntity: { id: refund.gatewayRefundId, status: 'processed' }
        });
        const result = await refundService.processWebhookUpdate({
            event: 'refund.created',
            refundEntity: { id: refund.gatewayRefundId, status: 'pending' }
        });
        expect(result.state).toBe('processed');
    });

    it('failed webhook from PENDING releases reservation and posts compensating ledger', async () => {
        const order = await makeOrder();
        const { refund } = await refundService.initiateRefund({
            orderId: order._id,
            amountInPaise: 30000,
            idempotencyKey: 'wh-fail',
            admin: ADMIN
        });

        const beforeOrder = await orderModel.findById(order._id).lean();
        expect(beforeOrder.refundableAmountInPaise).toBe(70000);

        await refundService.processWebhookUpdate({
            event: 'refund.failed',
            refundEntity: { id: refund.gatewayRefundId, status: 'failed', error_description: 'denied' }
        });

        const afterOrder = await orderModel.findById(order._id).lean();
        expect(afterOrder.refundableAmountInPaise).toBe(100000);

        const entries = await ledgerEntryModel.find({ refundId: refund._id }).lean();
        // One refund entry (-30000) at initiate + one compensating adjustment (+30000)
        expect(entries.map((e) => e.amountInPaise).sort((a, b) => a - b)).toEqual([-30000, 30000]);
    });
});
