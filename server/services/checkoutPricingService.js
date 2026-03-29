import couponModel from '../models/couponModel.js';
import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
import { backfillMissingProductInventory } from './productInventoryService.js';
import {
    calculateLoyaltyRedemption,
    getLoyaltyRedemptionRules,
    getUserAvailableLoyaltyPoints
} from './loyaltyService.js';
import userModel from '../models/userModel.js';

const DEFAULT_DELIVERY_CHARGE = 10;

const createCheckoutError = (message) => {
    const error = new Error(message);
    error.isCheckoutError = true;
    return error;
};

const isCheckoutError = (error) => Boolean(error?.isCheckoutError);

const normalizeCouponCode = (value) => String(value || '').trim().toUpperCase();
const roundCurrency = (value) => Number(Number(value || 0).toFixed(2));
const normalizeOptionalFitAssistant = (fitAssistant) => {
    if (!fitAssistant || typeof fitAssistant !== 'object' || Array.isArray(fitAssistant)) {
        return undefined;
    }

    const recommendedSize = String(fitAssistant.recommendedSize || '').trim();

    if (!recommendedSize) {
        return undefined;
    }

    const confidenceValue = Number(fitAssistant.confidence);
    const normalizedConfidence =
        Number.isFinite(confidenceValue) && confidenceValue >= 0 && confidenceValue <= 1
            ? Number(confidenceValue.toFixed(4))
            : null;
    const normalizedSource = ['manual', 'camera', 'hybrid'].includes(String(fitAssistant.source || '').trim())
        ? String(fitAssistant.source).trim()
        : 'manual';
    const normalizedModelVersion = String(fitAssistant.modelVersion || '').trim();

    return {
        recommendedSize,
        confidence: normalizedConfidence,
        source: normalizedSource,
        modelVersion: normalizedModelVersion
    };
};

const buildNormalizedOrderItems = async (items, { checkInventory = true } = {}) => {
    if (!Array.isArray(items) || items.length === 0) {
        throw createCheckoutError('No order items provided');
    }

    await backfillMissingProductInventory();

    const productIds = [...new Set(items.map((item) => String(item._id || item.productId || '')).filter(Boolean))];
    const products = await productModel.find({ _id: { $in: productIds } }).lean();
    const productMap = new Map(products.map((product) => [String(product._id), product]));

    const normalizedItems = [];
    let subtotal = 0;

    for (const rawItem of items) {
        const productId = String(rawItem._id || rawItem.productId || '');
        const quantity = Number(rawItem.quantity);

        if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
            throw createCheckoutError('Invalid order item payload');
        }

        const product = productMap.get(productId);
        if (!product) {
            throw createCheckoutError('One or more products are unavailable');
        }

        if (product.status === 'archived') {
            throw createCheckoutError(`${product.name} is no longer available`);
        }

        if (checkInventory && Number(product.stock || 0) < quantity) {
            throw createCheckoutError(`Only ${product.stock || 0} units left for ${product.name}`);
        }

        const productPrice = Number(product.price);
        subtotal += productPrice * quantity;

        const fitAssistant = normalizeOptionalFitAssistant(rawItem.fitAssistant);

        normalizedItems.push({
            _id: String(product._id),
            name: product.name,
            price: productPrice,
            image: product.image,
            size: rawItem.size || '',
            quantity,
            ...(fitAssistant ? { fitAssistant } : {})
        });
    }

    return {
        normalizedItems,
        subtotal: roundCurrency(subtotal)
    };
};

const resolveCouponForCheckout = async ({ userId, couponCode, subtotal, deliveryCharge = DEFAULT_DELIVERY_CHARGE }) => {
    const normalizedCouponCode = normalizeCouponCode(couponCode);

    if (!normalizedCouponCode) {
        return {
            coupon: null,
            couponDiscountAmount: 0,
            deliveryFee: deliveryCharge
        };
    }

    const coupon = await couponModel.findOne({ code: normalizedCouponCode }).lean();
    if (!coupon || !coupon.isActive) {
        throw createCheckoutError('Coupon code is invalid or inactive');
    }

    const now = new Date();

    if (coupon.startsAt && now < new Date(coupon.startsAt)) {
        throw createCheckoutError('This coupon is not active yet');
    }

    if (coupon.endsAt && now > new Date(coupon.endsAt)) {
        throw createCheckoutError('This coupon has expired');
    }

    if (subtotal < Number(coupon.minOrderAmount || 0)) {
        throw createCheckoutError(`Minimum order amount for this coupon is ${coupon.minOrderAmount}`);
    }

    const couponId = String(coupon._id);
    const orderFilter = {
        couponId,
        paymentStatus: { $nin: ['failed', 'cancelled'] }
    };

    if (coupon.usageLimit) {
        const totalUsageCount = await orderModel.countDocuments(orderFilter);

        if (totalUsageCount >= Number(coupon.usageLimit)) {
            throw createCheckoutError('Coupon usage limit has been reached');
        }
    }

    if (userId && coupon.perUserLimit) {
        const userUsageCount = await orderModel.countDocuments({
            ...orderFilter,
            userId
        });

        if (userUsageCount >= Number(coupon.perUserLimit)) {
            throw createCheckoutError('You have already used this coupon the maximum number of times');
        }
    }

    let deliveryFee = Number(deliveryCharge);
    let couponDiscountAmount = 0;

    if (coupon.discountType === 'percentage') {
        couponDiscountAmount = subtotal * (Number(coupon.discountValue || 0) / 100);
    }

    if (coupon.discountType === 'flat') {
        couponDiscountAmount = Number(coupon.discountValue || 0);
    }

    if (coupon.discountType === 'free_shipping') {
        deliveryFee = 0;
    }

    if (coupon.maxDiscountAmount !== null && coupon.maxDiscountAmount !== undefined) {
        couponDiscountAmount = Math.min(couponDiscountAmount, Number(coupon.maxDiscountAmount));
    }

    couponDiscountAmount = roundCurrency(Math.min(couponDiscountAmount, subtotal));

    return {
        coupon,
        couponDiscountAmount,
        deliveryFee
    };
};

