import { afterEach, describe, expect, it, vi } from 'vitest';

const users = new Map();
const orders = new Map();
const transactions = [];

const toPlainUser = (user) => {
    if (!user) {
        return null;
    }

    return Object.fromEntries(Object.entries(user).filter(([key]) => key !== 'save'));
};

const buildUserDocument = (user) => {
    if (!user) {
        return null;
    }

    return {
        ...user,
        async save() {
            users.set(String(this._id), toPlainUser(this));
            return this;
        }
    };
};

const userModelMock = {
    findById: vi.fn(async (userId) => buildUserDocument(users.get(String(userId)) || null)),
    findByIdAndUpdate: vi.fn(async (userId, update = {}) => {
        const existingUser = users.get(String(userId));

        if (!existingUser) {
            return null;
        }

        const nextUser = { ...existingUser };

        if (update.$inc) {
            Object.entries(update.$inc).forEach(([key, value]) => {
                nextUser[key] = Number(nextUser[key] || 0) + Number(value || 0);
            });
        }

        Object.entries(update)
            .filter(([key]) => key !== '$inc')
            .forEach(([key, value]) => {
                nextUser[key] = value;
            });

        users.set(String(userId), nextUser);
        return buildUserDocument(nextUser);
    }),
    findOneAndUpdate: vi.fn(async (query = {}, update = {}) => {
        const userId = String(query._id || '');
        const existingUser = users.get(userId);

        if (!existingUser) {
            return null;
        }

        const referredByMatches =
            query.referredBy === undefined || String(existingUser.referredBy || '') === String(query.referredBy);
        const unlockMatches =
            query.referralRewardUnlocked === undefined ||
            Boolean(existingUser.referralRewardUnlocked) === Boolean(query.referralRewardUnlocked);

        if (!referredByMatches || !unlockMatches) {
            return null;
        }

        const nextUser = {
            ...existingUser,
            ...(update.$set || {})
        };

        users.set(userId, nextUser);
        return buildUserDocument(existingUser);
    }),
    findOne: vi.fn()
};

const orderModelMock = {
    findByIdAndUpdate: vi.fn(async (orderId, update = {}) => {
        const currentOrder = orders.get(String(orderId)) || { _id: String(orderId) };
        const nextOrder = { ...currentOrder, ...update };
        orders.set(String(orderId), nextOrder);
        return nextOrder;
    })
};

const loyaltyTransactionModelMock = {
    create: vi.fn(async (payload) => {
        const record = {
            ...payload,
            _id: `txn_${transactions.length + 1}`,
            createdAt: new Date().toISOString()
        };

        transactions.push(record);
        return record;
    }),
    find: vi.fn()
};

vi.mock('../models/userModel.js', () => ({
    default: userModelMock
}));

vi.mock('../models/orderModel.js', () => ({
    default: orderModelMock
}));

vi.mock('../models/loyaltyTransactionModel.js', () => ({
    default: loyaltyTransactionModelMock
}));

vi.mock('../services/marketingAutomationService.js', () => ({
    getUserMarketingPreferences: () => ({
        emailSubscribed: true,
        promotionalCampaigns: true,
        loyaltyUpdates: true,
        reviewReminders: true
    })
}));

const { awardOrderDeliveryRewards, calculateLoyaltyRedemption } = await import('../services/loyaltyService.js');

