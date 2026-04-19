import mongoose from 'mongoose';

const razorpayWebhookEventSchema = new mongoose.Schema(
    {
        eventId: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
            maxlength: 200
        },
        eventType: { type: String, required: true, trim: true, maxlength: 80, index: true },
        signature: { type: String, default: '', trim: true, maxlength: 256 },
        razorpayOrderId: { type: String, default: '', trim: true, maxlength: 80, index: true },
        razorpayPaymentId: { type: String, default: '', trim: true, maxlength: 80 },
        razorpayRefundId: { type: String, default: '', trim: true, maxlength: 80, index: true },
        payload: { type: mongoose.Schema.Types.Mixed, default: {} },
        processed: { type: Boolean, default: false, index: true },
        processedAt: { type: Number, default: null },
        attempts: { type: Number, default: 0, min: 0 },
        lastError: { type: String, default: '', trim: true, maxlength: 500 },
        receivedAt: { type: Number, default: () => Date.now() }
    },
    { timestamps: true, strict: true }
);

razorpayWebhookEventSchema.index({ processed: 1, createdAt: -1 });

const razorpayWebhookEventModel =
    mongoose.models.razorpay_webhook_event ||
    mongoose.model('razorpay_webhook_event', razorpayWebhookEventSchema);

export default razorpayWebhookEventModel;
