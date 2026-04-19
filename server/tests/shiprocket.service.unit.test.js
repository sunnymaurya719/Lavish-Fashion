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

    it('derives Shiprocket sub_total from the final payable amount for discounted orders', () => {
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

        expect(payload.sub_total).toBe(300);
        expect(payload.shipping_charges).toBe(10);
        expect(payload.total_discount).toBe(200);
        expect(payload.sub_total + payload.shipping_charges).toBe(310);
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
