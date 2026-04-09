import mongoose from 'mongoose';

const objectIdStringRegex = /^[a-f\d]{24}$/i;

const loyaltyTransactionSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            validate: {
                validator: (value) => objectIdStringRegex.test(String(value || '')),
                message: 'Invalid user id format'
            }
        },
        type: {
            type: String,
            required: true,
            enum: [
                'order_delivered',
                'referral_referrer',
                'referral_new_customer',
                'review_published',
                'points_redeemed',
                'manual_adjustment'
            ]
        },
        points: { type: Number, required: true },
        balanceAfter: { type: Number, required: true },
        description: { type: String, required: true, trim: true, minlength: 3, maxlength: 180 },
        metadata: { type: Object, default: {} }
    },
    { timestamps: true, minimize: false, strict: true }
);

loyaltyTransactionSchema.index({ userId: 1, createdAt: -1 });
loyaltyTransactionSchema.index({ type: 1, createdAt: -1 });
loyaltyTransactionSchema.index({ createdAt: -1 });

const loyaltyTransactionModel =
    mongoose.models.loyalty_transaction || mongoose.model('loyalty_transaction', loyaltyTransactionSchema);

export default loyaltyTransactionModel;
