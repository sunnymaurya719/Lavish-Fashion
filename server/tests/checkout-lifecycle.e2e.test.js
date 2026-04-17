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
process.env.WHATSAPP_ACCESS_TOKEN = 'wa_test_token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '980132085193608';
process.env.WHATSAPP_TEMPLATE_ORDER_PLACED = 'order_placed';
process.env.WHATSAPP_TEMPLATE_OUT_FOR_DELIVERY = 'order_out_for_delivery';
process.env.WHATSAPP_TEMPLATE_DELIVERED = 'order_delivered';
process.env.WHATSAPP_TEMPLATE_LANGUAGE_CODE = 'en_US';
process.env.WHATSAPP_GRAPH_API_VERSION = 'v25.0';
process.env.WHATSAPP_DEFAULT_COUNTRY_CODE = '91';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'wa_verify_token';
process.env.WHATSAPP_APP_SECRET = 'wa_app_secret';

let stripeSessionCounter = 1;
let razorpayOrderCounter = 1;
let whatsappMessageCounter = 1;
const stripeSessions = new Map();
const whatsappFetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
        messages: [
            {
                id: `wamid.test.${whatsappMessageCounter++}`
            }
        ]
    })
}));

vi.stubGlobal('fetch', whatsappFetchMock);

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
    let couponModel;
    let orderModel;
    let paymentAttemptModel;
    let productModel;
    let userModel;

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
        const couponModule = await import('../models/couponModel.js');
        const productModule = await import('../models/productModel.js');
        const orderModule = await import('../models/orderModel.js');
        const paymentAttemptModule = await import('../models/paymentAttemptModel.js');
        const userModule = await import('../models/userModel.js');

        app = appModule.default();
        couponModel = couponModule.default;
        productModel = productModule.default;
        orderModel = orderModule.default;
        paymentAttemptModel = paymentAttemptModule.default;
        userModel = userModule.default;
    }, 1200000);

    afterAll(async () => {
        await mongoose.disconnect();
        if (mongoServer) {
            await mongoServer.stop();
        }
        vi.unstubAllGlobals();
    });

    beforeEach(async () => {
        stripeSessions.clear();
        whatsappMessageCounter = 1;
        whatsappFetchMock.mockClear();
        await couponModel.deleteMany({});
        await productModel.deleteMany({});
        await orderModel.deleteMany({});
        await paymentAttemptModel.deleteMany({});
        await userModel.deleteMany({});
    });

    it('returns public bootstrap data for client and admin integration', async () => {
        const response = await request(app).get('/api/system/bootstrap');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.bootstrap).toEqual(
            expect.objectContaining({
                runtime: expect.objectContaining({
                    environment: expect.any(String),
                    timestamp: expect.any(String)
                }),
                payments: expect.objectContaining({
                    stripeEnabled: true,
                    razorpayEnabled: true,
                    razorpayKeyId: process.env.RAZORPAY_KEY_ID
                }),
                features: expect.objectContaining({
                    dashboardEnabled: true,
                    loyaltyEnabled: true,
                    reviewMediaEnabled: false
                })
            })
        );
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
            stock: 5,
            lowStockThreshold: 2,
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

        const paymentAttemptId = orderResponse.body.session.client_reference_id;
        const sessionId = orderResponse.body.session.id;
        const pendingStripeAttempt = await paymentAttemptModel.findById(paymentAttemptId).lean();
        const reservedStripeProduct = await productModel.findById(product._id).lean();

        expect(pendingStripeAttempt.inventoryReserved).toBe(true);
        expect(pendingStripeAttempt.status).toBe('pending');
        expect(reservedStripeProduct.stock).toBe(4);

        const verifyResponse = await request(app)
            .post('/api/order/verifyStripe')
            .set('token', token)
            .send({ orderId: paymentAttemptId, success: 'true', session_id: sessionId });

        expect(verifyResponse.status).toBe(200);
        expect(verifyResponse.body.success).toBe(true);

        const postVerifyStripeAttempt = await paymentAttemptModel.findById(paymentAttemptId).lean();
        const createdStripeOrder = await orderModel.findOne({ userId: pendingStripeAttempt.userId }).lean();
        const postVerifyStripeProduct = await productModel.findById(product._id).lean();
        expect(postVerifyStripeAttempt.status).toBe('order_created');
        expect(createdStripeOrder).toBeTruthy();
        expect(createdStripeOrder.payment).toBe(true);
        expect(createdStripeOrder.paymentStatus).toBe('paid');
        expect(createdStripeOrder.inventoryReserved).toBe(true);
        expect(postVerifyStripeProduct.stock).toBe(4);

        const webhookPayload = {
            id: 'evt_checkout_complete_1',
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: sessionId,
                    client_reference_id: paymentAttemptId,
                    payment_intent: `pi_${sessionId}`,
                    metadata: {
                        orderId: paymentAttemptId,
                        paymentAttemptId
                    }
                }
            }
        };

        webhookPayload.data.object.metadata = {
            orderId: paymentAttemptId,
            paymentAttemptId,
            userId: String(pendingStripeAttempt.userId)
        };

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
            stock: 5,
            lowStockThreshold: 2,
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
        const pendingRazorpayAttempt = await paymentAttemptModel.findOne({ razorpayOrderId }).lean();
        const reservedRazorpayProduct = await productModel.findById(product._id).lean();

        expect(pendingRazorpayAttempt.inventoryReserved).toBe(true);
        expect(pendingRazorpayAttempt.status).toBe('pending');
        expect(reservedRazorpayProduct.stock).toBe(4);

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

        const postVerifyRazorpayAttempt = await paymentAttemptModel.findOne({ razorpayOrderId }).lean();
        const postVerifyRazorpayOrder = await orderModel.findOne({ razorpayOrderId }).lean();
        const postVerifyRazorpayProduct = await productModel.findById(product._id).lean();
        expect(postVerifyRazorpayAttempt.status).toBe('order_created');
        expect(postVerifyRazorpayOrder.payment).toBe(true);
        expect(postVerifyRazorpayOrder.paymentStatus).toBe('paid');
        expect(postVerifyRazorpayOrder.inventoryReserved).toBe(true);
        expect(postVerifyRazorpayProduct.stock).toBe(4);

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

    it('places a COD order and exposes it in user order history', async () => {
        const product = await productModel.create({
            name: 'COD Tee',
            description: 'A premium cash on delivery test product',
            price: 249,
            image: ['https://example.com/image3.jpg'],
            category: 'Men',
            subCategory: 'Topwear',
            sizes: ['S'],
            stock: 5,
            lowStockThreshold: 2,
            date: Date.now()
        });

        const registerResponse = await request(app)
            .post('/api/user/register')
            .send({ name: 'COD User', email: 'coduser@example.com', password: 'SecurePass123' });

        expect(registerResponse.status).toBe(201);
        const token = registerResponse.body.token;

        const orderResponse = await request(app)
            .post('/api/order/place')
            .set('token', token)
            .set('idempotency-key', `cod_${Date.now()}`)
            .send({
                items: [{ _id: String(product._id), quantity: 1, size: 'S' }],
                amount: 1,
                address,
                checkoutSource: 'cart'
            });

        expect(orderResponse.status).toBe(201);
        expect(orderResponse.body.success).toBe(true);

        const createdOrder = await orderModel.findById(orderResponse.body.orderId).lean();
        const reservedCodProduct = await productModel.findById(product._id).lean();
        expect(createdOrder.paymentMethod).toBe('COD');
        expect(createdOrder.payment).toBe(false);
        expect(createdOrder.paymentStatus).toBe('pending');
        expect(createdOrder.inventoryReserved).toBe(true);
        expect(reservedCodProduct.stock).toBe(4);

        const ordersResponse = await request(app)
            .post('/api/order/userorders')
            .set('token', token)
            .send({});

        expect(ordersResponse.status).toBe(200);
        expect(ordersResponse.body.orders.length).toBe(1);
        expect(ordersResponse.body.orders[0].paymentMethod).toBe('COD');
    });

    it('sends WhatsApp template notifications for placed, out-for-delivery, and delivered without duplicates', async () => {
        const product = await productModel.create({
            name: 'WhatsApp Tee',
            description: 'A product used to validate WhatsApp order notifications',
            price: 250,
            image: ['https://example.com/image-whatsapp.jpg'],
            category: 'Women',
            subCategory: 'Topwear',
            sizes: ['28'],
            stock: 5,
            lowStockThreshold: 1,
            date: Date.now()
        });

        const registerResponse = await request(app)
            .post('/api/user/register')
            .send({ name: 'Sunny User', email: 'sunnywa@example.com', password: 'SecurePass123' });

        expect(registerResponse.status).toBe(201);
        const token = registerResponse.body.token;

        const orderResponse = await request(app)
            .post('/api/order/place')
            .set('token', token)
            .set('idempotency-key', `whatsapp_cod_${Date.now()}`)
            .send({
                items: [{ _id: String(product._id), quantity: 1, size: '28' }],
                address: {
                    firstName: 'Sunny',
                    lastName: 'Maurya',
                    street: 'New Subhash Nagar',
                    city: 'Ludhiana',
                    state: 'Punjab',
                    pincode: '141007',
                    country: 'India',
                    phone: '9988073907'
                },
                checkoutSource: 'cart'
            });

        expect(orderResponse.status).toBe(201);
        expect(whatsappFetchMock).toHaveBeenCalledTimes(1);

        const placedOrder = await orderModel.findById(orderResponse.body.orderId).lean();
        expect(placedOrder.whatsappNotifications.placedSent).toBe(true);
        expect(placedOrder.whatsappNotifications.placedMessageId).toBeTruthy();
        expect(placedOrder.whatsappNotifications.outForDeliverySent).toBe(false);
        expect(placedOrder.whatsappNotifications.deliveredSent).toBe(false);

        /*
        const placedPayload = JSON.parse(whatsappFetchMock.mock.calls[0][1].body);
        expect(placedPayload.template.name).toBe(process.env.WHATSAPP_TEMPLATE_ORDER_PLACED);
        expect(placedPayload.to).toBe('9988073907');
        expect(placedPayload.template.components[0].parameters.map((parameter) => parameter.text)).toEqual([
            'Sunny Maurya',
            `LF-${String(placedOrder._id).slice(-8).toUpperCase()}`,
            '₹260',
            'Order placed'
        ]);
        */
        const placedPayloadUtf8 = JSON.parse(whatsappFetchMock.mock.calls[0][1].body);
        expect(placedPayloadUtf8.template.name).toBe(process.env.WHATSAPP_TEMPLATE_ORDER_PLACED);
        expect(placedPayloadUtf8.to).toBe('919988073907');
        expect(placedPayloadUtf8.template.components[0].parameters.map((parameter) => parameter.text)).toEqual([
            'Sunny Maurya',
            `LF-${String(placedOrder.shiprocket?.referenceOrderId || placedOrder._id).slice(-8).toUpperCase()}`,
            '260',
            'Order placed'
        ]);

        const adminLoginResponse = await request(app)
            .post('/api/user/admin')
            .send({
                email: process.env.ADMIN_EMAIL,
                password: process.env.ADMIN_PASSWORD
            });

        expect(adminLoginResponse.status).toBe(200);
        const adminToken = adminLoginResponse.body.token;

        const outForDeliveryResponse = await request(app)
            .post('/api/order/status')
            .set('token', adminToken)
            .send({
                orderId: String(placedOrder._id),
                status: 'Out for delivery'
            });

        expect(outForDeliveryResponse.status).toBe(200);
        expect(whatsappFetchMock).toHaveBeenCalledTimes(2);

        const outForDeliveryOrder = await orderModel.findById(placedOrder._id).lean();
        expect(outForDeliveryOrder.whatsappNotifications.outForDeliverySent).toBe(true);
        expect(outForDeliveryOrder.whatsappNotifications.outForDeliveryMessageId).toBeTruthy();

        const deliveredResponse = await request(app)
            .post('/api/order/status')
            .set('token', adminToken)
            .send({
                orderId: String(placedOrder._id),
                status: 'Delivered'
            });

        expect(deliveredResponse.status).toBe(200);
        expect(whatsappFetchMock).toHaveBeenCalledTimes(3);

        const deliveredOrder = await orderModel.findById(placedOrder._id).lean();
        expect(deliveredOrder.whatsappNotifications.deliveredSent).toBe(true);
        expect(deliveredOrder.whatsappNotifications.deliveredMessageId).toBeTruthy();

        const duplicateDeliveredResponse = await request(app)
            .post('/api/order/status')
            .set('token', adminToken)
            .send({
                orderId: String(placedOrder._id),
                status: 'Delivered'
            });

        expect(duplicateDeliveredResponse.status).toBe(200);
        expect(whatsappFetchMock).toHaveBeenCalledTimes(3);
    });

    it('verifies the WhatsApp webhook and records message delivery updates by message id', async () => {
        const verifyResponse = await request(app)
            .get('/api/webhooks/whatsapp')
            .query({
                'hub.mode': 'subscribe',
                'hub.verify_token': process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
                'hub.challenge': '12345'
            });

        expect(verifyResponse.status).toBe(200);
        expect(verifyResponse.text).toBe('12345');

        const order = await orderModel.create({
            userId: new mongoose.Types.ObjectId().toString(),
            items: [
                {
                    _id: new mongoose.Types.ObjectId().toString(),
                    name: 'Webhook Tee',
                    price: 199,
                    image: ['https://example.com/image-webhook.jpg'],
                    size: 'M',
                    quantity: 1
                }
            ],
            subtotal: 199,
            deliveryFee: 10,
            discountAmount: 0,
            amount: 209,
            address,
            paymentMethod: 'COD',
            payment: false,
            paymentStatus: 'pending',
            status: 'Order Placed',
            date: Date.now(),
            whatsappNotifications: {
                placedSent: true,
                placedMessageId: 'wamid.test.known'
            }
        });

        const webhookPayload = {
            object: 'whatsapp_business_account',
            entry: [
                {
                    changes: [
                        {
                            value: {
                                statuses: [
                                    {
                                        id: 'wamid.test.known',
                                        status: 'delivered',
                                        timestamp: '1711111111'
                                    }
                                ]
                            }
                        }
                    ]
                }
            ]
        };
        const webhookBody = JSON.stringify(webhookPayload);
        const whatsappWebhookSignature = `sha256=${crypto
            .createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
            .update(Buffer.from(webhookBody))
            .digest('hex')}`;

        const webhookResponse = await request(app)
            .post('/api/webhooks/whatsapp')
            .set('x-hub-signature-256', whatsappWebhookSignature)
            .set('Content-Type', 'application/json')
            .send(webhookBody);

        expect(webhookResponse.status).toBe(200);
        expect(webhookResponse.body.received).toBe(true);

        const refreshedOrder = await orderModel.findById(order._id).lean();
        expect(refreshedOrder.whatsappNotifications.placedWebhookStatus).toBe('delivered');
        expect(refreshedOrder.whatsappNotifications.placedWebhookTimestamp).toBe(1711111111000);
    });

    it('cancels an order within six hours and releases reserved inventory', async () => {
        const product = await productModel.create({
            name: 'Cancelable Tee',
            description: 'A product used to validate user order cancellation',
            price: 279,
            image: ['https://example.com/image-cancel.jpg'],
            category: 'Women',
            subCategory: 'Topwear',
            sizes: ['M'],
            stock: 3,
            lowStockThreshold: 1,
            date: Date.now()
        });

        const registerResponse = await request(app)
            .post('/api/user/register')
            .send({ name: 'Cancel Flow User', email: 'cancelflow@example.com', password: 'SecurePass123' });

        expect(registerResponse.status).toBe(201);
        const token = registerResponse.body.token;

        const orderResponse = await request(app)
            .post('/api/order/place')
            .set('token', token)
            .set('idempotency-key', `cancel_cod_${Date.now()}`)
            .send({
                items: [{ _id: String(product._id), quantity: 1, size: 'M' }],
                address,
                checkoutSource: 'cart'
            });

        expect(orderResponse.status).toBe(201);
        expect(orderResponse.body.success).toBe(true);

        const reservedOrder = await orderModel.findById(orderResponse.body.orderId).lean();
        const reservedProduct = await productModel.findById(product._id).lean();
        expect(reservedOrder.status).toBe('Order Placed');
        expect(reservedOrder.inventoryReserved).toBe(true);
        expect(reservedProduct.stock).toBe(2);

        const cancelResponse = await request(app)
            .post(`/api/orders/${reservedOrder._id}/cancel`)
            .set('token', token)
            .send({});

        expect(cancelResponse.status).toBe(200);
        expect(cancelResponse.body.success).toBe(true);

        const cancelledOrder = await orderModel.findById(reservedOrder._id).lean();
        const restoredProduct = await productModel.findById(product._id).lean();

        expect(cancelledOrder.status).toBe('Cancelled');
        expect(cancelledOrder.paymentStatus).toBe('cancelled');
        expect(cancelledOrder.inventoryReserved).toBe(false);
        expect(cancelledOrder.cancelledAt).toEqual(expect.any(Number));
        expect(restoredProduct.stock).toBe(3);
    });

    it('rejects order cancellation requests after six hours', async () => {
        const product = await productModel.create({
            name: 'Expired Cancel Tee',
            description: 'A product used to validate the cancellation window restriction',
            price: 289,
            image: ['https://example.com/image-expired-cancel.jpg'],
            category: 'Women',
            subCategory: 'Topwear',
            sizes: ['S'],
            stock: 4,
            lowStockThreshold: 1,
            date: Date.now()
        });

        const registerResponse = await request(app)
            .post('/api/user/register')
            .send({ name: 'Expired Cancel User', email: 'expiredcancel@example.com', password: 'SecurePass123' });

        expect(registerResponse.status).toBe(201);
        const token = registerResponse.body.token;

        const orderResponse = await request(app)
            .post('/api/order/place')
            .set('token', token)
            .set('idempotency-key', `cancel_expired_${Date.now()}`)
            .send({
                items: [{ _id: String(product._id), quantity: 1, size: 'S' }],
                address,
                checkoutSource: 'cart'
            });

        expect(orderResponse.status).toBe(201);

        const createdOrder = await orderModel.findById(orderResponse.body.orderId);
        createdOrder.createdAt = new Date(Date.now() - 7 * 60 * 60 * 1000);
        await createdOrder.save();

        const cancelResponse = await request(app)
            .post(`/api/orders/${createdOrder._id}/cancel`)
            .set('token', token)
            .send({});

        expect(cancelResponse.status).toBe(400);
        expect(cancelResponse.body.success).toBe(false);
        expect(cancelResponse.body.message).toBe('Order can only be cancelled within 6 hours of placing it.');

        const unchangedOrder = await orderModel.findById(createdOrder._id).lean();
        const reservedProduct = await productModel.findById(product._id).lean();

        expect(unchangedOrder.status).toBe('Order Placed');
        expect(unchangedOrder.inventoryReserved).toBe(true);
        expect(reservedProduct.stock).toBe(3);
    });

    it('releases reserved inventory when Stripe checkout is cancelled', async () => {
        const product = await productModel.create({
            name: 'Stripe Cancel Tee',
            description: 'A product used to verify inventory release on payment cancellation',
            price: 399,
            image: ['https://example.com/image4.jpg'],
            category: 'Men',
            subCategory: 'Topwear',
            sizes: ['M'],
            stock: 2,
            lowStockThreshold: 1,
            date: Date.now()
        });

        const registerResponse = await request(app)
            .post('/api/user/register')
            .send({ name: 'Cancel User', email: 'canceluser@example.com', password: 'SecurePass123' });

        expect(registerResponse.status).toBe(201);
        const token = registerResponse.body.token;

        const orderResponse = await request(app)
            .post('/api/order/stripe')
            .set('token', token)
            .set('idempotency-key', `stripe_cancel_${Date.now()}`)
            .send({
                items: [{ _id: String(product._id), quantity: 1, size: 'M' }],
                amount: 1,
                address
            });

        expect(orderResponse.status).toBe(200);
        expect(orderResponse.body.success).toBe(true);

        const paymentAttemptId = orderResponse.body.session.client_reference_id;
        const stockAfterReserve = await productModel.findById(product._id).lean();
        expect(stockAfterReserve.stock).toBe(1);

        const cancelResponse = await request(app)
            .post('/api/order/verifyStripe')
            .set('token', token)
            .send({ orderId: paymentAttemptId, success: 'false' });

        expect(cancelResponse.status).toBe(200);
        expect(cancelResponse.body.success).toBe(false);

        const cancelledAttempt = await paymentAttemptModel.findById(paymentAttemptId).lean();
        const userOrdersAfterCancel = await orderModel.find({ userId: cancelledAttempt.userId }).lean();
        const restoredProduct = await productModel.findById(product._id).lean();

        expect(cancelledAttempt.status).toBe('cancelled');
        expect(cancelledAttempt.inventoryReserved).toBe(false);
        expect(userOrdersAfterCancel.length).toBe(0);
        expect(restoredProduct.stock).toBe(2);
    });

    it('applies coupon pricing during validation and COD checkout', async () => {
        const product = await productModel.create({
            name: 'Coupon Tee',
            description: 'A product used to validate coupon calculations',
            price: 1000,
            image: ['https://example.com/image5.jpg'],
            category: 'Women',
            subCategory: 'Topwear',
            sizes: ['M'],
            stock: 5,
            lowStockThreshold: 2,
            date: Date.now()
        });

        const coupon = await couponModel.create({
            code: 'LAUNCH20',
            description: 'Launch campaign discount',
            discountType: 'percentage',
            discountValue: 20,
            minOrderAmount: 500,
            perUserLimit: 1,
            isActive: true
        });

        const registerResponse = await request(app)
            .post('/api/user/register')
            .send({ name: 'Coupon User', email: 'couponuser@example.com', password: 'SecurePass123' });

        expect(registerResponse.status).toBe(201);
        const token = registerResponse.body.token;

        const validationResponse = await request(app)
            .post('/api/coupon/validate')
            .set('token', token)
            .send({
                couponCode: 'launch20',
                items: [{ _id: String(product._id), quantity: 1, size: 'M' }]
            });

        expect(validationResponse.status).toBe(200);
        expect(validationResponse.body.pricing.subtotal).toBe(1000);
        expect(validationResponse.body.pricing.discountAmount).toBe(200);
        expect(validationResponse.body.pricing.total).toBe(810);
        expect(validationResponse.body.pricing.appliedCoupon.code).toBe('LAUNCH20');

        const orderResponse = await request(app)
            .post('/api/order/place')
            .set('token', token)
            .set('idempotency-key', `coupon_cod_${Date.now()}`)
            .send({
                items: [{ _id: String(product._id), quantity: 1, size: 'M' }],
                address,
                couponCode: 'launch20',
                checkoutSource: 'cart'
            });

        expect(orderResponse.status).toBe(201);
        expect(orderResponse.body.success).toBe(true);

        const createdOrder = await orderModel.findById(orderResponse.body.orderId).lean();
        expect(createdOrder.subtotal).toBe(1000);
        expect(createdOrder.deliveryFee).toBe(10);
        expect(createdOrder.discountAmount).toBe(200);
        expect(createdOrder.amount).toBe(810);
        expect(createdOrder.couponCode).toBe('LAUNCH20');
        expect(createdOrder.couponId).toBe(String(coupon._id));

        const exhaustedValidationResponse = await request(app)
            .post('/api/coupon/validate')
            .set('token', token)
            .send({
                couponCode: 'LAUNCH20',
                items: [{ _id: String(product._id), quantity: 1, size: 'M' }]
            });

        expect(exhaustedValidationResponse.status).toBe(400);
        expect(exhaustedValidationResponse.body.message).toContain('maximum number of times');
    });

    it('reserves and settles loyalty point redemption across preview, COD placement, and delivery', async () => {
        const product = await productModel.create({
            name: 'Rewards Tee',
            description: 'A product used to validate loyalty point redemption lifecycle',
            price: 500,
            image: ['https://example.com/image7.jpg'],
            category: 'Women',
            subCategory: 'Topwear',
            sizes: ['M'],
            stock: 5,
            lowStockThreshold: 2,
            date: Date.now()
        });

        const registerResponse = await request(app)
            .post('/api/user/register')
            .send({ name: 'Rewards User', email: 'rewardsuser@example.com', password: 'SecurePass123' });

        expect(registerResponse.status).toBe(201);
        const token = registerResponse.body.token;

        const rewardsUser = await userModel.findOneAndUpdate(
            { email: 'rewardsuser@example.com' },
            {
                loyaltyPoints: 200,
                lifetimeLoyaltyPoints: 200
            },
            { new: true }
        );

        const previewResponse = await request(app)
            .post('/api/order/preview')
            .set('token', token)
            .send({
                items: [{ _id: String(product._id), quantity: 2, size: 'M' }],
                pointsToRedeem: 60
            });

        expect(previewResponse.status).toBe(200);
        expect(previewResponse.body.pricing.subtotal).toBe(1000);
        expect(previewResponse.body.pricing.loyaltyDiscountAmount).toBe(60);
        expect(previewResponse.body.pricing.loyaltyPointsRedeemed).toBe(60);
        expect(previewResponse.body.pricing.availableLoyaltyPoints).toBe(200);
        expect(previewResponse.body.pricing.total).toBe(950);

        const orderResponse = await request(app)
            .post('/api/order/place')
            .set('token', token)
            .set('idempotency-key', `rewards_cod_${Date.now()}`)
            .send({
                items: [{ _id: String(product._id), quantity: 2, size: 'M' }],
                address,
                pointsToRedeem: 60,
                checkoutSource: 'cart'
            });

        expect(orderResponse.status).toBe(201);
        expect(orderResponse.body.success).toBe(true);

        const reservedOrder = await orderModel.findById(orderResponse.body.orderId).lean();
        const reservedUser = await userModel.findById(rewardsUser._id).lean();

        expect(reservedOrder.loyaltyDiscountAmount).toBe(60);
        expect(reservedOrder.loyaltyPointsRedeemed).toBe(60);
        expect(reservedOrder.loyaltyRedemptionStatus).toBe('reserved');
        expect(reservedOrder.amount).toBe(950);
        expect(reservedUser.loyaltyPoints).toBe(200);
        expect(reservedUser.reservedLoyaltyPoints).toBe(60);

        const adminLoginResponse = await request(app)
            .post('/api/user/admin')
            .send({
                email: process.env.ADMIN_EMAIL,
                password: process.env.ADMIN_PASSWORD
            });

        expect(adminLoginResponse.status).toBe(200);
        const adminToken = adminLoginResponse.body.token;

        const deliveredResponse = await request(app)
            .post('/api/order/status')
            .set('token', adminToken)
            .send({
                orderId: String(reservedOrder._id),
                status: 'Delivered'
            });

        expect(deliveredResponse.status).toBe(200);

        const settledOrder = await orderModel.findById(reservedOrder._id).lean();
        const settledUser = await userModel.findById(rewardsUser._id).lean();

        expect(settledOrder.loyaltyRedemptionStatus).toBe('redeemed');
        expect(settledUser.reservedLoyaltyPoints).toBe(0);
        expect(settledUser.loyaltyPoints).toBe(150);
    });

    it('supports wishlist add and remove flows for authenticated users', async () => {
        const product = await productModel.create({
            name: 'Wishlist Tee',
            description: 'A product used to validate wishlist endpoints',
            price: 499,
            image: ['https://example.com/image6.jpg'],
            category: 'Men',
            subCategory: 'Topwear',
            sizes: ['L'],
            stock: 4,
            lowStockThreshold: 1,
            date: Date.now()
        });

        const registerResponse = await request(app)
            .post('/api/user/register')
            .send({ name: 'Wishlist User', email: 'wishlistuser@example.com', password: 'SecurePass123' });

        expect(registerResponse.status).toBe(201);
        const token = registerResponse.body.token;

        const initialWishlistResponse = await request(app)
            .get('/api/user/wishlist')
            .set('token', token);

        expect(initialWishlistResponse.status).toBe(200);
        expect(initialWishlistResponse.body.wishlist).toEqual([]);

        const addWishlistResponse = await request(app)
            .post('/api/user/wishlist/toggle')
            .set('token', token)
            .send({ itemId: String(product._id) });

        expect(addWishlistResponse.status).toBe(200);
        expect(addWishlistResponse.body.wishlist).toEqual([String(product._id)]);

        const persistedWishlistResponse = await request(app)
            .get('/api/user/wishlist')
            .set('token', token);

        expect(persistedWishlistResponse.status).toBe(200);
        expect(persistedWishlistResponse.body.wishlist).toEqual([String(product._id)]);

        const removeWishlistResponse = await request(app)
            .post('/api/user/wishlist/toggle')
            .set('token', token)
            .send({ itemId: String(product._id) });

        expect(removeWishlistResponse.status).toBe(200);
        expect(removeWishlistResponse.body.wishlist).toEqual([]);
    });
});
