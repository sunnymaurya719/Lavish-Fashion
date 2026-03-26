import mongoose from 'mongoose';

const objectIdStringRegex = /^[a-f\d]{24}$/i;

const orderItemSchema = new mongoose.Schema(
    {
        _id: {
            type: String,
            required: true,
            validate: {
                validator: (value) => objectIdStringRegex.test(String(value || '')),
                message: 'Invalid product id format in payment attempt item'
            }
        },
        name: { type: String, required: true, trim: true, minlength: 1, maxlength: 150 },
        price: { type: Number, required: true, min: 0 },
        image: { type: [String], default: [] },
        size: { type: String, default: '', trim: true, maxlength: 10 },
        quantity: { type: Number, required: true, min: 1, max: 99 }
    },
    { _id: false, strict: true }
);

const orderAddressSchema = new mongoose.Schema(
    {
        firstName: { type: String, required: true, trim: true, minlength: 1, maxlength: 50 },
        lastName: { type: String, required: true, trim: true, minlength: 1, maxlength: 50 },
        street: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
        city: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
        state: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
        pincode: { type: String, required: true, trim: true, minlength: 3, maxlength: 12 },
        country: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
        phone: { type: String, required: true, trim: true, minlength: 6, maxlength: 20 }
    },
    { _id: false, strict: true }
);

const paymentAttemptSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            validate: {
                validator: (value) => objectIdStringRegex.test(String(value || '')),
                message: 'Invalid user id format'
            }
        },
        items: {
            type: [orderItemSchema],
            required: true,
            validate: {
                validator: (value) => Array.isArray(value) && value.length > 0,
                message: 'Payment attempt must include at least one item'
            }
        },
        subtotal: { type: Number, default: 0, min: 0 },
        deliveryFee: { type: Number, default: 10, min: 0 },
        discountAmount: { type: Number, default: 0, min: 0 },
        couponDiscountAmount: { type: Number, default: 0, min: 0 },
        loyaltyDiscountAmount: { type: Number, default: 0, min: 0 },
        couponCode: { type: String, default: '', trim: true, uppercase: true, maxlength: 30 },
        couponId: {
            type: String,
            default: '',
            validate: {
                validator: (value) => !value || objectIdStringRegex.test(String(value || '')),
                message: 'Invalid coupon id format'
            }
        },
        amount: { type: Number, required: true, min: 0 },
        address: { type: orderAddressSchema, required: true },
        checkoutSource: { type: String, enum: ['cart', 'buy_now'], default: 'cart' },
        paymentMethod: { type: String, required: true, enum: ['Stripe', 'Razorpay'] },
        status: {
            type: String,
            enum: ['pending', 'paid', 'failed', 'cancelled', 'expired', 'order_created'],
            default: 'pending',
            index: true
        },
        inventoryReserved: { type: Boolean, default: true },
        loyaltyPointsRedeemed: { type: Number, default: 0, min: 0 },
        loyaltyRedemptionStatus: { type: String, enum: ['none', 'reserved', 'redeemed', 'released'], default: 'none' },
        stripeSessionId: { type: String, default: null, index: true },
        stripePaymentIntentId: { type: String, default: null },
        razorpayOrderId: { type: String, default: null, index: true },
        razorpayPaymentId: { type: String, default: null },
        gatewayEventId: { type: String, default: null },
        createdOrderId: {
            type: String,
            default: null,
            validate: {
                validator: (value) => !value || objectIdStringRegex.test(String(value || '')),
                message: 'Invalid created order id format'
            }
        },
        date: { type: Number, required: true },
        expiresAt: {
            type: Date,
            default: () => new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
    },
    { timestamps: true, strict: true }
);

paymentAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const paymentAttemptModel =
    mongoose.models.payment_attempt || mongoose.model('payment_attempt', paymentAttemptSchema);

export default paymentAttemptModel;