describe('loyaltyService referral rewards', () => {
    afterEach(() => {
        users.clear();
        orders.clear();
        transactions.length = 0;
        vi.clearAllMocks();
        delete process.env.REFERRAL_REWARD_REFERRER;
        delete process.env.REFERRAL_REWARD_NEW_USER;
        delete process.env.LOYALTY_ORDER_POINTS_DIVISOR;
        delete process.env.LOYALTY_MIN_ORDER_REWARD_POINTS;
    });

    it('awards referral rewards exactly once when unlock claim succeeds', async () => {
        users.set('507f1f77bcf86cd799439011', {
            _id: '507f1f77bcf86cd799439011',
            name: 'Referrer User',
            loyaltyPoints: 0,
            lifetimeLoyaltyPoints: 0,
            successfulReferralCount: 0
        });
        users.set('507f1f77bcf86cd799439012', {
            _id: '507f1f77bcf86cd799439012',
            name: 'Referred User',
            loyaltyPoints: 0,
            lifetimeLoyaltyPoints: 0,
            referredBy: '507f1f77bcf86cd799439011',
            referralRewardUnlocked: false
        });

        const result = await awardOrderDeliveryRewards({
            _id: '507f1f77bcf86cd799439021',
            userId: '507f1f77bcf86cd799439012',
            status: 'Delivered',
            amount: 400
        });

        const updatedReferrer = users.get('507f1f77bcf86cd799439011');
        const updatedReferredUser = users.get('507f1f77bcf86cd799439012');

        expect(result.referralRewards.referrerPoints).toBe(120);
        expect(result.referralRewards.newCustomerPoints).toBe(60);
        expect(updatedReferrer.loyaltyPoints).toBe(120);
        expect(updatedReferrer.successfulReferralCount).toBe(1);
        expect(updatedReferredUser.loyaltyPoints).toBe(70);
        expect(updatedReferredUser.referralRewardUnlocked).toBe(true);
        expect(transactions.map((transaction) => transaction.type)).toEqual(
            expect.arrayContaining(['order_delivered', 'referral_referrer', 'referral_new_customer'])
        );
    });

    it('skips referral payouts when unlock claim fails', async () => {
        users.set('507f1f77bcf86cd799439011', {
            _id: '507f1f77bcf86cd799439011',
            name: 'Referrer User',
            loyaltyPoints: 0,
            lifetimeLoyaltyPoints: 0,
            successfulReferralCount: 0
        });
        users.set('507f1f77bcf86cd799439012', {
            _id: '507f1f77bcf86cd799439012',
            name: 'Referred User',
            loyaltyPoints: 0,
            lifetimeLoyaltyPoints: 0,
            referredBy: '507f1f77bcf86cd799439011',
            referralRewardUnlocked: false
        });

        userModelMock.findOneAndUpdate.mockResolvedValueOnce(null);

        const result = await awardOrderDeliveryRewards({
            _id: '507f1f77bcf86cd799439021',
            userId: '507f1f77bcf86cd799439012',
            status: 'Delivered',
            amount: 400
        });

        const updatedReferrer = users.get('507f1f77bcf86cd799439011');
        const updatedReferredUser = users.get('507f1f77bcf86cd799439012');

        expect(result.referralRewards.referrerPoints).toBe(0);
        expect(result.referralRewards.newCustomerPoints).toBe(0);
        expect(updatedReferrer.loyaltyPoints).toBe(0);
        expect(updatedReferrer.successfulReferralCount).toBe(0);
        expect(updatedReferredUser.loyaltyPoints).toBe(10);
        expect(updatedReferredUser.referralRewardUnlocked).toBe(false);
        expect(transactions.map((transaction) => transaction.type)).toEqual(['order_delivered']);
    });

    it('uses configurable minimum order reward points', async () => {
        process.env.LOYALTY_ORDER_POINTS_DIVISOR = '100';
        process.env.LOYALTY_MIN_ORDER_REWARD_POINTS = '3';

        users.set('507f1f77bcf86cd799439099', {
            _id: '507f1f77bcf86cd799439099',
            name: 'No Referral User',
            loyaltyPoints: 0,
            lifetimeLoyaltyPoints: 0,
            referredBy: '',
            referralRewardUnlocked: false
        });

        const result = await awardOrderDeliveryRewards({
            _id: '507f1f77bcf86cd799439077',
            userId: '507f1f77bcf86cd799439099',
            status: 'Delivered',
            amount: 250
        });

        const updatedUser = users.get('507f1f77bcf86cd799439099');

        expect(result.awardedOrderPoints).toBe(3);
        expect(updatedUser.loyaltyPoints).toBe(3);
        expect(transactions.map((transaction) => transaction.type)).toEqual(['order_delivered']);
    });
});

describe('loyaltyService redemption rules', () => {
    afterEach(() => {
        delete process.env.LOYALTY_MIN_REDEEM_POINTS;
        delete process.env.LOYALTY_MAX_REDEEM_SHARE;
        delete process.env.LOYALTY_MAX_REDEEM_POINTS_PER_ORDER;
        delete process.env.LOYALTY_POINT_VALUE;
    });

    it('rejects redemption when available points are below minimum threshold', () => {
        process.env.LOYALTY_MIN_REDEEM_POINTS = '30';
        process.env.LOYALTY_MAX_REDEEM_SHARE = '0.5';
        process.env.LOYALTY_MAX_REDEEM_POINTS_PER_ORDER = '500';
        process.env.LOYALTY_POINT_VALUE = '1';

        expect(() =>
            calculateLoyaltyRedemption({
                user: { loyaltyPoints: 26, reservedLoyaltyPoints: 0 },
                requestedPoints: 26,
                orderBaseAmount: 500,
                maxRedeemPointsCap: 30
            })
        ).toThrow('A minimum of 30 points is required for redemption');
    });

    it('allows redemption at configured minimum threshold', () => {
        process.env.LOYALTY_MIN_REDEEM_POINTS = '30';
        process.env.LOYALTY_MAX_REDEEM_SHARE = '0.5';
        process.env.LOYALTY_MAX_REDEEM_POINTS_PER_ORDER = '500';
        process.env.LOYALTY_POINT_VALUE = '1';

        const redemption = calculateLoyaltyRedemption({
            user: { loyaltyPoints: 60, reservedLoyaltyPoints: 0 },
            requestedPoints: 30,
            orderBaseAmount: 500,
            maxRedeemPointsCap: 30
        });

        expect(redemption.pointsRedeemed).toBe(30);
        expect(redemption.discountAmount).toBe(30);
        expect(redemption.maxRedeemablePoints).toBe(30);
    });
});
