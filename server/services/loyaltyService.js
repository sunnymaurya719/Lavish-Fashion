import loyaltyTransactionModel from '../models/loyaltyTransactionModel.js';
import orderModel from '../models/orderModel.js';
import userModel from '../models/userModel.js';
import { getUserMarketingPreferences } from './marketingAutomationService.js';

const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_ORDER_POINTS_DIVISOR = 100;
const DEFAULT_MIN_ORDER_REWARD_POINTS = 10;
const DEFAULT_REVIEW_REWARD_POINTS = 30;
const DEFAULT_REFERRER_REWARD_POINTS = 120;
const DEFAULT_NEW_CUSTOMER_REWARD_POINTS = 60;
const DEFAULT_LOYALTY_POINT_VALUE = 1;
const DEFAULT_MIN_REDEEM_POINTS = 50;
const DEFAULT_MAX_REDEEM_SHARE = 0.5;
const DEFAULT_MAX_REDEEM_POINTS_PER_ORDER = 500;
const DEFAULT_MAX_REDEEM_POINTS_PER_PRODUCT = 30;

const loyaltyTiers = [
    { name: 'Bronze', threshold: 0 },
    { name: 'Silver', threshold: 500 },
    { name: 'Gold', threshold: 1500 },
    { name: 'Platinum', threshold: 3000 }
];

const getNumericEnvValue = (value, fallback) => {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : fallback;
};

const getNonNegativeNumericEnvValue = (value, fallback) => {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : fallback;
};

const getNonNegativeIntEnvValue = (value, fallback) =>
    Math.max(0, Math.floor(getNonNegativeNumericEnvValue(value, fallback)));

const roundCurrency = (value) => Number(Number(value || 0).toFixed(2));

const getUserAvailableLoyaltyPoints = (user = {}) =>
    Math.max(0, Number(user.loyaltyPoints || 0) - Number(user.reservedLoyaltyPoints || 0));

const getLoyaltyRedemptionRules = () => ({
    pointValue: getNumericEnvValue(process.env.LOYALTY_POINT_VALUE, DEFAULT_LOYALTY_POINT_VALUE),
    minRedeemPoints: Math.max(0, Math.floor(getNumericEnvValue(process.env.LOYALTY_MIN_REDEEM_POINTS, DEFAULT_MIN_REDEEM_POINTS))),
    maxRedeemShare: Math.min(1, Math.max(0, getNumericEnvValue(process.env.LOYALTY_MAX_REDEEM_SHARE, DEFAULT_MAX_REDEEM_SHARE))),
    maxRedeemPointsPerOrder: Math.max(
        0,
        Math.floor(getNumericEnvValue(process.env.LOYALTY_MAX_REDEEM_POINTS_PER_ORDER, DEFAULT_MAX_REDEEM_POINTS_PER_ORDER))
    ),
    maxRedeemPointsPerProduct: Math.max(
        0,
        Math.floor(getNumericEnvValue(process.env.LOYALTY_MAX_REDEEM_POINTS_PER_PRODUCT, DEFAULT_MAX_REDEEM_POINTS_PER_PRODUCT))
    )
});

