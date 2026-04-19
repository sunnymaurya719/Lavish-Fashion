import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
    fetchShiprocketWebhookStatus,
    insertShiprocketWebhookPayload,
    triggerShiprocketWebhookDrain
} from './helpers/shiprocketWebhookTestHelper.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'StrongAdminPass123';
process.env.CLIENT_URL = 'http://localhost:5173';
process.env.ADMIN_URL = 'http://localhost:5174';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.CORS_ORIGINS = 'http://localhost:5173,http://localhost:5174';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'rzp_secret_mock';
process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_whsec_mock';
process.env.SHIPROCKET_WEBHOOK_API_KEY = 'shiprocket_test_api_key';
process.env.CRON_SECRET = 'cron_secret_test_value';

vi.mock('../services/whatsappService.js', () => ({
    captureRawRequestBody: (req, _res, buffer) => {
        req.rawBody = Buffer.isBuffer(buffer)
            ? Buffer.from(buffer)
            : Buffer.from(String(buffer || ''), 'utf8');
    },
    handleWhatsAppWebhookEvent: async (_req, res) => res.status(200).json({ received: true }),
    handleWhatsAppWebhookVerification: async (_req, res) => res.status(200).send('ok'),
    sendDeliveredMessage: vi.fn(async () => ({ success: true })),
    sendOrderPlacedMessage: vi.fn(async () => ({ success: true })),
    sendOutForDeliveryMessage: vi.fn(async () => ({ success: true })),
    sendTemplateMessage: vi.fn(async () => ({ success: true, messageId: 'wa_mock_1' }))
}));

vi.mock('razorpay', () => {
    return {
        default: class RazorpayMock {
            constructor() {
                this.orders = {
                    create: vi.fn(async (options) => ({
                        id: 'order_mock_1',
                        amount: options.amount,
                        currency: options.currency,
                        receipt: options.receipt,
                        status: 'created'
                    }))
                };
            }
        }
    };
});

