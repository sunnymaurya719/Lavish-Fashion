import crypto from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_whsec_test';
process.env.RAZORPAY_KEY_SECRET = 'rzp_key_secret_test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';

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
    bulkWrite: vi.fn(),
    countDocuments: vi.fn(),
    create: vi.fn(),
    find: vi.fn(),
    findById: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    findByIdAndUpdate: vi.fn()
};

const paymentAttemptModelMock = {
    create: vi.fn(),
    findById: vi.fn(),
    findOne: vi.fn(),
    findByIdAndUpdate: vi.fn()
};

const userModelMock = {
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn()
};

const productModelMock = {
    find: vi.fn()
};

const beginIdempotentRequestMock = vi.fn();
const completeIdempotentRequestMock = vi.fn();
const backfillMissingProductInventoryMock = vi.fn();
const releaseInventoryForItemsMock = vi.fn();
const reserveInventoryForItemsMock = vi.fn();
const awardOrderDeliveryRewardsMock = vi.fn();
const calculateLoyaltyRedemptionMock = vi.fn(({ user, requestedPoints, orderBaseAmount, maxRedeemPointsCap = Number.POSITIVE_INFINITY }) => {
    const availablePoints = Math.max(0, Number(user?.loyaltyPoints || 0) - Number(user?.reservedLoyaltyPoints || 0));
    const rules = {
        pointValue: 1,
        minRedeemPoints: 50,
        maxRedeemShare: 0.5,
        maxRedeemPointsPerOrder: 500,
        maxRedeemPointsPerProduct: 30
    };
    const normalizedMaxRedeemPointsCap = Number(maxRedeemPointsCap);
    const safeMaxRedeemPointsCap = Number.isFinite(normalizedMaxRedeemPointsCap)
        ? Math.max(0, Math.floor(normalizedMaxRedeemPointsCap))
        : Number.POSITIVE_INFINITY;
    const maxRedeemablePoints = Math.max(
        0,
        Math.min(
            availablePoints,
            rules.maxRedeemPointsPerOrder,
            safeMaxRedeemPointsCap,
            Math.floor(Number(orderBaseAmount || 0) * rules.maxRedeemShare)
        )
    );

    const effectiveMinRedeemPoints = Math.min(rules.minRedeemPoints, maxRedeemablePoints);

    if (requestedPoints < effectiveMinRedeemPoints) {
        throw new Error(`A minimum of ${effectiveMinRedeemPoints} points is required for redemption`);
    }

    if (requestedPoints > maxRedeemablePoints) {
        throw new Error(`You can redeem up to ${maxRedeemablePoints} points on this order`);
    }

    return {
        pointsRedeemed: requestedPoints,
        discountAmount: requestedPoints,
        rules
    };
});
const finalizeReservedLoyaltyRedemptionMock = vi.fn();
const getLoyaltyRedemptionRulesMock = vi.fn(() => ({
    pointValue: 1,
    minRedeemPoints: 50,
    maxRedeemShare: 0.5,
    maxRedeemPointsPerOrder: 500,
    maxRedeemPointsPerProduct: 30
}));
const getUserAvailableLoyaltyPointsMock = vi.fn((user = {}) =>
    Math.max(0, Number(user.loyaltyPoints || 0) - Number(user.reservedLoyaltyPoints || 0))
);
const releaseReservedLoyaltyRedemptionMock = vi.fn();
const releaseUserReservedLoyaltyPointsMock = vi.fn();
const reserveLoyaltyRedemptionMock = vi.fn();
const queueAutomationEmailMock = vi.fn();
const sendDeliveredMessageMock = vi.fn();
const sendOrderPlacedMessageMock = vi.fn();
const sendOutForDeliveryMessageMock = vi.fn();
const cancelShiprocketBulkLiveVerificationJobMock = vi.fn();
const getShiprocketBulkVerifyJobStatusMock = vi.fn();
const startShiprocketBulkLiveVerificationJobMock = vi.fn();

vi.mock('../models/orderModel.js', () => ({
    default: orderModelMock
}));