const calculateLoyaltyRedemption = ({ user, requestedPoints = 0, orderBaseAmount = 0, maxRedeemPointsCap = Number.POSITIVE_INFINITY }) => {
    const normalizedRequestedPoints = Math.max(0, Math.floor(Number(requestedPoints || 0)));
    const normalizedOrderBaseAmount = Math.max(0, Number(orderBaseAmount || 0));
    const normalizedMaxRedeemPointsCap = Number(maxRedeemPointsCap);
    const safeMaxRedeemPointsCap = Number.isFinite(normalizedMaxRedeemPointsCap)
        ? Math.max(0, Math.floor(normalizedMaxRedeemPointsCap))
        : Number.POSITIVE_INFINITY;
    const availablePoints = getUserAvailableLoyaltyPoints(user);
    const rules = getLoyaltyRedemptionRules();
    const minimumRedeemPointsRequired = Math.max(0, Math.floor(Number(rules.minRedeemPoints || 0)));

    if (normalizedRequestedPoints === 0 || normalizedOrderBaseAmount === 0) {
        return {
            pointsRedeemed: 0,
            discountAmount: 0,
            availablePoints,
            maxRedeemablePoints: 0,
            rules
        };
    }

    if (availablePoints <= 0) {
        throw new Error('You do not have enough available loyalty points to redeem');
    }

    const maxDiscountValue = Math.min(
        normalizedOrderBaseAmount,
        roundCurrency(normalizedOrderBaseAmount * (rules.maxRedeemShare || 1))
    );
    const maxRedeemablePoints = Math.max(
        0,
        Math.min(
            availablePoints,
            rules.maxRedeemPointsPerOrder || Number.POSITIVE_INFINITY,
            safeMaxRedeemPointsCap,
            Math.floor(maxDiscountValue / Math.max(rules.pointValue, 0.01))
        )
    );

    if (maxRedeemablePoints <= 0) {
        throw new Error('This order is not eligible for loyalty point redemption');
    }

    if (minimumRedeemPointsRequired > 0 && maxRedeemablePoints < minimumRedeemPointsRequired) {
        throw new Error(`A minimum of ${minimumRedeemPointsRequired} points is required for redemption`);
    }

    if (minimumRedeemPointsRequired > 0 && normalizedRequestedPoints < minimumRedeemPointsRequired) {
        throw new Error(`A minimum of ${minimumRedeemPointsRequired} points is required for redemption`);
    }

    if (normalizedRequestedPoints > maxRedeemablePoints) {
        throw new Error(`You can redeem up to ${maxRedeemablePoints} points on this order`);
    }

    return {
        pointsRedeemed: normalizedRequestedPoints,
        discountAmount: roundCurrency(normalizedRequestedPoints * rules.pointValue),
        availablePoints,
        maxRedeemablePoints,
        rules
    };
};

const determineLoyaltyTier = (points = 0) => {
    const normalizedPoints = Number(points || 0);
    let currentTier = loyaltyTiers[0];

    loyaltyTiers.forEach((tier) => {
        if (normalizedPoints >= tier.threshold) {
            currentTier = tier;
        }
    });

    const currentTierIndex = loyaltyTiers.findIndex((tier) => tier.name === currentTier.name);
    const nextTier = loyaltyTiers[currentTierIndex + 1] || null;

    return {
        currentTier: currentTier.name,
        nextTier: nextTier?.name || null,
        pointsToNextTier: nextTier ? Math.max(0, nextTier.threshold - normalizedPoints) : 0,
        nextTierThreshold: nextTier?.threshold || null
    };
};

const generateReferralCodeCandidate = (name = '') => {
    const prefix = String(name || '')
        .replace(/[^a-z0-9]/gi, '')
        .toUpperCase()
        .slice(0, 4)
        .padEnd(4, 'L');

    let suffix = '';

    for (let index = 0; index < 4; index += 1) {
        suffix += REFERRAL_CODE_ALPHABET[Math.floor(Math.random() * REFERRAL_CODE_ALPHABET.length)];
    }

    return `${prefix}${suffix}`;
};

const generateUniqueReferralCode = async (name = '') => {
    for (let attempt = 0; attempt < 16; attempt += 1) {
        const candidate = generateReferralCodeCandidate(name);
        const existingUser = await userModel.findOne({ referralCode: candidate }).select('_id').lean();

        if (!existingUser) {
            return candidate;
        }
    }

    throw new Error('Unable to generate a unique referral code');
};

const ensureUserReferralCode = async (user) => {
    if (!user) {
        return '';
    }

    if (user.referralCode) {
        return user.referralCode;
    }

    const referralCode = await generateUniqueReferralCode(user.name);
    await userModel.findByIdAndUpdate(String(user._id), { referralCode });
    return referralCode;
};

