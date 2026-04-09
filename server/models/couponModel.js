import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema(
    {
        code: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true,
            minlength: 3,
            maxlength: 30
        },
        description: { type: String, default: '', trim: true, maxlength: 200 },
        discountType: {
            type: String,
            required: true,
            enum: ['percentage', 'flat', 'free_shipping']
        },
        discountValue: { type: Number, default: 0, min: 0 },
        minOrderAmount: { type: Number, default: 0, min: 0 },
        maxDiscountAmount: { type: Number, default: null, min: 0 },
        usageLimit: { type: Number, default: null, min: 1 },
        perUserLimit: { type: Number, default: 1, min: 1 },
        isActive: { type: Boolean, default: true },
        startsAt: { type: Date, default: null },
        endsAt: { type: Date, default: null }
    },
    { timestamps: true, strict: true }
);

couponSchema.index({ isActive: 1, endsAt: 1 });
couponSchema.index({ startsAt: 1, endsAt: 1 });

const couponModel = mongoose.models.coupon || mongoose.model('coupon', couponSchema);

export default couponModel;
