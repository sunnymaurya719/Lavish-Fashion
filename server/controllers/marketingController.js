import marketingCampaignModel from '../models/marketingCampaignModel.js';
import marketingEmailModel from '../models/marketingEmailModel.js';
import {
    dispatchMarketingCampaign,
    getEmailDeliveryMode,
    getEmailProvider
} from '../services/marketingAutomationService.js';

const normalizeCampaignPayload = (body) => ({
    name: String(body.name || '').trim(),
    channel: 'email',
    campaignType: body.campaignType,
    audience: body.audience,
    automationTrigger: body.automationTrigger,
    subject: String(body.subject || '').trim(),
    previewText: String(body.previewText || '').trim(),
    body: String(body.body || '').trim(),
    status: body.status || 'draft',
    sendAt: body.sendAt ? new Date(body.sendAt).getTime() : null
});

const listMarketingOverview = async (req, res) => {
    try {
        const [campaigns, activity] = await Promise.all([
            marketingCampaignModel.find({}).sort({ createdAt: -1 }).lean(),
            marketingEmailModel.find({}).sort({ createdAt: -1 }).limit(20).lean()
        ]);

        const metrics = {
            totalCampaigns: campaigns.length,
            activeCampaigns: campaigns.filter((campaign) => campaign.status === 'active').length,
            scheduledCampaigns: campaigns.filter((campaign) => campaign.status === 'scheduled').length,
            sentCampaigns: campaigns.filter((campaign) => campaign.status === 'sent').length,
            emailsSent: activity.filter((item) => item.status === 'sent').length,
            emailsSkipped: activity.filter((item) => item.status === 'skipped').length,
            emailsFailed: activity.filter((item) => item.status === 'failed').length,
            automationEvents: activity.filter((item) => item.automationKey && item.automationKey !== 'campaign_broadcast').length
        };

        return res.status(200).json({
            success: true,
            metrics,
            deliveryConfig: {
                mode: getEmailDeliveryMode(),
                provider: getEmailProvider()
            },
            campaigns,
            activity
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch marketing overview');
        return res.status(500).json({ success: false, message: 'Failed to fetch marketing overview' });
    }
};

const createCampaign = async (req, res) => {
    try {
        const campaign = await marketingCampaignModel.create(normalizeCampaignPayload(req.body));

        return res.status(201).json({
            success: true,
            message: 'Campaign created successfully',
            campaign
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to create campaign');
        return res.status(500).json({ success: false, message: 'Failed to create campaign' });
    }
};

const updateCampaign = async (req, res) => {
    try {
        const { campaignId } = req.body;
        const campaign = await marketingCampaignModel.findByIdAndUpdate(
            campaignId,
            normalizeCampaignPayload(req.body),
            { new: true, runValidators: true }
        ).lean();

        if (!campaign) {
            return res.status(404).json({ success: false, message: 'Campaign not found' });
        }

        return res.status(200).json({
            success: true,
            message: 'Campaign updated successfully',
            campaign
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to update campaign');
        return res.status(500).json({ success: false, message: 'Failed to update campaign' });
    }
};

const updateCampaignStatus = async (req, res) => {
    try {
        const { campaignId, status } = req.body;
        const campaign = await marketingCampaignModel.findByIdAndUpdate(
            campaignId,
            { status },
            { new: true, runValidators: true }
        ).lean();

        if (!campaign) {
            return res.status(404).json({ success: false, message: 'Campaign not found' });
        }

        return res.status(200).json({
            success: true,
            message: 'Campaign status updated successfully',
            campaign
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to update campaign status');
        return res.status(500).json({ success: false, message: 'Failed to update campaign status' });
    }
};

const dispatchCampaign = async (req, res) => {
    try {
        const { campaignId } = req.body;
        const dispatchResult = await dispatchMarketingCampaign(campaignId);

        return res.status(200).json({
            success: true,
            message: 'Campaign dispatched successfully',
            ...dispatchResult
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to dispatch campaign');
        return res.status(500).json({ success: false, message: error.message || 'Failed to dispatch campaign' });
    }
};

export { createCampaign, dispatchCampaign, listMarketingOverview, updateCampaign, updateCampaignStatus };
