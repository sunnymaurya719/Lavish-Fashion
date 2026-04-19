import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    buildShiprocketLivePricingVerification,
    buildShiprocketPricingAudit,
    isShiprocketThrottleError,
    mapLocalOrderToShiprocketPayload,
    normalizeShiprocketError
} from '../services/shiprocketService.js';

const originalShiprocketEnv = {
    SHIPROCKET_ENABLED: process.env.SHIPROCKET_ENABLED,
    SHIPROCKET_PICKUP_LOCATION: process.env.SHIPROCKET_PICKUP_LOCATION
};

const createOrder = (overrides = {}) => ({
    _id: '507f1f77bcf86cd799439011',
    amount: 310,
    subtotal: 300,
    deliveryFee: 10,
    discountAmount: 0,
    paymentMethod: 'COD',
    createdAt: new Date('2026-04-19T02:45:00.000Z'),
    shiprocket: {
        referenceOrderId: 'LFTEST123456'
    },
    address: {
        firstName: 'Sunny',
        lastName: 'Maurya',
        street: 'New Subhash Nagar',
        city: 'Dehradun',
        state: 'Uttarakhand',
        pincode: '248001',
        country: 'India',
        phone: '9876543210'
    },
    customerEmail: 'sunny@example.com',
    items: [
        {
            _id: '507f1f77bcf86cd799439022',
            name: 'Men Tapered Fit Flat-Front Trousers',
            sku: 'LF-23E6F474-XL',
            quantity: 1,
            price: 300
        }
    ],
    ...overrides
});

