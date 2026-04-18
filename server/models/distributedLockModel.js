import mongoose from 'mongoose';

const distributedLockSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true, trim: true },
        ownerId: { type: String, default: '', trim: true, index: true },
        expiresAt: { type: Date, default: null },
        metadata: { type: Object, default: null },
        lastAcquiredAt: { type: Date, default: null },
        lastReleasedAt: { type: Date, default: null }
    },
    {
        timestamps: true,
        minimize: false
    }
);

distributedLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const distributedLockModel =
    mongoose.models.distributed_lock ||
    mongoose.model('distributed_lock', distributedLockSchema);

export default distributedLockModel;
