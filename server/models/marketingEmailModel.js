import mongoose from 'mongoose';

const objectIdStringRegex = /^[a-f\d]{24}$/i;

const marketingEmailSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            default: '',
            validate: {
                validator: (value) => !value || objectIdStringRegex.test(String(value || '')),
                message: 'Invalid user id format'
            }
        },
        email: { type: String, required: true, trim: true, lowercase: true },
        campaignId: {
            type: String,
            default: '',
            validate: {
                validator: (value) => !value || objectIdStringRegex.test(String(value || '')),
                message: 'Invalid campaign id format'
            }
        },
        automationKey: { type: String, default: 'manual', trim: true, maxlength: 60 },
        subject: { type: String, required: true, trim: true, maxlength: 180 },
        previewText: { type: String, default: '', trim: true, maxlength: 220 },
        body: { type: String, required: true, trim: true, maxlength: 5000 },
        status: { type: String, enum: ['queued', 'sent', 'skipped', 'failed'], default: 'queued' },
        reason: { type: String, default: '', trim: true, maxlength: 220 },
        scheduledFor: { type: Number, default: null },
        sentAt: { type: Number, default: null },
        deliveryProvider: { type: String, default: 'simulation', trim: true, maxlength: 40 },
        deliveryProviderMessageId: { type: String, default: '', trim: true, maxlength: 180 },
        metadata: { type: Object, default: {} }
    },
    { timestamps: true, minimize: false, strict: true }
);

const marketingEmailModel =
    mongoose.models.marketing_email || mongoose.model('marketing_email', marketingEmailSchema);

export default marketingEmailModel;