const awardLoyaltyPoints = async ({ userId, points, type, description, metadata = {} }) => {
    const normalizedPoints = Number(points || 0);

    if (!userId || normalizedPoints === 0) {
        return null;
    }

    const incUpdate = { loyaltyPoints: normalizedPoints };

    if (normalizedPoints > 0) {
        incUpdate.lifetimeLoyaltyPoints = normalizedPoints;
    }

    const user = await userModel.findOneAndUpdate(
        {
            _id: userId,
            ...(normalizedPoints < 0
                ? { loyaltyPoints: { $gte: Math.abs(normalizedPoints) } }
                : {})
        },
        { $inc: incUpdate },
        { new: true }
    );

    if (!user) {
        return null;
    }

    const nextBalance = Number(user.loyaltyPoints || 0);

    const transaction = await loyaltyTransactionModel.create({
        userId: String(user._id),
        type,
        points: normalizedPoints,
        balanceAfter: nextBalance,
        description,
        metadata
    });

    return {
        user,
        transaction
    };
};

const reserveLoyaltyRedemption = async ({ userId, points }) => {
    const normalizedPoints = Math.max(0, Math.floor(Number(points || 0)));

    if (!userId || normalizedPoints === 0) {
        return null;
    }

    const updatedUser = await userModel.findOneAndUpdate(
        {
            _id: userId,
            $expr: {
                $gte: [
                    { $subtract: ['$loyaltyPoints', '$reservedLoyaltyPoints'] },
                    normalizedPoints
                ]
            }
        },
        {
            $inc: { reservedLoyaltyPoints: normalizedPoints }
        },
        { new: true }
    );

    if (!updatedUser) {
        throw new Error('Unable to reserve loyalty points for this order');
    }

    return updatedUser;
};

const releaseUserReservedLoyaltyPoints = async ({ userId, points }) => {
    const normalizedPoints = Math.max(0, Math.floor(Number(points || 0)));

    if (!userId || normalizedPoints === 0) {
        return null;
    }

    const user = await userModel.findOneAndUpdate(
        { _id: userId, reservedLoyaltyPoints: { $gte: normalizedPoints } },
        { $inc: { reservedLoyaltyPoints: -normalizedPoints } },
        { new: true }
    );

    if (!user) {
        // Fallback: clamp to zero if reserved was already partially released
        const fallbackUser = await userModel.findOneAndUpdate(
            { _id: userId, reservedLoyaltyPoints: { $gt: 0 } },
            { $set: { reservedLoyaltyPoints: 0 } },
            { new: true }
        );
        return fallbackUser || null;
    }

    return user;
};

const finalizeReservedLoyaltyRedemption = async ({ order }) => {
    if (!order?.userId || Number(order?.loyaltyPointsRedeemed || 0) <= 0) {
        return null;
    }

    if (order.loyaltyRedemptionStatus === 'redeemed') {
        return null;
    }

    if (order.loyaltyRedemptionStatus !== 'reserved') {
        return null;
    }

    const redeemedPoints = Math.max(0, Math.floor(Number(order.loyaltyPointsRedeemed || 0)));

    const user = await userModel.findOneAndUpdate(
        {
            _id: order.userId,
            loyaltyPoints: { $gte: redeemedPoints },
            reservedLoyaltyPoints: { $gte: redeemedPoints }
        },
        {
            $inc: {
                loyaltyPoints: -redeemedPoints,
                reservedLoyaltyPoints: -redeemedPoints
            }
        },
        { new: true }
    );

    if (!user) {
        return null;
    }

    const nextBalance = Number(user.loyaltyPoints || 0);

    await loyaltyTransactionModel.create({
        userId: String(user._id),
        type: 'points_redeemed',
        points: redeemedPoints * -1,
        balanceAfter: nextBalance,
        description: `Redeemed ${redeemedPoints} points on order #${String(order._id).slice(-6).toUpperCase()}`,
        metadata: {
            orderId: String(order._id),
            discountAmount: Number(order.loyaltyDiscountAmount || 0)
        }
    });

    await orderModel.findByIdAndUpdate(order._id, {
        loyaltyRedemptionStatus: 'redeemed',
        loyaltyRedemptionAppliedAt: order.loyaltyRedemptionAppliedAt || Date.now()
    });

    return {
        user
    };
};

