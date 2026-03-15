import crypto from 'crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'StrongAdminPass123';
process.env.CLIENT_URL = 'http://localhost:5173';
process.env.ADMIN_URL = 'http://localhost:5174';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.CORS_ORIGINS = 'http://localhost:5173,http://localhost:5174';
process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_mock';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'rzp_secret_mock';
process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_whsec_mock';

let stripeSessionCounter = 1;
let razorpayOrderCounter = 1;
const stripeSessions = new Map();

vi.mock('stripe', () => {
    return {
        default: class StripeMock {
            constructor() {
                this.checkout = {
                    sessions: {
                        create: vi.fn(async (payload) => {
                            const id = `cs_test_${stripeSessionCounter++}`;
                            const session = {
                                id,
                                url: `http://localhost/checkout/${id}`,
                                payment_status: 'paid',
                                client_reference_id: payload.client_reference_id,
                                metadata: payload.metadata,
                                payment_intent: `pi_${id}`
                            };

                            stripeSessions.set(id, session);
                            return session;
                        }),
                        retrieve: vi.fn(async (sessionId) => stripeSessions.get(sessionId))
                    }
                };
                this.webhooks = {
                    constructEvent: (buffer, signature, _secret) => {
                        if (signature !== 't_stripe_sig') {
                            throw new Error('invalid stripe signature');
                        }

                        return JSON.parse(buffer.toString('utf8'));
                    }
                };
            }
        }
    };
});

vi.mock('razorpay', () => {
    return {
        default: class RazorpayMock {
            constructor() {
                this.orders = {
                    create: vi.fn(async (payload) => ({
                        id: `order_test_${razorpayOrderCounter++}`,
                        amount: payload.amount,
                        currency: payload.currency,
                        receipt: payload.receipt,
                        status: 'created'
                    }))
                };
            }
        }
    };
});