const resolveLoyaltyRedemptionForCheckout = async ({
    userId,
    pointsToRedeem = 0,
    redeemableBaseAmount = 0,
    totalProductUnits = 0
}) => {
    const normalizedPointsToRedeem = Math.max(0, Math.floor(Number(pointsToRedeem || 0)));
    const normalizedTotalProductUnits = Math.max(0, Math.floor(Number(totalProductUnits || 0)));
    const loyaltyRules = getLoyaltyRedemptionRules();
    const productUnitRedemptionCap = Number.isFinite(Number(loyaltyRules.maxRedeemPointsPerProduct))
        ? Math.max(
            0,
            normalizedTotalProductUnits * Math.max(0, Math.floor(Number(loyaltyRules.maxRedeemPointsPerProduct || 0)))
        )
        : Number.POSITIVE_INFINITY;

    if (!userId) {
        return {
            availableLoyaltyPoints: 0,
            loyaltyPointsRedeemed: 0,
            loyaltyDiscountAmount: 0,
            loyaltyRules
        };
    }

    const user = await userModel.findById(userId).lean();

    if (!user) {
        throw createCheckoutError('User account not found for loyalty redemption');
    }

    const availableLoyaltyPoints = getUserAvailableLoyaltyPoints(user);

    if (normalizedPointsToRedeem === 0 || Number(redeemableBaseAmount || 0) <= 0) {
        return {
            availableLoyaltyPoints,
            loyaltyPointsRedeemed: 0,
            loyaltyDiscountAmount: 0,
            loyaltyRules
        };
    }

    try {
        const redemption = calculateLoyaltyRedemption({
            user,
            requestedPoints: normalizedPointsToRedeem,
            orderBaseAmount: redeemableBaseAmount,
            maxRedeemPointsCap: productUnitRedemptionCap
        });

        return {
            availableLoyaltyPoints,
            loyaltyPointsRedeemed: redemption.pointsRedeemed,
            loyaltyDiscountAmount: redemption.discountAmount,
            loyaltyRules: redemption.rules
        };
    } catch (error) {
        throw createCheckoutError(error.message || 'Unable to redeem loyalty points');
    }
};

const calculateCheckoutPricing = async ({
    userId,
    items,
    couponCode = '',
    pointsToRedeem = 0,
    deliveryCharge = DEFAULT_DELIVERY_CHARGE,
    checkInventory = true
}) => {
    const { normalizedItems, subtotal } = await buildNormalizedOrderItems(items, { checkInventory });
    const totalProductUnits = normalizedItems.reduce(
        (sum, item) => sum + Math.max(0, Math.floor(Number(item.quantity || 0))),
        0
    );
    const { coupon, couponDiscountAmount, deliveryFee } = await resolveCouponForCheckout({
        userId,
        couponCode,
        subtotal,
        deliveryCharge
    });
    const redeemableBaseAmount = roundCurrency(Math.max(0, subtotal + deliveryFee - couponDiscountAmount));
    const {
        availableLoyaltyPoints,
        loyaltyPointsRedeemed,
        loyaltyDiscountAmount,
        loyaltyRules
    } = await resolveLoyaltyRedemptionForCheckout({
        userId,
        pointsToRedeem,
        redeemableBaseAmount,
        totalProductUnits
    });
    const discountAmount = roundCurrency(couponDiscountAmount + loyaltyDiscountAmount);

    const amount = roundCurrency(Math.max(0, subtotal + deliveryFee - discountAmount));

    return {
        normalizedItems,
        subtotal,
        deliveryFee,
        couponDiscountAmount,
        loyaltyDiscountAmount,
        discountAmount,
        amount,
        loyaltyPointsRedeemed,
        availableLoyaltyPoints,
        loyaltyRules,
        appliedCoupon: coupon
            ? {
                couponId: String(coupon._id),
                code: coupon.code,
                description: coupon.description,
                discountType: coupon.discountType,
                discountValue: coupon.discountValue
            }
            : null
    };
};

export {
    DEFAULT_DELIVERY_CHARGE,
    calculateCheckoutPricing,
    createCheckoutError,
    isCheckoutError,
    normalizeCouponCode
};