const releaseReservedLoyaltyRedemption = async ({ order }) => {
    if (!order?.userId || Number(order?.loyaltyPointsRedeemed || 0) <= 0) {
        return null;
    }

    if (order.loyaltyRedemptionStatus !== 'reserved') {
        return null;
    }

    const user = await releaseUserReservedLoyaltyPoints({
        userId: order.userId,
        points: order.loyaltyPointsRedeemed
    });

    if (!user) {
        return null;
    }

    await orderModel.findByIdAndUpdate(order._id, {
        loyaltyRedemptionStatus: 'released',
        loyaltyRedemptionReleasedAt: Date.now()
    });

    return {
        user
    };
};

const getUserLoyaltySummary = async (userId) => {
    const user = await userModel.findById(userId).lean();

    if (!user) {
        return null;
    }

    const referralCode = user.referralCode || (await ensureUserReferralCode(user));
    const [pendingReferralCount, recentTransactions] = await Promise.all([
        userModel.countDocuments({ referredBy: String(user._id), referralRewardUnlocked: false }),
        loyaltyTransactionModel.find({ userId: String(user._id) }).sort({ createdAt: -1 }).limit(12).lean()
    ]);

    return {
        loyaltyPoints: Number(user.loyaltyPoints || 0),
        reservedLoyaltyPoints: Number(user.reservedLoyaltyPoints || 0),
        availableLoyaltyPoints: getUserAvailableLoyaltyPoints(user),
        lifetimeLoyaltyPoints: Number(user.lifetimeLoyaltyPoints || 0),
        referralCode,
        successfulReferralCount: Number(user.successfulReferralCount || 0),
        pendingReferralCount,
        marketingPreferences: getUserMarketingPreferences(user),
        ...determineLoyaltyTier(user.lifetimeLoyaltyPoints || user.loyaltyPoints || 0),
        recentTransactions
    };
};

const claimReferralRewardUnlock = async ({ userId, referredBy }) => {
    if (!userId || !referredBy) {
        return false;
    }

    const claimedUser = await userModel.findOneAndUpdate(
        {
            _id: userId,
            referredBy: String(referredBy),
            referralRewardUnlocked: false
        },
        {
            $set: {
                referralRewardUnlocked: true
            }
        },
        {
            new: false
        }
    );

    return Boolean(claimedUser);
};