vi.mock('../models/paymentAttemptModel.js', () => ({
    default: paymentAttemptModelMock
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

vi.mock('../services/productInventoryService.js', () => ({
    backfillMissingProductInventory: backfillMissingProductInventoryMock,
    releaseInventoryForItems: releaseInventoryForItemsMock,
    reserveInventoryForItems: reserveInventoryForItemsMock
}));

vi.mock('../services/loyaltyService.js', () => ({
    awardOrderDeliveryRewards: awardOrderDeliveryRewardsMock,
    calculateLoyaltyRedemption: calculateLoyaltyRedemptionMock,
    finalizeReservedLoyaltyRedemption: finalizeReservedLoyaltyRedemptionMock,
    getLoyaltyRedemptionRules: getLoyaltyRedemptionRulesMock,
    getUserAvailableLoyaltyPoints: getUserAvailableLoyaltyPointsMock,
    releaseReservedLoyaltyRedemption: releaseReservedLoyaltyRedemptionMock,
    releaseUserReservedLoyaltyPoints: releaseUserReservedLoyaltyPointsMock,
    reserveLoyaltyRedemption: reserveLoyaltyRedemptionMock
}));

vi.mock('../services/marketingAutomationService.js', () => ({
    queueAutomationEmail: queueAutomationEmailMock
}));

vi.mock('../services/whatsappService.js', () => ({
    sendDeliveredMessage: sendDeliveredMessageMock,
    sendOrderPlacedMessage: sendOrderPlacedMessageMock,
    sendOutForDeliveryMessage: sendOutForDeliveryMessageMock
}));

vi.mock('../services/shiprocketBulkLiveVerificationService.js', () => ({
    cancelShiprocketBulkLiveVerificationJob: cancelShiprocketBulkLiveVerificationJobMock,
    getShiprocketBulkVerifyJobStatus: getShiprocketBulkVerifyJobStatusMock,
    startShiprocketBulkLiveVerificationJob: startShiprocketBulkLiveVerificationJobMock
}));

const {
    allOrders,
    backfillShiprocketPricingSnapshots,
    cancelShiprocketBulkLiveVerification,
    cancelUserOrder,
    getShiprocketBulkLiveVerificationJob,
    placeOrderStripe,
    placeOrderRazorpay,
    startShiprocketBulkLiveVerification,
    verifyStripe,
    verifyRazorpay,
    handleStripeWebhook,
    handleRazorpayWebhook,
    placeOrderCOD,
    updateOrderStatus
} = await import('../controllers/orderController.js');
const { previewCheckoutPricing } = await import('../controllers/orderController.js');

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

    it('places a COD order and clears the cart for cart checkout', async () => {
        beginIdempotentRequestMock.mockResolvedValueOnce({
            action: 'proceed',
            recordId: 'idem_record_1'
        });

        productModelMock.find.mockReturnValueOnce({
            lean: vi.fn().mockResolvedValueOnce([
                {
                    _id: '507f1f77bcf86cd799439011',
                    name: 'Test Tee',
                    price: 299,
                    image: ['https://example.com/product.jpg'],
                    stock: 10,
                    status: 'active'
                }
            ])
        });
        userModelMock.findById
            .mockReturnValueOnce({
                lean: vi.fn().mockResolvedValueOnce({
                    _id: 'user_1',
                    loyaltyPoints: 0,
                    reservedLoyaltyPoints: 0
                })
            })
            .mockReturnValueOnce({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValueOnce({
                        email: 'cod-user@example.com'
                    })
                })
            });

        orderModelMock.create.mockResolvedValueOnce({
            _id: '507f1f77bcf86cd799439012',
            userId: 'user_1',
            checkoutSource: 'cart'
        });

        const req = {
            headers: { 'idempotency-key': 'idem_cod_1' },
            userId: 'user_1',
            body: {
                items: [
                    {
                        _id: '507f1f77bcf86cd799439011',
                        quantity: 1,
                        size: 'M',
                        fitAssistant: {
                            recommendedSize: 'M',
                            confidence: 0.92,
                            source: 'manual',
                            modelVersion: 'rule-engine-v1'
                        }
                    }
                ],
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
                checkoutSource: 'cart'
            },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await placeOrderCOD(req, res);

        expect(orderModelMock.create).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'user_1',
                items: expect.arrayContaining([
                    expect.objectContaining({
                        _id: '507f1f77bcf86cd799439011',
                        fitAssistant: expect.objectContaining({
                            recommendedSize: 'M',
                            confidence: 0.92,
                            source: 'manual',
                            modelVersion: 'rule-engine-v1'
                        })
                    })
                ]),
                inventoryReserved: true,
                paymentMethod: 'COD',
                payment: false,
                paymentStatus: 'pending',
                checkoutSource: 'cart'
            })
        );
        expect(reserveInventoryForItemsMock).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({
                    _id: '507f1f77bcf86cd799439011',
                    quantity: 1
                })
            ])
        );
        expect(userModelMock.findByIdAndUpdate).toHaveBeenCalledWith('user_1', { cartData: {} });
        expect(sendOrderPlacedMessageMock).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: '507f1f77bcf86cd799439012'
            }),
            expect.objectContaining({
                log: expect.any(Object)
            })
        );
        expect(completeIdempotentRequestMock).toHaveBeenCalledWith(
            expect.objectContaining({ recordId: 'idem_record_1', statusCode: 201 })
        );
        expect(res.status).toHaveBeenCalledWith(201);
    });

    it('previews loyalty redemption pricing for authenticated checkout', async () => {
        productModelMock.find.mockReturnValueOnce({
            lean: vi.fn().mockResolvedValueOnce([
                {
                    _id: '507f1f77bcf86cd799439011',
                    name: 'Preview Tee',
                    price: 299,
                    image: ['https://example.com/product.jpg'],
                    stock: 10,
                    status: 'active'
                }
            ])
        });
        userModelMock.findById.mockReturnValueOnce({
            lean: vi.fn().mockResolvedValueOnce({
                _id: 'user_1',
                loyaltyPoints: 180,
                reservedLoyaltyPoints: 20
            })
        });

        const req = {
            userId: 'user_1',
            body: {
                items: [{ _id: '507f1f77bcf86cd799439011', quantity: 1, size: 'M' }],
                pointsToRedeem: 30
            },
            log: { warn: vi.fn() }
        };
        const res = createRes();

        await previewCheckoutPricing(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                pricing: expect.objectContaining({
                    subtotal: 299,
                    deliveryFee: 10,
                    loyaltyDiscountAmount: 30,
                    loyaltyPointsRedeemed: 30,
                    total: 279,
                    availableLoyaltyPoints: 160
                })
            })
        );
    });

    it('allows redeeming 60 points when checkout has quantity two', async () => {
        productModelMock.find.mockReturnValueOnce({
            lean: vi.fn().mockResolvedValueOnce([
                {
                    _id: '507f1f77bcf86cd799439011',
                    name: 'Preview Tee',
                    price: 299,
                    image: ['https://example.com/product.jpg'],
                    stock: 10,
                    status: 'active'
                }
            ])
        });
        userModelMock.findById.mockReturnValueOnce({
            lean: vi.fn().mockResolvedValueOnce({
                _id: 'user_1',
                loyaltyPoints: 200,
                reservedLoyaltyPoints: 20
            })
        });

        const req = {
            userId: 'user_1',
            body: {
                items: [{ _id: '507f1f77bcf86cd799439011', quantity: 2, size: 'M' }],
                pointsToRedeem: 60
            },
            log: { warn: vi.fn() }
        };
        const res = createRes();

        await previewCheckoutPricing(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                pricing: expect.objectContaining({
                    subtotal: 598,
                    deliveryFee: 10,
                    loyaltyDiscountAmount: 60,
                    loyaltyPointsRedeemed: 60,
                    total: 548,
                    availableLoyaltyPoints: 180
                })
            })
        );
    });

    it('includes Shiprocket pricing audit details in the admin order list response', async () => {
        orderModelMock.find.mockReturnValueOnce({
            sort: vi.fn().mockResolvedValueOnce([
                {
                    _id: '507f1f77bcf86cd799439011',
                    userId: '507f1f77bcf86cd799439012',
                    items: [
                        {
                            _id: '507f1f77bcf86cd799439013',
                            name: 'Audit Tee',
                            price: 300,
                            quantity: 1
                        }
                    ],
                    subtotal: 300,
                    deliveryFee: 10,
                    discountAmount: 0,
                    amount: 310,
                    paymentMethod: 'COD',
                    payment: false,
                    status: 'Order Placed',
                    address: {
                        firstName: 'Sunny',
                        lastName: 'Maurya'
                    },
                    shiprocket: {
                        referenceOrderId: 'LFTEST123456',
                        syncStatus: 'synced',
                        shipmentId: 9388670
                    },
                    date: Date.now()
                }
            ])
        });

        const req = {
            log: { error: vi.fn() }
        };
        const res = createRes();

        await allOrders(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                orders: [
                    expect.objectContaining({
                        shiprocketPricingAudit: expect.objectContaining({
                            status: 'warning',
                            issueCodes: expect.arrayContaining(['missing_shiprocket_pricing_snapshot'])
                        })
                    })
                ]
            })
        );
    });

    it('backfills missing Shiprocket pricing snapshots for synced orders', async () => {
        orderModelMock.countDocuments.mockResolvedValueOnce(2);
        orderModelMock.find.mockReturnValueOnce({
            sort: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValueOnce([
                        {
                            _id: '507f1f77bcf86cd799439021',
                            items: [{ _id: '507f1f77bcf86cd799439031', price: 300, quantity: 1 }],
                            subtotal: 300,
                            deliveryFee: 10,
                            discountAmount: 0,
                            amount: 310,
                            shiprocket: {
                                syncStatus: 'synced',
                                referenceOrderId: 'LFTESTA'
                            }
                        },
                        {
                            _id: '507f1f77bcf86cd799439022',
                            items: [{ _id: '507f1f77bcf86cd799439032', price: 500, quantity: 1 }],
                            subtotal: 500,
                            deliveryFee: 10,
                            discountAmount: 200,
                            amount: 310,
                            shiprocket: {
                                syncStatus: 'synced',
                                referenceOrderId: 'LFTESTB'
                            }
                        }
                    ])
                })
            })
        });
        orderModelMock.bulkWrite.mockResolvedValueOnce({ modifiedCount: 2 });

        const req = {
            body: { limit: 25 },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await backfillShiprocketPricingSnapshots(req, res);

        expect(orderModelMock.countDocuments).toHaveBeenCalledWith(
            expect.objectContaining({
                'shiprocket.syncStatus': 'synced'
            })
        );
        expect(orderModelMock.bulkWrite).toHaveBeenCalledTimes(1);
        expect(orderModelMock.bulkWrite.mock.calls[0][0]).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    updateOne: expect.objectContaining({
                        update: expect.objectContaining({
                            $set: expect.objectContaining({
                                'shiprocket.pricingSnapshot': expect.objectContaining({
                                    source: 'shiprocket_backfill_v2',
                                    subTotal: 300,
                                    shippingCharges: 10,
                                    derivedFinalAmount: 310
                                })
                            })
                        })
                    })
                })
            ])
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                updatedCount: 2
            })
        );
    });

    it('starts the Shiprocket bulk live verification job', async () => {
        startShiprocketBulkLiveVerificationJobMock.mockResolvedValueOnce({
            success: true,
            started: true,
            skipped: false,
            config: {
                scope: 'high_risk',
                limit: 25,
                requestsPerMinute: 45
            },
            targetCount: 12,
            job: {
                status: 'running',
                progress: {
                    totalCount: 12,
                    processedCount: 0
                }
            }
        });

        const req = {
            admin: { email: 'admin@example.com' },
            body: { limit: 25, requestsPerMinute: 45, scope: 'high_risk' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await startShiprocketBulkLiveVerification(req, res);

        expect(startShiprocketBulkLiveVerificationJobMock).toHaveBeenCalledWith(
            expect.objectContaining({
                config: expect.objectContaining({
                    limit: 25,
                    requestsPerMinute: 45,
                    scope: 'high_risk'
                }),
                requestedBy: 'admin@example.com',
                trigger: 'admin_api'
            })
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                started: true,
                targetCount: 12
            })
        );
    });

    it('returns the current Shiprocket bulk live verification job status', async () => {
        getShiprocketBulkVerifyJobStatusMock.mockResolvedValueOnce({
            jobKey: 'shiprocket_live_pricing_bulk_verify_job',
            status: 'running',
            progress: {
                totalCount: 20,
                processedCount: 8,
                percentComplete: 40
            }
        });

        const req = {
            log: { error: vi.fn() }
        };
        const res = createRes();

        await getShiprocketBulkLiveVerificationJob(req, res);

        expect(getShiprocketBulkVerifyJobStatusMock).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                job: expect.objectContaining({
                    status: 'running'
                })
            })
        );
    });

    it('requests cancellation for the active Shiprocket bulk live verification job', async () => {
        cancelShiprocketBulkLiveVerificationJobMock.mockResolvedValueOnce({
            success: true,
            cancelled: true,
            reason: 'cancel_requested',
            job: {
                status: 'running',
                isCancelling: true,
                cancelRequestedAt: new Date().toISOString()
            }
        });

        const req = {
            admin: { email: 'admin@example.com' },
            body: { reason: 'manual_cancel' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await cancelShiprocketBulkLiveVerification(req, res);

        expect(cancelShiprocketBulkLiveVerificationJobMock).toHaveBeenCalledWith({
            requestedBy: 'admin@example.com',
            reason: 'manual_cancel'
        });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                cancelled: true,
                reason: 'cancel_requested'
            })
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

    it('cancels an order for the owning user within the six-hour window', async () => {
        const createdAt = new Date(Date.now() - 60 * 60 * 1000);

        orderModelMock.findById
            .mockResolvedValueOnce({
                _id: '507f1f77bcf86cd799439011',
                userId: 'user_1',
                status: 'Order Placed',
                payment: true,
                paymentStatus: 'paid',
                inventoryReserved: true,
                createdAt,
                loyaltyPointsRedeemed: 50,
                loyaltyRedemptionStatus: 'reserved',
                items: [{ _id: '507f1f77bcf86cd799439099', quantity: 1 }]
            })
            .mockResolvedValueOnce({
                _id: '507f1f77bcf86cd799439011',
                userId: 'user_1',
                status: 'Cancelled',
                payment: true,
                paymentStatus: 'cancelled',
                inventoryReserved: false,
                cancelledAt: Date.now()
            });
        orderModelMock.findOneAndUpdate.mockResolvedValueOnce({
            _id: '507f1f77bcf86cd799439011',
            status: 'Cancelled'
        });

        const req = {
            userId: 'user_1',
            params: { orderId: '507f1f77bcf86cd799439011' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await cancelUserOrder(req, res);

        expect(orderModelMock.findOneAndUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: '507f1f77bcf86cd799439011',
                status: { $ne: 'Cancelled' }
            }),
            expect.objectContaining({
                status: 'Cancelled',
                paymentStatus: 'cancelled',
                cancelledAt: expect.any(Number)
            }),
            { new: true }
        );
        expect(releaseReservedLoyaltyRedemptionMock).toHaveBeenCalledWith(
            expect.objectContaining({
                order: expect.objectContaining({
                    _id: '507f1f77bcf86cd799439011'
                })
            })
        );
        expect(releaseInventoryForItemsMock).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({
                    _id: '507f1f77bcf86cd799439099'
                })
            ])
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                message: 'Order cancelled successfully',
                order: expect.objectContaining({
                    status: 'Cancelled',
                    paymentStatus: 'cancelled'
                })
            })
        );
    });

    it('rejects user cancellation requests after the six-hour window', async () => {
        orderModelMock.findById.mockResolvedValueOnce({
            _id: '507f1f77bcf86cd799439011',
            userId: 'user_1',
            status: 'Order Placed',
            createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000)
        });

        const req = {
            userId: 'user_1',
            params: { orderId: '507f1f77bcf86cd799439011' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await cancelUserOrder(req, res);

        expect(orderModelMock.findOneAndUpdate).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: 'Order can only be cancelled within 6 hours of placing it.'
        });
    });

    it('does not release inventory twice when cancellation loses a concurrent race', async () => {
        orderModelMock.findById
            .mockResolvedValueOnce({
                _id: '507f1f77bcf86cd799439011',
                userId: 'user_1',
                status: 'Order Placed',
                payment: true,
                paymentStatus: 'paid',
                inventoryReserved: true,
                createdAt: new Date(Date.now() - 30 * 60 * 1000),
                loyaltyPointsRedeemed: 50,
                loyaltyRedemptionStatus: 'reserved',
                items: [{ _id: '507f1f77bcf86cd799439099', quantity: 1 }]
            })
            .mockResolvedValueOnce({
                _id: '507f1f77bcf86cd799439011',
                userId: 'user_1',
                status: 'Cancelled',
                paymentStatus: 'cancelled',
                inventoryReserved: false
            });
        orderModelMock.findOneAndUpdate.mockResolvedValueOnce(null);

        const req = {
            userId: 'user_1',
            params: { orderId: '507f1f77bcf86cd799439011' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await cancelUserOrder(req, res);

        expect(releaseReservedLoyaltyRedemptionMock).not.toHaveBeenCalled();
        expect(releaseInventoryForItemsMock).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                order: expect.objectContaining({
                    status: 'Cancelled'
                })
            })
        );
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

        paymentAttemptModelMock.findOne.mockResolvedValueOnce(null);
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
        paymentAttemptModelMock.findById.mockResolvedValueOnce(null);

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
                inventoryReserved: true,
                stripeSessionId: 'cs_test_1',
                stripePaymentIntentId: 'pi_1'
            }),
            { new: true }
        );
        expect(finalizeReservedLoyaltyRedemptionMock).toHaveBeenCalledWith(
            expect.objectContaining({
                order: expect.objectContaining({
                    _id: '507f1f77bcf86cd799439011'
                })
            })
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

        paymentAttemptModelMock.findOne.mockResolvedValueOnce(null);
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
        expect(releaseReservedLoyaltyRedemptionMock).toHaveBeenCalledWith(
            expect.objectContaining({
                order: expect.objectContaining({
                    _id: 'order_local_1'
                })
            })
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ received: true });
    });

    it('sends an out-for-delivery WhatsApp notification when admin updates that status', async () => {
        orderModelMock.findById.mockResolvedValueOnce({
            _id: '507f1f77bcf86cd799439011',
            userId: 'user_1',
            status: 'Shipped',
            paymentMethod: 'COD',
            payment: false
        });
        orderModelMock.findByIdAndUpdate.mockResolvedValueOnce({
            _id: '507f1f77bcf86cd799439011',
            userId: 'user_1',
            status: 'Out for delivery',
            paymentMethod: 'COD',
            payment: false
        });

        const req = {
            body: {
                orderId: '507f1f77bcf86cd799439011',
                status: 'Out for delivery'
            },
            log: { error: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })) }
        };
        const res = createRes();

        await updateOrderStatus(req, res);

        expect(sendOutForDeliveryMessageMock).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: '507f1f77bcf86cd799439011',
                status: 'Out for delivery'
            }),
            expect.objectContaining({
                log: req.log
            })
        );
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('updates a COD order to delivered and triggers loyalty automations', async () => {
        orderModelMock.findById.mockReset();
        orderModelMock.findOneAndUpdate.mockReset();
        orderModelMock.findByIdAndUpdate.mockReset();
        userModelMock.findById.mockReset();

        orderModelMock.findById
            .mockResolvedValueOnce({
                _id: '507f1f77bcf86cd799439011',
                userId: 'user_1',
                status: 'Shipped',
                paymentMethod: 'COD',
                payment: false,
                deliveredAt: null
            })
            .mockReturnValueOnce({
                lean: vi.fn().mockResolvedValueOnce({
                    _id: '507f1f77bcf86cd799439011',
                    reviewReminderQueuedAt: null
                })
            });
        orderModelMock.findOneAndUpdate.mockResolvedValueOnce({
            _id: '507f1f77bcf86cd799439011',
            userId: 'user_1',
            status: 'Delivered',
            paymentMethod: 'COD',
            payment: true
        });
        orderModelMock.findByIdAndUpdate
            .mockResolvedValueOnce({
                _id: '507f1f77bcf86cd799439011',
                reviewReminderQueuedAt: Date.now()
            });
        userModelMock.findById.mockReturnValueOnce({
            lean: vi.fn().mockResolvedValueOnce({
                _id: 'user_1',
                name: 'Customer One',
                loyaltyPoints: 120,
                referredBy: ''
            })
        });
        awardOrderDeliveryRewardsMock.mockResolvedValueOnce({
            awardedOrderPoints: 20,
            referralRewards: {
                referrerPoints: 0,
                newCustomerPoints: 0
            }
        });

        const req = {
            body: {
                orderId: '507f1f77bcf86cd799439011',
                status: 'Delivered'
            },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await updateOrderStatus(req, res);

        expect(orderModelMock.findOneAndUpdate).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                _id: '507f1f77bcf86cd799439011',
                status: { $ne: 'Delivered' }
            }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'Delivered',
                    payment: true,
                    paymentStatus: 'paid',
                    paymentVerifiedAt: expect.any(Number),
                    deliveredAt: expect.any(Number)
                })
            }),
            { new: true }
        );
        expect(finalizeReservedLoyaltyRedemptionMock).toHaveBeenCalledWith(
            expect.objectContaining({
                order: expect.objectContaining({
                    _id: '507f1f77bcf86cd799439011',
                    status: 'Delivered'
                })
            })
        );
        expect(awardOrderDeliveryRewardsMock).toHaveBeenCalled();
        expect(queueAutomationEmailMock).toHaveBeenCalledTimes(2);
        expect(queueAutomationEmailMock).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                automationKey: 'order_delivered'
            })
        );
        expect(queueAutomationEmailMock).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                automationKey: 'review_request'
            })
        );
        expect(sendDeliveredMessageMock).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: '507f1f77bcf86cd799439011',
                status: 'Delivered'
            }),
            expect.objectContaining({
                log: req.log
            })
        );
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('rejects admin attempts to cancel delivered orders', async () => {
        orderModelMock.findById.mockResolvedValueOnce({
            _id: '507f1f77bcf86cd799439011',
            userId: 'user_1',
            status: 'Delivered',
            paymentMethod: 'COD',
            payment: true
        });

        const req = {
            body: {
                orderId: '507f1f77bcf86cd799439011',
                status: 'Cancelled'
            },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await updateOrderStatus(req, res);

        expect(orderModelMock.findOneAndUpdate).not.toHaveBeenCalled();
        expect(orderModelMock.findByIdAndUpdate).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: 'Delivered orders cannot be moved back into the fulfillment pipeline.'
        });
    });

    it('rejects admin attempts to reopen cancelled orders', async () => {
        orderModelMock.findById.mockResolvedValueOnce({
            _id: '507f1f77bcf86cd799439011',
            userId: 'user_1',
            status: 'Cancelled',
            paymentMethod: 'COD',
            payment: false
        });

        const req = {
            body: {
                orderId: '507f1f77bcf86cd799439011',
                status: 'Shipped'
            },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await updateOrderStatus(req, res);

        expect(orderModelMock.findOneAndUpdate).not.toHaveBeenCalled();
        expect(orderModelMock.findByIdAndUpdate).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: 'Cancelled orders cannot be moved back into the fulfillment pipeline.'
        });
    });
});
