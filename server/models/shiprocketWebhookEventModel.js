import mongoose from 'mongoose';

const shiprocketWebhookEventSchema = new mongoose.Schema(
    {
        provider: { type: String, required: true, default: 'shiprocket', trim: true, lowercase: true },
        eventKey: { type: String, required: true, unique: true, trim: true },
        shipmentId: { type: Number, default: null, index: true },
        orderId: { type: Number, default: null, index: true },
        awbCode: { type: String, default: '', trim: true, index: true },
        referenceOrderId: { type: String, default: '', trim: true, index: true },
        eventName: { type: String, default: '', trim: true },
        status: { type: String, default: '', trim: true },
        payloadHash: { type: String, required: true, trim: true },
        rawPayload: { type: Object, default: null },
        requestId: { type: String, default: '', trim: true, index: true },
        requestHeaders: { type: Object, default: null },
        processingStatus: {
            type: String,
            enum: ['queued', 'processing', 'processed', 'ignored', 'unmatched', 'failed'],
            default: 'queued',
            index: true
        },
        processingAttempts: { type: Number, default: 0, min: 0 },
        matchedOrderId: { type: String, default: '', trim: true, index: true },
        localStatus: { type: String, default: '', trim: true },
        lastError: { type: String, default: '', trim: true, maxlength: 500 },
        nextRetryAt: { type: Date, default: null, index: true },
        lastProcessingStartedAt: { type: Date, default: null },
        processedAt: { type: Date, default: null },
        receivedAt: { type: Date, default: Date.now, index: true }
    },
    {
        timestamps: true,
        minimize: false
    }
);

shiprocketWebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
shiprocketWebhookEventSchema.index({ processingStatus: 1, nextRetryAt: 1, receivedAt: 1 });

const shiprocketWebhookEventModel =
    mongoose.models.shiprocket_webhook_event ||
    mongoose.model('shiprocket_webhook_event', shiprocketWebhookEventSchema);

export default shiprocketWebhookEventModel;