const awardOrderDeliveryRewards = async (order) => {
    if (!order?.userId || order.status !== 'Delivered') {
        return null;
    }

    const user = await userModel.findById(order.userId);
    if (!user) {
        return null;
    }

    const orderRewardResults = [];
    let awardedOrderPoints = Number(order.loyaltyPointsAwarded || 0);

    if (!order.loyaltyAwardedAt) {
        const pointsDivisor = getNumericEnvValue(process.env.LOYALTY_ORDER_POINTS_DIVISOR, DEFAULT_ORDER_POINTS_DIVISOR);
        const minOrderRewardPoints = Math.max(
            0,
            Math.floor(getNumericEnvValue(process.env.LOYALTY_MIN_ORDER_REWARD_POINTS, DEFAULT_MIN_ORDER_REWARD_POINTS))
        );
        const calculatedOrderPoints = Math.max(
            minOrderRewardPoints,
            Math.floor(Number(order.amount || 0) / Math.max(pointsDivisor, 1))
        );
        const rewardResult = await awardLoyaltyPoints({
            userId: order.userId,
            points: calculatedOrderPoints,
            type: 'order_delivered',
            description: `Reward earned for delivered order #${String(order._id).slice(-6).toUpperCase()}`,
            metadata: {
                orderId: String(order._id),
                amount: Number(order.amount || 0)
            }
        });

        awardedOrderPoints = calculatedOrderPoints;
        orderRewardResults.push(rewardResult);

    }

    const referralRewards = {
        referrerPoints: 0,
        newCustomerPoints: 0
    };

    const isSelfReferral = String(user._id) === String(user.referredBy || '');

    if (user.referredBy && !user.referralRewardUnlocked && !isSelfReferral) {
        // Claim referral unlock first so duplicate delivery updates cannot grant the same referral twice.
        const referralUnlockClaimed = await claimReferralRewardUnlock({
            userId: user._id,
            referredBy: user.referredBy
        });

        if (!referralUnlockClaimed) {
            await orderModel.findByIdAndUpdate(order._id, {
                deliveredAt: order.deliveredAt || Date.now(),
                loyaltyPointsAwarded: awardedOrderPoints,
                loyaltyAwardedAt: order.loyaltyAwardedAt || Date.now()
            });

            return {
                awardedOrderPoints,
                referralRewards,
                rewardResults: orderRewardResults.filter(Boolean)
            };
        }

        const referrerRewardPoints = getNonNegativeIntEnvValue(
            process.env.REFERRAL_REWARD_REFERRER,
            DEFAULT_REFERRER_REWARD_POINTS
        );
        const newCustomerRewardPoints = getNonNegativeIntEnvValue(
            process.env.REFERRAL_REWARD_NEW_USER,
            DEFAULT_NEW_CUSTOMER_REWARD_POINTS
        );

        const referrerReward = await awardLoyaltyPoints({
            userId: user.referredBy,
            points: referrerRewardPoints,
            type: 'referral_referrer',
            description: `${user.name} completed their first delivered order using your referral`,
            metadata: {
                referredUserId: String(user._id),
                orderId: String(order._id)
            }
        });

        const newCustomerReward = await awardLoyaltyPoints({
            userId: String(user._id),
            points: newCustomerRewardPoints,
            type: 'referral_new_customer',
            description: 'Referral reward unlocked after your first delivered order',
            metadata: {
                referrerUserId: user.referredBy,
                orderId: String(order._id)
            }
        });

        if (referrerReward) {
            referralRewards.referrerPoints = referrerRewardPoints;
            await userModel.findByIdAndUpdate(user.referredBy, { $inc: { successfulReferralCount: 1 } });
        }

        if (newCustomerReward) {
            referralRewards.newCustomerPoints = newCustomerRewardPoints;
        }

        orderRewardResults.push(referrerReward, newCustomerReward);
    }

    await orderModel.findByIdAndUpdate(order._id, {
        deliveredAt: order.deliveredAt || Date.now(),
        loyaltyPointsAwarded: awardedOrderPoints,
        loyaltyAwardedAt: order.loyaltyAwardedAt || Date.now()
    });

    return {
        awardedOrderPoints,
        referralRewards,
        rewardResults: orderRewardResults.filter(Boolean)
    };
};

const getReviewRewardPoints = () =>
    getNonNegativeIntEnvValue(process.env.REVIEW_REWARD_POINTS, DEFAULT_REVIEW_REWARD_POINTS);

const cleanupStaleReservations = async ({ staleCutoffMs = 24 * 60 * 60 * 1000 } = {}) => {
    const cutoffDate = Date.now() - staleCutoffMs;

    // Find orders that have been in 'reserved' state longer than the cutoff
    const staleOrders = await orderModel.find({
        loyaltyRedemptionStatus: 'reserved',
        loyaltyPointsRedeemed: { $gt: 0 },
        date: { $lt: cutoffDate },
        payment: false
    }).lean();

    const results = [];

    for (const order of staleOrders) {
        const released = await releaseReservedLoyaltyRedemption({ order });
        if (released) {
            results.push({ orderId: String(order._id), pointsReleased: order.loyaltyPointsRedeemed });
        }
    }

    return results;
};

export {
    awardLoyaltyPoints,
    awardOrderDeliveryRewards,
    calculateLoyaltyRedemption,
    cleanupStaleReservations,
    determineLoyaltyTier,
    ensureUserReferralCode,
    finalizeReservedLoyaltyRedemption,
    generateUniqueReferralCode,
    getLoyaltyRedemptionRules,
    getReviewRewardPoints,
    getUserAvailableLoyaltyPoints,
    getUserLoyaltySummary,
    releaseReservedLoyaltyRedemption,
    releaseUserReservedLoyaltyPoints,
    reserveLoyaltyRedemption
};
