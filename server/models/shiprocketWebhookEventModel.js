import mongoose from 'mongoose';

const shiprocketWebhookEventSchema = new mongoose.Schema(
    {
        provider: { type: String, required: true, default: 'shiprocket', trim: true, lowercase: true },
        eventKey: { type: String, required: true, unique: true, trim: true },
        shipmentId: { type: Number, default: null, index: true },
        orderId: { type: Number, default: null, index: true },
        awbCode: { type: String, default: '', trim: true, index: true },
        status: { type: String, default: '', trim: true },
        payloadHash: { type: String, required: true, trim: true },
        rawPayload: { type: Object, default: null },
        receivedAt: { type: Date, default: Date.now }
    },
    {
        timestamps: true,
        minimize: false
    }
);

shiprocketWebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

const shiprocketWebhookEventModel =
    mongoose.models.shiprocket_webhook_event ||
    mongoose.model('shiprocket_webhook_event', shiprocketWebhookEventSchema);

export default shiprocketWebhookEventModel;
