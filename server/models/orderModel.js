import mongoose from 'mongoose';

const objectIdStringRegex = /^[a-f\d]{24}$/i;

const orderItemSchema = new mongoose.Schema(
    {
        _id: {
            type: String,
            required: true,
            validate: {
                validator: (value) => objectIdStringRegex.test(String(value || '')),
                message: 'Invalid product id format in order item'
            }
        },
        name: { type: String, required: true, trim: true, minlength: 1, maxlength: 150 },
        sku: { type: String, default: '', trim: true, maxlength: 40 },
        hsn: { type: String, default: '', trim: true, maxlength: 30 },
        tax: { type: String, default: '', trim: true, maxlength: 30 },
        price: { type: Number, required: true, min: 0 },
        image: { type: [String], default: [] },
        size: { type: String, default: '', trim: true, maxlength: 10 },
        quantity: { type: Number, required: true, min: 1, max: 99 },
        fitAssistant: {
            recommendedSize: { type: String, trim: true, maxlength: 10, default: '' },
            confidence: { type: Number, min: 0, max: 1, default: null },
            source: { type: String, enum: ['manual', 'camera', 'hybrid'], default: 'manual' },
            modelVersion: { type: String, trim: true, maxlength: 60, default: '' }
        }
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

const buildWhatsappNotificationEventFields = (prefix) => ({
    [`${prefix}Sent`]: { type: Boolean, default: false },
    [`${prefix}Sending`]: { type: Boolean, default: false },
    [`${prefix}LockExpiresAt`]: { type: Number, default: null },
    [`${prefix}LastAttemptAt`]: { type: Number, default: null },
    [`${prefix}SentAt`]: { type: Number, default: null },
    [`${prefix}MessageId`]: { type: String, default: '', trim: true, maxlength: 120 },
    [`${prefix}WebhookStatus`]: { type: String, default: '', trim: true, maxlength: 60 },
    [`${prefix}WebhookTimestamp`]: { type: Number, default: null },
    [`${prefix}LastError`]: { type: String, default: '', trim: true, maxlength: 320 }
});

const whatsappNotificationsSchema = new mongoose.Schema(
    {
        ...buildWhatsappNotificationEventFields('placed'),
        ...buildWhatsappNotificationEventFields('shipped'),
        ...buildWhatsappNotificationEventFields('outForDelivery'),
        ...buildWhatsappNotificationEventFields('delivered'),
        ...buildWhatsappNotificationEventFields('cancelled')
    },
    { _id: false, strict: true }
);

const shiprocketParcelSchema = new mongoose.Schema(
    {
        lengthCm: { type: Number, default: null, min: 0 },
        breadthCm: { type: Number, default: null, min: 0 },
        heightCm: { type: Number, default: null, min: 0 },
        weightKg: { type: Number, default: null, min: 0 }
    },
    { _id: false, strict: true }
);

const shiprocketPricingSnapshotSchema = new mongoose.Schema(
    {
        formulaVersion: { type: Number, default: 2, min: 1 },
        source: { type: String, default: '', trim: true, maxlength: 40 },
        capturedAt: { type: Number, default: null },
        itemsSubtotal: { type: Number, default: 0, min: 0 },
        localSubtotal: { type: Number, default: 0, min: 0 },
        totalDiscount: { type: Number, default: 0, min: 0 },
        shippingCharges: { type: Number, default: 0, min: 0 },
        subTotal: { type: Number, default: 0, min: 0 },
        localAmount: { type: Number, default: 0, min: 0 },
        derivedFinalAmount: { type: Number, default: 0, min: 0 }
    },
    { _id: false, strict: true }
);

const shiprocketSchema = new mongoose.Schema(
    {
        syncStatus: {
            type: String,
            enum: ['not_required', 'pending', 'synced', 'pending_retry', 'failed'],
            default: 'not_required',
            index: true
        },
        referenceOrderId: { type: String, default: '', trim: true, maxlength: 20 },
        orderId: { type: Number, default: null },
        shipmentId: { type: Number, default: null },
        awbCode: { type: String, default: '', trim: true },
        courierCompanyId: { type: Number, default: null },
        courierName: { type: String, default: '', trim: true, maxlength: 120 },
        status: { type: String, default: '', trim: true, maxlength: 120 },
        statusCode: { type: Number, default: null },
        currentStatus: { type: String, default: '', trim: true, maxlength: 120 },
        currentStatusCode: { type: Number, default: null },
        trackUrl: { type: String, default: '', trim: true, maxlength: 500 },
        syncedAt: { type: Number, default: null },
        lastTrackedAt: { type: Number, default: null },
        lastWebhookAt: { type: Number, default: null },
        lastError: { type: String, default: '', trim: true, maxlength: 500 },
        rawCreateResponse: { type: Object, default: null },
        rawTrackingResponse: { type: Object, default: null },
        pricingSnapshot: { type: shiprocketPricingSnapshotSchema, default: null },
        livePricingSnapshot: { type: shiprocketPricingSnapshotSchema, default: null },
        livePricingVerifiedAt: { type: Number, default: null },
        livePricingVerificationStatus: {
            type: String,
            enum: ['not_verified', 'clear', 'warning', 'mismatch', 'failed'],
            default: 'not_verified'
        },
        livePricingVerificationError: { type: String, default: '', trim: true, maxlength: 500 },
        parcel: { type: shiprocketParcelSchema, default: () => ({}) }
    },
    { _id: false, strict: true }
);

const orderSchema = new mongoose.Schema({

    userId :{
        type:String,
        required:true,
        validate: {
            validator: (value) => objectIdStringRegex.test(String(value || '')),
            message: 'Invalid user id format'
        }
    },
    items : {
        type:[orderItemSchema],
        required:true,
        validate: {
            validator: (value) => Array.isArray(value) && value.length > 0,
            message: 'Order must include at least one item'
        }
    },
    subtotal : {type:Number,default:0,min:0},
    deliveryFee : {type:Number,default:10,min:0},
    discountAmount : {type:Number,default:0,min:0},
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
    amount : {type:Number,required:true,min:0},
    address : {type:orderAddressSchema, required:true},
    customerEmail: { type: String, default: '', trim: true, lowercase: true, maxlength: 254 },
    status : {type:String, required:true,default:'Order Placed'},
    checkoutSource: { type: String, enum: ['cart', 'buy_now'], default: 'cart' },
    inventoryReserved: { type: Boolean, default: false },
    paymentMethod : {type:String, required:true, enum: ['COD', 'Stripe', 'Razorpay']},
    payment : {type:Boolean,required:true , default:false},
    paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'cancelled'], default: 'pending' },
    paymentVerifiedAt: { type: Number, default: null },
    stripeSessionId: { type: String, default: null, index: true },
    stripePaymentIntentId: { type: String, default: null },
    razorpayOrderId: { type: String, default: null, index: true },
    razorpayPaymentId: { type: String, default: null },
    gatewayEventId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    deliveredAt: { type: Number, default: null },
    cancelledAt: { type: Number, default: null },
    shiprocket: { type: shiprocketSchema, default: () => ({}) },
    whatsappNotifications: { type: whatsappNotificationsSchema, default: () => ({}) },
    loyaltyPointsAwarded: { type: Number, default: 0 },
    loyaltyAwardedAt: { type: Number, default: null },
    loyaltyPointsRedeemed: { type: Number, default: 0, min: 0 },
    loyaltyRedemptionStatus: { type: String, enum: ['none', 'reserved', 'redeemed', 'released'], default: 'none' },
    loyaltyRedemptionAppliedAt: { type: Number, default: null },
    loyaltyRedemptionReleasedAt: { type: Number, default: null },
    reviewReminderQueuedAt: { type: Number, default: null },
    date : {type:Number , required : true}

})

orderSchema.index({ userId: 1, date: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ payment: 1 });
orderSchema.index({ date: -1 });
orderSchema.index({ status: 1, date: -1 });
orderSchema.index({ userId: 1, payment: 1 });
orderSchema.index({ paymentMethod: 1 });
orderSchema.index({ 'shiprocket.referenceOrderId': 1 }, { sparse: true });
orderSchema.index({ 'shiprocket.orderId': 1 }, { sparse: true });
orderSchema.index({ 'shiprocket.shipmentId': 1 }, { sparse: true });
orderSchema.index({ 'shiprocket.awbCode': 1 }, { sparse: true });
orderSchema.index({ 'whatsappNotifications.placedMessageId': 1 }, { sparse: true });
orderSchema.index({ 'whatsappNotifications.shippedMessageId': 1 }, { sparse: true });
orderSchema.index({ 'whatsappNotifications.outForDeliveryMessageId': 1 }, { sparse: true });
orderSchema.index({ 'whatsappNotifications.deliveredMessageId': 1 }, { sparse: true });
orderSchema.index({ 'whatsappNotifications.cancelledMessageId': 1 }, { sparse: true });

const orderModel = mongoose.models.order || mongoose.model('order',orderSchema)

export default orderModel;