describe('shiprocketService pricing payload mapping', () => {
    beforeEach(() => {
        process.env.SHIPROCKET_ENABLED = 'true';
        process.env.SHIPROCKET_PICKUP_LOCATION = 'Primary Warehouse';
    });

    afterEach(() => {
        if (originalShiprocketEnv.SHIPROCKET_ENABLED === undefined) {
            delete process.env.SHIPROCKET_ENABLED;
        } else {
            process.env.SHIPROCKET_ENABLED = originalShiprocketEnv.SHIPROCKET_ENABLED;
        }

        if (originalShiprocketEnv.SHIPROCKET_PICKUP_LOCATION === undefined) {
            delete process.env.SHIPROCKET_PICKUP_LOCATION;
        } else {
            process.env.SHIPROCKET_PICKUP_LOCATION = originalShiprocketEnv.SHIPROCKET_PICKUP_LOCATION;
        }
    });

    it('keeps delivery charges separate from the Shiprocket sub_total', () => {
        const payload = mapLocalOrderToShiprocketPayload(createOrder());

        expect(payload.sub_total).toBe(300);
        expect(payload.shipping_charges).toBe(10);
        expect(payload.total_discount).toBe(0);
        expect(payload.sub_total + payload.shipping_charges).toBe(310);
    });

    it('derives Shiprocket sub_total from the items sub-total before discount so the invoice NET TOTAL matches the customer-paid amount', () => {
        const payload = mapLocalOrderToShiprocketPayload(
            createOrder({
                amount: 310,
                subtotal: 500,
                discountAmount: 200,
                items: [
                    {
                        _id: '507f1f77bcf86cd799439033',
                        name: 'Women Round Neck Co-ord Set',
                        sku: 'LF-383EB5DF-XL',
                        quantity: 1,
                        price: 500
                    }
                ]
            })
        );

        // Shiprocket invoices use NET TOTAL = sub_total - total_discount + shipping_charges.
        // Sending sub_total=500, total_discount=200, shipping_charges=10 → NET TOTAL = 310,
        // which is exactly what the customer paid.
        expect(payload.sub_total).toBe(500);
        expect(payload.shipping_charges).toBe(10);
        expect(payload.total_discount).toBe(200);
        expect(payload.sub_total - payload.total_discount + payload.shipping_charges).toBe(310);
    });

    it('flags synced legacy orders that do not have a persisted Shiprocket pricing snapshot', () => {
        const audit = buildShiprocketPricingAudit(
            createOrder({
                shiprocket: {
                    referenceOrderId: 'LFTEST123456',
                    syncStatus: 'synced',
                    shipmentId: 9388670
                }
            })
        );

        expect(audit.status).toBe('warning');
        expect(audit.hasWarning).toBe(true);
        expect(audit.issueCodes).toContain('missing_shiprocket_pricing_snapshot');
    });

    it('infers synced status from remote Shiprocket identifiers when syncStatus is missing', () => {
        const audit = buildShiprocketPricingAudit(
            createOrder({
                shiprocket: {
                    referenceOrderId: 'LFTEST123456',
                    shipmentId: 9388670,
                    syncStatus: ''
                }
            })
        );

        expect(audit.syncStatus).toBe('synced');
        expect(audit.remoteOrderTracked).toBe(true);
        expect(audit.referenceAssigned).toBe(true);
    });

    it('flags mismatches when the stored Shiprocket pricing snapshot differs from the current expected payload', () => {
        const audit = buildShiprocketPricingAudit(
            createOrder({
                shiprocket: {
                    referenceOrderId: 'LFTEST123456',
                    syncStatus: 'synced',
                    shipmentId: 9388670,
                    pricingSnapshot: {
                        formulaVersion: 1,
                        source: 'legacy_payload',
                        capturedAt: Date.now(),
                        itemsSubtotal: 300,
                        localSubtotal: 300,
                        totalDiscount: 0,
                        shippingCharges: 10,
                        subTotal: 310,
                        localAmount: 310,
                        derivedFinalAmount: 320
                    }
                }
            })
        );

        expect(audit.status).toBe('mismatch');
        expect(audit.hasMismatch).toBe(true);
        expect(audit.issueCodes).toContain('shiprocket_snapshot_mismatch');
        expect(audit.storedShiprocketSnapshot.derivedFinalAmountDelta).toBe(10);
    });

    it('detects a live Shiprocket pricing mismatch from get-order details', () => {
        const verification = buildShiprocketLivePricingVerification(createOrder(), {
            raw: {
                data: {
                    id: 259492257,
                    total: 320,
                    net_total: '320.00',
                    discount: 0,
                    other_discounts: '0.00',
                    giftwrap_charges: '0.00',
                    products: [
                        {
                            id: 365076966,
                            selling_price: 310,
                            quantity: 1,
                            net_total: 310
                        }
                    ],
                    others: {
                        shipping_charges: '10'
                    }
                }
            }
        });

        expect(verification.status).toBe('mismatch');
        expect(verification.issueCodes).toContain('shiprocket_live_mismatch');
        expect(verification.liveShiprocketSnapshot.subTotal).toBe(310);
        expect(verification.liveShiprocketSnapshot.derivedFinalAmount).toBe(320);
        expect(verification.liveShiprocketSnapshot.derivedFinalAmountDelta).toBe(10);
    });

    it('does not flag a phantom mismatch when Shiprocket echoes the items sub_total in the `total` field', () => {
        const verification = buildShiprocketLivePricingVerification(
            createOrder({
                amount: 1210,
                subtotal: 1200,
                deliveryFee: 10,
                discountAmount: 0,
                items: [
                    { _id: 'a', name: 'Item A', sku: 'A', quantity: 3, price: 250 },
                    { _id: 'b', name: 'Item B', sku: 'B', quantity: 1, price: 200 },
                    { _id: 'c', name: 'Item C', sku: 'C', quantity: 1, price: 250 }
                ]
            }),
            {
                raw: {
                    // Shape mirroring a real Shiprocket /orders/show response where
                    // `total` echoes the items sub_total (no `net_total` field) and
                    // `shipping_charges` lives under `others`.
                    data: {
                        id: 259492258,
                        total: 1200,
                        sub_total: 1200,
                        discount: 0,
                        giftwrap_charges: '0.00',
                        products: [
                            { id: 1, selling_price: 250, quantity: 3 },
                            { id: 2, selling_price: 200, quantity: 1 },
                            { id: 3, selling_price: 250, quantity: 1 }
                        ],
                        others: {
                            shipping_charges: '10'
                        }
                    }
                }
            }
        );

        expect(verification.status).toBe('clear');
        expect(verification.hasMismatch).toBe(false);
        expect(verification.liveShiprocketSnapshot.subTotal).toBe(1200);
        expect(verification.liveShiprocketSnapshot.derivedFinalAmount).toBe(1210);
        expect(verification.liveShiprocketSnapshot.derivedFinalAmountDelta).toBe(0);
    });

    it('rebuilds the live grand total from components when Shiprocket reports net_total equal to sub_total', () => {
        // Reproduces the COD/INVOICED order shown in admin screenshots:
        // expected payload ₹200 + ₹10 shipping = ₹210, Shiprocket panel and
        // tax invoice both show ₹210, but `/orders/show` returns
        // `net_total: 200, sub_total: 200, others.shipping_charges: 10`.
        const verification = buildShiprocketLivePricingVerification(
            createOrder({
                amount: 210,
                subtotal: 200,
                deliveryFee: 10,
                discountAmount: 0,
                items: [
                    {
                        _id: 'cotton-tshirt',
                        name: 'Men Round Neck Pure Cotton T-shirt',
                        sku: 'LF-23E6F46E-XXL',
                        quantity: 1,
                        price: 200
                    }
                ]
            }),
            {
                raw: {
                    data: {
                        id: 259492259,
                        sub_total: 200,
                        net_total: '200.00',
                        total: '200.00',
                        discount: 0,
                        giftwrap_charges: '0.00',
                        products: [
                            {
                                id: 365076970,
                                selling_price: 200,
                                quantity: 1
                            }
                        ],
                        others: {
                            shipping_charges: '10'
                        }
                    }
                }
            }
        );

        expect(verification.status).toBe('clear');
        expect(verification.hasMismatch).toBe(false);
        expect(verification.liveShiprocketSnapshot.subTotal).toBe(200);
        expect(verification.liveShiprocketSnapshot.shippingCharges).toBe(10);
        expect(verification.liveShiprocketSnapshot.derivedFinalAmount).toBe(210);
        expect(verification.liveShiprocketSnapshot.derivedFinalAmountDelta).toBe(0);
    });

    it('falls back to the locally-known discount when Shiprocket /orders/show omits every discount field', () => {
        // Reproduces the discounted COD order shown in admin screenshots:
        // expected payload sub_total ₹200, shipping ₹10, discount ₹20 →
        // customer pays ₹190 and the printed Shiprocket invoice shows the
        // same. But /orders/show returns no `total_discount`, `discount`,
        // or `other_discounts` field at all, which previously made the live
        // check derive ₹210 and surface a phantom mismatch.
        const verification = buildShiprocketLivePricingVerification(
            createOrder({
                amount: 190,
                subtotal: 200,
                deliveryFee: 10,
                discountAmount: 20,
                items: [
                    {
                        _id: 'cotton-top',
                        name: 'Women Round Neck Cotton Top',
                        sku: 'LF-383EB5DF-XL',
                        quantity: 1,
                        price: 200
                    }
                ]
            }),
            {
                raw: {
                    data: {
                        id: 259492260,
                        sub_total: 200,
                        net_total: '200.00',
                        total: '200.00',
                        giftwrap_charges: '0.00',
                        products: [
                            {
                                id: 365076971,
                                selling_price: 200,
                                quantity: 1
                            }
                        ],
                        others: {
                            shipping_charges: '10'
                        }
                    }
                }
            }
        );

        expect(verification.status).toBe('clear');
        expect(verification.hasMismatch).toBe(false);
        expect(verification.liveShiprocketSnapshot.totalDiscount).toBe(20);
        expect(verification.liveShiprocketSnapshot.derivedFinalAmount).toBe(190);
        expect(verification.liveShiprocketSnapshot.derivedFinalAmountDelta).toBe(0);
    });

    it('falls back to the locally-known discount when Shiprocket /orders/show echoes a literal discount: 0 for a discounted order', () => {
        // Reproduces the LFMO5VOW5F0D7A admin screenshot: expected payload
        // sub_total ₹300, shipping ₹10, discount ₹20 → customer total ₹290.
        // Stored snapshot matches expected (₹290). But /orders/show returns
        // a literal `discount: 0` instead of omitting the field, so the
        // previous fallback (which only fired when the field was missing)
        // was bypassed and the live check derived ₹310 → phantom mismatch.
        const verification = buildShiprocketLivePricingVerification(
            createOrder({
                amount: 290,
                subtotal: 300,
                deliveryFee: 10,
                discountAmount: 20,
                items: [
                    {
                        _id: 'tapered-jeans',
                        name: 'Men Tapered Fit Flat-Front Jeans',
                        sku: 'LF-23E6F474-XL',
                        quantity: 1,
                        price: 300
                    }
                ]
            }),
            {
                raw: {
                    data: {
                        id: 259492261,
                        sub_total: 300,
                        net_total: '300.00',
                        total: '300.00',
                        discount: 0,
                        giftwrap_charges: '0.00',
                        products: [
                            {
                                id: 365076972,
                                selling_price: 300,
                                quantity: 1
                            }
                        ],
                        others: {
                            shipping_charges: '10'
                        }
                    }
                }
            }
        );

        expect(verification.status).toBe('clear');
        expect(verification.hasMismatch).toBe(false);
        expect(verification.liveShiprocketSnapshot.totalDiscount).toBe(20);
        expect(verification.liveShiprocketSnapshot.derivedFinalAmount).toBe(290);
        expect(verification.liveShiprocketSnapshot.derivedFinalAmountDelta).toBe(0);
    });

    it('ignores a cached shiprocketOrder.pricingSnapshot with discount: 0 when raw payload + local discount allow the fallback to fire', () => {
        // Guards against the regression where `normalizeShiprocketOrderResponse`
        // pre-computes `pricingSnapshot` WITHOUT the fallbackTotalDiscount
        // option. If `buildShiprocketLivePricingVerification` trusts that
        // cached snapshot via `||`, the fallback-equipped extractor below it
        // is short-circuited and a phantom ₹310 mismatch surfaces for the
        // LFMO5VOW5F0D7A order even after the fallback logic was added.
        const verification = buildShiprocketLivePricingVerification(
            createOrder({
                amount: 290,
                subtotal: 300,
                deliveryFee: 10,
                discountAmount: 20,
                items: [
                    {
                        _id: 'tapered-jeans',
                        name: 'Men Tapered Fit Flat-Front Jeans',
                        sku: 'LF-23E6F474-XL',
                        quantity: 1,
                        price: 300
                    }
                ]
            }),
            {
                // Simulate what `normalizeShiprocketOrderResponse` hands us:
                // both a cached pricingSnapshot (with totalDiscount: 0) AND
                // the raw Shiprocket payload. The fix must re-extract from
                // `raw` with the fallback instead of trusting the cache.
                pricingSnapshot: {
                    formulaVersion: 2,
                    source: 'shiprocket_live_order_details',
                    capturedAt: null,
                    itemsSubtotal: 300,
                    localSubtotal: 300,
                    totalDiscount: 0,
                    shippingCharges: 10,
                    subTotal: 300,
                    localAmount: 310,
                    derivedFinalAmount: 310
                },
                raw: {
                    data: {
                        id: 259492262,
                        sub_total: 300,
                        net_total: '300.00',
                        total: '300.00',
                        discount: 0,
                        giftwrap_charges: '0.00',
                        products: [
                            {
                                id: 365076973,
                                selling_price: 300,
                                quantity: 1
                            }
                        ],
                        others: {
                            shipping_charges: '10'
                        }
                    }
                }
            }
        );

        expect(verification.status).toBe('clear');
        expect(verification.hasMismatch).toBe(false);
        expect(verification.liveShiprocketSnapshot.totalDiscount).toBe(20);
        expect(verification.liveShiprocketSnapshot.derivedFinalAmount).toBe(290);
        expect(verification.liveShiprocketSnapshot.derivedFinalAmountDelta).toBe(0);
    });

    it('marks normalized 429 responses as Shiprocket throttle errors with retry timing', () => {
        const normalizedError = normalizeShiprocketError({
            response: {
                status: 429,
                data: {
                    message: 'Too many requests'
                },
                headers: {
                    'retry-after': '2'
                }
            }
        });

        expect(normalizedError.upstreamStatusCode).toBe(429);
        expect(normalizedError.retryAfterMs).toBe(2000);
        expect(isShiprocketThrottleError(normalizedError)).toBe(true);
    });
});
