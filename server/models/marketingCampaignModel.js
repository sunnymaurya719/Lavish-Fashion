import mongoose from 'mongoose';

const marketingCampaignSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, minlength: 3, maxlength: 120 },
        channel: { type: String, enum: ['email'], default: 'email' },
        campaignType: { type: String, enum: ['broadcast', 'automation'], default: 'broadcast' },
        audience: {
            type: String,
            enum: ['all_users', 'subscribed_users', 'loyalty_members', 'recent_customers'],
            default: 'subscribed_users'
        },
        automationTrigger: {
            type: String,
            enum: ['manual', 'user_registered', 'order_delivered', 'review_published', 'points_milestone'],
            default: 'manual'
        },
        subject: { type: String, required: true, trim: true, minlength: 3, maxlength: 180 },
        previewText: { type: String, default: '', trim: true, maxlength: 220 },
        body: { type: String, required: true, trim: true, minlength: 20, maxlength: 5000 },
        status: { type: String, enum: ['draft', 'scheduled', 'active', 'paused', 'sent'], default: 'draft' },
        sendAt: { type: Number, default: null },
        lastRunAt: { type: Number, default: null },
        queuedCount: { type: Number, default: 0, min: 0 },
        sentCount: { type: Number, default: 0, min: 0 },
        skippedCount: { type: Number, default: 0, min: 0 }
    },
    { timestamps: true, strict: true }
);

const marketingCampaignModel =
    mongoose.models.marketing_campaign || mongoose.model('marketing_campaign', marketingCampaignSchema);

export default marketingCampaignModel;
