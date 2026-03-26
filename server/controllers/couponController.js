import couponModel from '../models/couponModel.js';
import orderModel from '../models/orderModel.js';
import { calculateCheckoutPricing } from '../services/checkoutPricingService.js';

const parseDateInput = (value) => {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const validateCouponBusinessRules = ({ discountType, discountValue, startsAt, endsAt }) => {
    if (discountType === 'percentage' && discountValue > 100) {
        return 'Percentage coupons cannot exceed 100';
    }

    if (discountType !== 'free_shipping' && discountValue <= 0) {
        return 'Discount value must be greater than zero';
    }

    if (startsAt && endsAt && startsAt > endsAt) {
        return 'Coupon end date must be after the start date';
    }

    return null;
};

const buildCouponPayload = (body) => {
    const startsAt = parseDateInput(body.startsAt);
    const endsAt = parseDateInput(body.endsAt);
    const discountType = body.discountType;
    const discountValue = discountType === 'free_shipping' ? 0 : Number(body.discountValue || 0);

    return {
        code: String(body.code || '').trim().toUpperCase(),
        description: String(body.description || '').trim(),
        discountType,
        discountValue,
        minOrderAmount: Number(body.minOrderAmount || 0),
        maxDiscountAmount: body.maxDiscountAmount ?? null,
        usageLimit: body.usageLimit ?? null,
        perUserLimit: body.perUserLimit ?? 1,
        startsAt,
        endsAt,
        isActive: body.isActive ?? true
    };
};

const listAdminCoupons = async (req, res) => {
    try {
        const [coupons, couponOrders] = await Promise.all([
            couponModel.find({}).sort({ createdAt: -1 }).lean(),
            orderModel.find({ couponId: { $ne: '' }, paymentStatus: { $nin: ['failed', 'cancelled'] } }).lean()
        ]);

        const usageMap = couponOrders.reduce((map, order) => {
            const couponId = String(order.couponId || '');
            map.set(couponId, (map.get(couponId) || 0) + 1);
            return map;
        }, new Map());

        return res.status(200).json({
            success: true,
            coupons: coupons.map((coupon) => ({
                ...coupon,
                usageCount: usageMap.get(String(coupon._id)) || 0
            }))
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch coupons');
        return res.status(500).json({ success: false, message: 'Failed to fetch coupons' });
    }
};

const createCoupon = async (req, res) => {
    try {
        const payload = buildCouponPayload(req.body);
        const businessRuleError = validateCouponBusinessRules(payload);

        if (businessRuleError) {
            return res.status(400).json({ success: false, message: businessRuleError });
        }

        const existingCoupon = await couponModel.findOne({ code: payload.code }).lean();
        if (existingCoupon) {
            return res.status(409).json({ success: false, message: 'Coupon code already exists' });
        }

        const coupon = await couponModel.create(payload);

        return res.status(201).json({
            success: true,
            message: 'Coupon created successfully',
            coupon
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to create coupon');
        return res.status(500).json({ success: false, message: 'Failed to create coupon' });
    }
};

const updateCoupon = async (req, res) => {
    try {
        const { couponId } = req.body;
        const payload = buildCouponPayload(req.body);
        const businessRuleError = validateCouponBusinessRules(payload);

        if (businessRuleError) {
            return res.status(400).json({ success: false, message: businessRuleError });
        }

        const existingCoupon = await couponModel.findOne({
            code: payload.code,
            _id: { $ne: couponId }
        }).lean();

        if (existingCoupon) {
            return res.status(409).json({ success: false, message: 'Coupon code already exists' });
        }

        const updatedCoupon = await couponModel.findByIdAndUpdate(couponId, payload, {
            new: true,
            runValidators: true
        });

        if (!updatedCoupon) {
            return res.status(404).json({ success: false, message: 'Coupon not found' });
        }

        return res.status(200).json({
            success: true,
            message: 'Coupon updated successfully',
            coupon: updatedCoupon
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to update coupon');
        return res.status(500).json({ success: false, message: 'Failed to update coupon' });
    }
};

const updateCouponStatus = async (req, res) => {
    try {
        const { couponId, isActive } = req.body;
        const updatedCoupon = await couponModel.findByIdAndUpdate(
            couponId,
            { isActive },
            { new: true, runValidators: true }
        );

        if (!updatedCoupon) {
            return res.status(404).json({ success: false, message: 'Coupon not found' });
        }

        return res.status(200).json({
            success: true,
            message: `Coupon ${isActive ? 'activated' : 'paused'} successfully`,
            coupon: updatedCoupon
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to update coupon status');
        return res.status(500).json({ success: false, message: 'Failed to update coupon status' });
    }
};

const validateCoupon = async (req, res) => {
    try {
        const { couponCode, items } = req.body;
        const pricing = await calculateCheckoutPricing({
            userId: req.userId,
            items,
            couponCode,
            checkInventory: false
        });

        return res.status(200).json({
            success: true,
            pricing: {
                subtotal: pricing.subtotal,
                deliveryFee: pricing.deliveryFee,
                discountAmount: pricing.discountAmount,
                total: pricing.amount,
                appliedCoupon: pricing.appliedCoupon
            }
        });
    } catch (error) {
        req.log?.warn({ err: error }, 'Coupon validation failed');
        return res.status(400).json({
            success: false,
            message: error.message || 'Coupon validation failed'
        });
    }
};

export { createCoupon, listAdminCoupons, updateCoupon, updateCouponStatus, validateCoupon };