describe('checkout and order lifecycle e2e api tests', () => {
    let mongoServer;
    let app;
    let orderModel;
    let productModel;

    const address = {
        firstName: 'A',
        lastName: 'B',
        street: 'Street 1',
        city: 'Delhi',
        state: 'DL',
        pincode: '110001',
        country: 'IN',
        phone: '9999999999'
    };

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        await mongoose.connect(mongoServer.getUri(), { dbName: 'lavish-fashion-e2e' });

        const appModule = await import('../app.js');
        const productModule = await import('../models/productModel.js');
        const orderModule = await import('../models/orderModel.js');

        app = appModule.default();
        productModel = productModule.default;
        orderModel = orderModule.default;
    }, 1200000);

    afterAll(async () => {
        await mongoose.disconnect();
        if (mongoServer) {
            await mongoServer.stop();
        }
    });

    beforeEach(async () => {
        stripeSessions.clear();
        await productModel.deleteMany({});
        await orderModel.deleteMany({});
    });

    it('completes stripe checkout lifecycle with webhook as source of truth', async () => {
        const product = await productModel.create({
            name: 'Stripe Tee',
            description: 'A premium stripe checkout test product',
            price: 299,
            image: ['https://example.com/image.jpg'],
            category: 'Men',
            subCategory: 'Topwear',
            sizes: ['M'],
            date: Date.now()
        });

        const registerResponse = await request(app)
            .post('/api/user/register')
            .send({ name: 'Stripe User', email: 'stripeuser@example.com', password: 'SecurePass123' });

        expect(registerResponse.status).toBe(201);
        const token = registerResponse.body.token;

        const orderResponse = await request(app)
            .post('/api/order/stripe')
            .set('token', token)
            .set('idempotency-key', `stripe_${Date.now()}`)
            .send({
                items: [{ _id: String(product._id), quantity: 1, size: 'M' }],
                amount: 1,
                address
            });

        expect(orderResponse.status).toBe(200);
        expect(orderResponse.body.success).toBe(true);

        const orderId = orderResponse.body.session.client_reference_id;
        const sessionId = orderResponse.body.session.id;

        const verifyResponse = await request(app)
            .post('/api/order/verifyStripe')
            .set('token', token)
            .send({ orderId, success: 'true', session_id: sessionId });

        expect(verifyResponse.status).toBe(200);
        expect(verifyResponse.body.success).toBe(true);

        const postVerifyStripeOrder = await orderModel.findById(orderId).lean();
        expect(postVerifyStripeOrder.payment).toBe(true);
        expect(postVerifyStripeOrder.paymentStatus).toBe('paid');

        const webhookPayload = {
            id: 'evt_checkout_complete_1',
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: sessionId,
                    client_reference_id: orderId,
                    payment_intent: `pi_${sessionId}`,
                    metadata: {
                        orderId,
                        userId: mongoose.Types.ObjectId.isValid(orderId) ? undefined : undefined
                    }
                }
            }
        };

        webhookPayload.data.object.metadata = { orderId, userId: String((await orderModel.findById(orderId)).userId) };

        const webhookResponse = await request(app)
            .post('/api/webhooks/stripe')
            .set('stripe-signature', 't_stripe_sig')
            .set('Content-Type', 'application/json')
            .send(webhookPayload);

        expect(webhookResponse.status).toBe(200);

        const ordersResponse = await request(app)
            .post('/api/order/userorders')
            .set('token', token)
            .send({});

        expect(ordersResponse.status).toBe(200);
        expect(ordersResponse.body.orders.length).toBe(1);
        expect(ordersResponse.body.orders[0].payment).toBe(true);
        expect(ordersResponse.body.orders[0].paymentStatus).toBe('paid');
    });

    it('completes razorpay checkout lifecycle with webhook as source of truth', async () => {
        const product = await productModel.create({
            name: 'Razorpay Tee',
            description: 'A premium razorpay checkout test product',
            price: 349,
            image: ['https://example.com/image2.jpg'],
            category: 'Men',
            subCategory: 'Topwear',
            sizes: ['L'],
            date: Date.now()
        });

        const registerResponse = await request(app)
            .post('/api/user/register')
            .send({ name: 'Razor User', email: 'razoruser@example.com', password: 'SecurePass123' });

        expect(registerResponse.status).toBe(201);
        const token = registerResponse.body.token;

        const orderResponse = await request(app)
            .post('/api/order/razorpay')
            .set('token', token)
            .set('idempotency-key', `razorpay_${Date.now()}`)
            .send({
                items: [{ _id: String(product._id), quantity: 1, size: 'L' }],
                amount: 1,
                address
            });

        expect(orderResponse.status).toBe(200);
        expect(orderResponse.body.success).toBe(true);

        const razorpayOrderId = orderResponse.body.order.id;

        const paymentId = 'pay_test_e2e_1';
        const verifySignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpayOrderId}|${paymentId}`)
            .digest('hex');

        const verifyResponse = await request(app)
            .post('/api/order/verifyRazorpay')
            .set('token', token)
            .send({
                razorpay_order_id: razorpayOrderId,
                razorpay_payment_id: paymentId,
                razorpay_signature: verifySignature
            });

        expect(verifyResponse.status).toBe(200);
        expect(verifyResponse.body.success).toBe(true);

    const postVerifyRazorpayOrder = await orderModel.findOne({ razorpayOrderId }).lean();
    expect(postVerifyRazorpayOrder.payment).toBe(true);
    expect(postVerifyRazorpayOrder.paymentStatus).toBe('paid');

        const webhookPayload = {
            event: 'payment.captured',
            payload: {
                payment: {
                    entity: {
                        id: paymentId,
                        order_id: razorpayOrderId,
                        status: 'captured'
                    }
                }
            }
        };

        const webhookBody = JSON.stringify(webhookPayload);
        const webhookSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
            .update(webhookBody)
            .digest('hex');

        const webhookResponse = await request(app)
            .post('/api/webhooks/razorpay')
            .set('x-razorpay-signature', webhookSignature)
            .set('Content-Type', 'application/json')
            .send(webhookBody);

        expect(webhookResponse.status).toBe(200);

        const ordersResponse = await request(app)
            .post('/api/order/userorders')
            .set('token', token)
            .send({});

        expect(ordersResponse.status).toBe(200);
        expect(ordersResponse.body.orders.length).toBe(1);
        expect(ordersResponse.body.orders[0].payment).toBe(true);
        expect(ordersResponse.body.orders[0].paymentStatus).toBe('paid');
    });
});