describe('payment webhooks integration', () => {
    let mongoServer;
    let app;
    let userModel;
    let orderModel;
    let shiprocketWebhookEventModel;
    let distributedLockModel;
    let systemJobStateModel;

    const waitFor = async (assertion, { timeoutMs = 2000, intervalMs = 25 } = {}) => {
        const deadline = Date.now() + timeoutMs;
        let lastError;

        while (Date.now() < deadline) {
            try {
                return await assertion();
            } catch (error) {
                lastError = error;
                await new Promise((resolve) => setTimeout(resolve, intervalMs));
            }
        }

        throw lastError || new Error('Timed out waiting for async assertion');
    };

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        await mongoose.connect(mongoServer.getUri(), { dbName: 'lavish-fashion-webhooks' });

        const appModule = await import('../app.js');
        const userModule = await import('../models/userModel.js');
        const orderModule = await import('../models/orderModel.js');
        const shiprocketWebhookEventModule = await import('../models/shiprocketWebhookEventModel.js');
        const distributedLockModule = await import('../models/distributedLockModel.js');
        const systemJobStateModule = await import('../models/systemJobStateModel.js');

        app = appModule.default();
        userModel = userModule.default;
        orderModel = orderModule.default;
        shiprocketWebhookEventModel = shiprocketWebhookEventModule.default;
        distributedLockModel = distributedLockModule.default;
        systemJobStateModel = systemJobStateModule.default;
    }, 1200000);

    afterAll(async () => {
        await mongoose.disconnect();
        if (mongoServer) {
            await mongoServer.stop();
        }
    });

    afterEach(async () => {
        await orderModel.deleteMany({});
        await userModel.deleteMany({});
        await shiprocketWebhookEventModel.deleteMany({});
        await distributedLockModel.deleteMany({});
        await systemJobStateModel.deleteMany({});
    });

    it('verifies Razorpay webhook signature and marks payment as paid', async () => {
        const user = await userModel.create({
            name: 'Razor User',
            email: 'razor@example.com',
            password: 'hashed-password',
            cartData: { '507f1f77bcf86cd799439011': { M: 1 } }
        });

        const order = await orderModel.create({
            userId: String(user._id),
            items: [{ _id: '507f1f77bcf86cd799439011', name: 'Tee', price: 199, quantity: 1, size: 'M' }],
            amount: 209,
            address: {
                firstName: 'A',
                lastName: 'B',
                street: 'S',
                city: 'C',
                state: 'ST',
                pincode: '123456',
                country: 'IN',
                phone: '9999999999'
            },
            paymentMethod: 'Razorpay',
            payment: false,
            paymentStatus: 'pending',
            razorpayOrderId: 'order_test_razorpay_1',
            date: Date.now()
        });

        const webhookPayload = {
            event: 'payment.captured',
            payload: {
                payment: {
                    entity: {
                        id: 'pay_test_1',
                        order_id: 'order_test_razorpay_1',
                        status: 'captured'
                    }
                }
            }
        };

        const body = JSON.stringify(webhookPayload);
        const signature = crypto
            .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
            .update(body)
            .digest('hex');

        const response = await request(app)
            .post('/api/webhooks/razorpay')
            .set('x-razorpay-signature', signature)
            .set('Content-Type', 'application/json')
            .send(body);

        expect(response.status).toBe(200);

        const updatedOrder = await orderModel.findById(order._id).lean();
        const updatedUser = await userModel.findById(user._id).lean();

        expect(updatedOrder.payment).toBe(true);
        expect(updatedOrder.paymentStatus).toBe('paid');
        expect(updatedOrder.razorpayPaymentId).toBe('pay_test_1');
        expect(updatedUser.cartData).toEqual({});
    });

    it('rejects Shiprocket webhooks with an invalid x-api-key header', async () => {
        const response = await request(app)
            .post('/api/webhooks/shiprocket')
            .set('Content-Type', 'application/json')
            .set('x-api-key', 'wrong_key')
            .send({
                event_id: 'ship_evt_invalid_auth',
                shipment_id: 101,
                current_status: 'Shipped'
            });

        expect(response.status).toBe(403);
        expect(await shiprocketWebhookEventModel.countDocuments()).toBe(0);
    });

    it('acknowledges Shiprocket quickly, processes asynchronously, and deduplicates retries', async () => {
        const order = await orderModel.create({
            userId: '507f1f77bcf86cd799439012',
            items: [{ _id: '507f1f77bcf86cd799439011', name: 'Tee', price: 199, quantity: 1, size: 'M' }],
            amount: 209,
            address: {
                firstName: 'A',
                lastName: 'B',
                street: 'S',
                city: 'C',
                state: 'ST',
                pincode: '123456',
                country: 'IN',
                phone: '9999999999'
            },
            paymentMethod: 'COD',
            payment: false,
            paymentStatus: 'pending',
            status: 'Order Placed',
            shiprocket: {
                syncStatus: 'synced',
                referenceOrderId: 'SR-REF-1001',
                orderId: 9001,
                shipmentId: 3001,
                awbCode: 'AWB1001'
            },
            date: Date.now()
        });

        const webhookPayload = {
            event_id: 'ship_evt_async_1',
            event: 'shipment_update',
            shipment_id: 3001,
            order_id: 9001,
            awb_code: 'AWB1001',
            current_status: 'Shipped',
            current_status_id: 17,
            updated_at: '2026-04-18T10:00:00.000Z'
        };

        const startedAt = Date.now();
        const firstResponse = await request(app)
            .post('/api/webhooks/shiprocket')
            .set('Content-Type', 'application/json')
            .set('x-api-key', process.env.SHIPROCKET_WEBHOOK_API_KEY)
            .send(webhookPayload);
        const responseDurationMs = Date.now() - startedAt;

        expect(firstResponse.status).toBe(200);
        expect(firstResponse.body).toEqual({ received: true, duplicate: false });
        expect(responseDurationMs).toBeLessThan(1000);

        await waitFor(async () => {
            const updatedOrder = await orderModel.findById(order._id).lean();
            expect(updatedOrder.status).toBe('Shipped');
            expect(updatedOrder.shiprocket.currentStatus).toBe('Shipped');
            expect(updatedOrder.shiprocket.currentStatusCode).toBe(17);
        });

        await waitFor(async () => {
            const storedEvent = await shiprocketWebhookEventModel.findOne({ eventKey: 'shiprocket:ship_evt_async_1' }).lean();
            expect(storedEvent.processingStatus).toBe('processed');
            expect(storedEvent.matchedOrderId).toBe(String(order._id));
            expect(storedEvent.requestHeaders['x-api-key']).toBe('[REDACTED]');
        });

        const duplicateResponse = await request(app)
            .post('/api/webhooks/shiprocket')
            .set('Content-Type', 'application/json')
            .set('x-api-key', process.env.SHIPROCKET_WEBHOOK_API_KEY)
            .send(webhookPayload);

        expect(duplicateResponse.status).toBe(200);
        expect(duplicateResponse.body).toEqual({ received: true, duplicate: true });
        expect(await shiprocketWebhookEventModel.countDocuments()).toBe(1);
    });

    it('rejects Shiprocket drain cron requests with an invalid CRON_SECRET bearer token', async () => {
        const response = await request(app)
            .get('/api/system/shiprocket/webhook-drain')
            .set('Authorization', 'Bearer wrong_secret');

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
    });

    it('reclaims stale Shiprocket processing events through the cron drain endpoint', async () => {
        const order = await orderModel.create({
            userId: '507f1f77bcf86cd799439012',
            items: [{ _id: '507f1f77bcf86cd799439011', name: 'Tee', price: 199, quantity: 1, size: 'M' }],
            amount: 209,
            address: {
                firstName: 'A',
                lastName: 'B',
                street: 'S',
                city: 'C',
                state: 'ST',
                pincode: '123456',
                country: 'IN',
                phone: '9999999999'
            },
            paymentMethod: 'COD',
            payment: false,
            paymentStatus: 'pending',
            status: 'Order Placed',
            shiprocket: {
                syncStatus: 'synced',
                referenceOrderId: 'SR-REF-2001',
                orderId: 9201,
                shipmentId: 3201,
                awbCode: 'AWB2001'
            },
            date: Date.now()
        });

        await shiprocketWebhookEventModel.create({
            provider: 'shiprocket',
            eventKey: 'shiprocket:ship_evt_stale_1',
            shipmentId: 3201,
            orderId: 9201,
            awbCode: 'AWB2001',
            status: 'Delivered',
            payloadHash: crypto.createHash('sha256').update('ship_evt_stale_1').digest('hex'),
            rawPayload: {
                event_id: 'ship_evt_stale_1',
                shipment_id: 3201,
                order_id: 9201,
                awb_code: 'AWB2001',
                current_status: 'Delivered',
                updated_at: '2026-04-18T10:30:00.000Z'
            },
            processingStatus: 'processing',
            processingAttempts: 1,
            lastProcessingStartedAt: new Date(Date.now() - (10 * 60 * 1000))
        });

        const response = await triggerShiprocketWebhookDrain({
            app
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.skipped).toBe(false);
        expect(response.body.drainResult.outcomes.processed).toBeGreaterThanOrEqual(1);

        const updatedOrder = await orderModel.findById(order._id).lean();
        const updatedEvent = await shiprocketWebhookEventModel.findOne({ eventKey: 'shiprocket:ship_evt_stale_1' }).lean();

        expect(updatedOrder.status).toBe('Delivered');
        expect(updatedOrder.payment).toBe(true);
        expect(updatedOrder.shiprocket.currentStatus).toBe('Delivered');
        expect(updatedEvent.processingStatus).toBe('processed');
        expect(updatedEvent.matchedOrderId).toBe(String(order._id));
    });

    it('skips cron drain work when another drain invocation already holds the lock', async () => {
        await distributedLockModel.create({
            key: 'shiprocket_webhook_drain',
            ownerId: 'existing-owner',
            expiresAt: new Date(Date.now() + 60_000),
            metadata: {
                trigger: 'cron'
            }
        });

        const response = await triggerShiprocketWebhookDrain({
            app
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.skipped).toBe(true);
        expect(response.body.reason).toBe('drain_locked');
        expect(response.body.lock.ownerId).toBe('existing-owner');
    });

    it('exposes Shiprocket webhook queue health and last drain metadata for admin users', async () => {
        await triggerShiprocketWebhookDrain({
            app
        });

        await insertShiprocketWebhookPayload({
            payload: {
                event_id: 'ship_evt_status_pending_1',
                shipment_id: 501,
                awb_code: 'AWB-STATUS-501',
                current_status: 'Shipped',
                updated_at: '2026-04-18T11:00:00.000Z'
            }
        });

        await insertShiprocketWebhookPayload({
            payload: {
                event_id: 'ship_evt_status_processing_1',
                shipment_id: 502,
                awb_code: 'AWB-STATUS-502',
                current_status: 'In Transit',
                updated_at: '2026-04-18T11:05:00.000Z'
            },
            processingStatus: 'processing',
            processingAttempts: 1,
            lastProcessingStartedAt: new Date()
        });

        const response = await fetchShiprocketWebhookStatus({
            app
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.queue.pendingEvents).toBe(1);
        expect(response.body.queue.processingEvents).toBe(1);
        expect(response.body.drain.lastRun.status).toBe('completed');
        expect(response.body.drain.lastDrainRunTimestamp).toBeTruthy();
    });

    it('rejects Shiprocket webhook status requests without admin authentication', async () => {
        const response = await request(app)
            .get('/api/system/shiprocket/webhook-status');

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
    });

    it('respects the manual Shiprocket drain batch size and leaves the remaining queue for later runs', async () => {
        const createOrderWithShiprocketIds = async ({ referenceOrderId, orderId, shipmentId, awbCode }) =>
            orderModel.create({
                userId: '507f1f77bcf86cd799439012',
                items: [{ _id: '507f1f77bcf86cd799439011', name: 'Tee', price: 199, quantity: 1, size: 'M' }],
                amount: 209,
                address: {
                    firstName: 'A',
                    lastName: 'B',
                    street: 'S',
                    city: 'C',
                    state: 'ST',
                    pincode: '123456',
                    country: 'IN',
                    phone: '9999999999'
                },
                paymentMethod: 'COD',
                payment: false,
                paymentStatus: 'pending',
                status: 'Order Placed',
                shiprocket: {
                    syncStatus: 'synced',
                    referenceOrderId,
                    orderId,
                    shipmentId,
                    awbCode
                },
                date: Date.now()
            });

        await Promise.all([
            createOrderWithShiprocketIds({
                referenceOrderId: 'SR-BATCH-1001',
                orderId: 101001,
                shipmentId: 201001,
                awbCode: 'BATCH-AWB-1001'
            }),
            createOrderWithShiprocketIds({
                referenceOrderId: 'SR-BATCH-1002',
                orderId: 101002,
                shipmentId: 201002,
                awbCode: 'BATCH-AWB-1002'
            }),
            createOrderWithShiprocketIds({
                referenceOrderId: 'SR-BATCH-1003',
                orderId: 101003,
                shipmentId: 201003,
                awbCode: 'BATCH-AWB-1003'
            })
        ]);

        await Promise.all([
            insertShiprocketWebhookPayload({
                payload: {
                    event_id: 'ship_evt_batch_1',
                    shipment_id: 201001,
                    order_id: 101001,
                    awb_code: 'BATCH-AWB-1001',
                    current_status: 'Shipped',
                    updated_at: '2026-04-18T12:00:00.000Z'
                }
            }),
            insertShiprocketWebhookPayload({
                payload: {
                    event_id: 'ship_evt_batch_2',
                    shipment_id: 201002,
                    order_id: 101002,
                    awb_code: 'BATCH-AWB-1002',
                    current_status: 'Shipped',
                    updated_at: '2026-04-18T12:01:00.000Z'
                }
            }),
            insertShiprocketWebhookPayload({
                payload: {
                    event_id: 'ship_evt_batch_3',
                    shipment_id: 201003,
                    order_id: 101003,
                    awb_code: 'BATCH-AWB-1003',
                    current_status: 'Shipped',
                    updated_at: '2026-04-18T12:02:00.000Z'
                }
            })
        ]);

        const adminToken = jwt.sign(
            {
                role: 'admin',
                email: process.env.ADMIN_EMAIL
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        const response = await request(app)
            .post('/api/system/shiprocket/webhook-drain')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                batchSize: 1,
                timeBudgetMs: 5000
            });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.drainResult.claimedCount).toBe(1);

        expect(await shiprocketWebhookEventModel.countDocuments({ processingStatus: 'processed' })).toBe(1);
        expect(await shiprocketWebhookEventModel.countDocuments({ processingStatus: 'queued' })).toBe(2);
    });
});
