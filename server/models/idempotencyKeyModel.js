import mongoose from 'mongoose';

const idempotencyKeySchema = new mongoose.Schema(
    {
        userId: { type: String, required: true, index: true },
        scope: { type: String, required: true },
        key: { type: String, required: true },
        requestHash: { type: String, required: true },
        state: { type: String, enum: ['in_progress', 'completed'], default: 'in_progress' },
        statusCode: { type: Number, default: null },
        responseBody: { type: Object, default: null }
    },
    {
        timestamps: true,
        minimize: false
    }
);

idempotencyKeySchema.index({ userId: 1, scope: 1, key: 1 }, { unique: true });
idempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

const idempotencyKeyModel =
    mongoose.models.idempotency_key || mongoose.model('idempotency_key', idempotencyKeySchema);

export default idempotencyKeyModel;
