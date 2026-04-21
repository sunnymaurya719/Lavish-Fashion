import mongoose from 'mongoose';

/**
 * Lightweight admin audit log. Records who performed which administrative
 * action, against which target, and what changed. Used primarily for the
 * RBAC user/permission management surface.
 */
const auditLogSchema = new mongoose.Schema(
    {
        actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'user', default: null, index: true },
        actorEmail: { type: String, default: '', trim: true, lowercase: true, maxlength: 255 },
        actorRole: { type: String, default: '', trim: true, maxlength: 30 },
        action: { type: String, required: true, trim: true, maxlength: 80, index: true },
        targetType: { type: String, default: '', trim: true, maxlength: 40 },
        targetId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
        targetLabel: { type: String, default: '', trim: true, maxlength: 255 },
        before: { type: mongoose.Schema.Types.Mixed, default: null },
        after: { type: mongoose.Schema.Types.Mixed, default: null },
        metadata: { type: mongoose.Schema.Types.Mixed, default: null },
        ip: { type: String, default: '', trim: true, maxlength: 64 }
    },
    { timestamps: true, minimize: false }
);

auditLogSchema.index({ createdAt: -1 });

const auditLogModel = mongoose.models.auditLog || mongoose.model('auditLog', auditLogSchema);

export default auditLogModel;
