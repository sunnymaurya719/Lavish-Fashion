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

vi.mock('stripe', () => {
    return {
        default: class StripeMock {
            constructor() {
                this.checkout = {
                    sessions: {
                        create: vi.fn(async () => ({ id: 'cs_test_mock', url: 'http://localhost/mock' })),
                        retrieve: vi.fn(async () => ({
                            id: 'cs_test_mock',
                            payment_status: 'paid',
                            client_reference_id: '507f1f77bcf86cd799439011',
                            metadata: {
                                orderId: '507f1f77bcf86cd799439011',
                                userId: '507f1f77bcf86cd799439012'
                            }
                        }))
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

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        await mongoose.connect(mongoServer.getUri(), { dbName: 'lavish-fashion-webhooks' });

        const appModule = await import('../app.js');
        const userModule = await import('../models/userModel.js');
        const orderModule = await import('../models/orderModel.js');

        app = appModule.default();
        userModel = userModule.default;
        orderModel = orderModule.default;
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
    });

    it('marks Stripe order as paid only after webhook confirmation', async () => {
        const user = await userModel.create({
            name: 'Webhook User',
            email: 'webhook@example.com',
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
            paymentMethod: 'Stripe',
            payment: false,
            paymentStatus: 'pending',
            date: Date.now()
        });

        const webhookPayload = {
            id: 'evt_test_1',
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: 'cs_test_1',
                    client_reference_id: String(order._id),
                    payment_intent: 'pi_test_1',
                    metadata: {
                        orderId: String(order._id),
                        userId: String(user._id)
                    }
                }
            }
        };

        const response = await request(app)
            .post('/api/webhooks/stripe')
            .set('stripe-signature', 't_stripe_sig')
            .set('Content-Type', 'application/json')
            .send(webhookPayload);

        expect(response.status).toBe(200);

        const updatedOrder = await orderModel.findById(order._id).lean();
        const updatedUser = await userModel.findById(user._id).lean();

        expect(updatedOrder.payment).toBe(true);
        expect(updatedOrder.paymentStatus).toBe('paid');
        expect(updatedOrder.stripeSessionId).toBe('cs_test_1');
        expect(updatedOrder.stripePaymentIntentId).toBe('pi_test_1');
        expect(updatedUser.cartData).toEqual({});
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
});
