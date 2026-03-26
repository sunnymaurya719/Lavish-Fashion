import marketingCampaignModel from '../models/marketingCampaignModel.js';
import marketingEmailModel from '../models/marketingEmailModel.js';
import userModel from '../models/userModel.js';

const defaultPreferences = {
    emailSubscribed: true,
    promotionalCampaigns: true,
    loyaltyUpdates: true,
    reviewReminders: true
};

const getEmailDeliveryMode = () => String(process.env.MARKETING_EMAIL_MODE || 'simulation').trim().toLowerCase();
const getEmailProvider = () => String(process.env.MARKETING_EMAIL_PROVIDER || 'resend').trim().toLowerCase();

const automationTemplates = {
    welcome_signup: {
        subject: 'Welcome to Lavish Fashion, {{name}}',
        previewText: 'Your account is ready, and your referral rewards hub is live.',
        body: 'Hi {{name}}, your Lavish Fashion account is now active. Your referral code is {{referralCode}} and your rewards hub is ready for your first order.'
    },
    order_delivered: {
        subject: 'Your Lavish Fashion order has been delivered',
        previewText: 'Delivery confirmed, and your new loyalty rewards are now available.',
        body: 'Hi {{name}}, order #{{orderCode}} has been marked as delivered. You just earned {{points}} loyalty points, and your current balance is {{loyaltyPoints}}.'
    },
    review_request: {
        subject: 'Tell us how your recent order felt',
        previewText: 'Your review helps shoppers buy with confidence.',
        body: 'Hi {{name}}, we would love a quick review for your latest Lavish Fashion order #{{orderCode}}. Verified reviews also help unlock extra rewards.'
    },
    referral_reward_referrer: {
        subject: 'Your referral reward is now unlocked',
        previewText: 'A friend completed their first order using your referral.',
        body: 'Hi {{name}}, your referral just converted successfully. {{points}} loyalty points have been added to your balance.'
    },
    referral_reward_new_customer: {
        subject: 'Your referral bonus is ready',
        previewText: 'Thanks for shopping with Lavish Fashion.',
        body: 'Hi {{name}}, your first delivered order unlocked {{points}} bonus loyalty points. Your balance is now {{loyaltyPoints}}.'
    },
    review_published: {
        subject: 'Your product review is now live',
        previewText: 'Thanks for helping shoppers make better decisions.',
        body: 'Hi {{name}}, your review for {{productName}} is now published. {{points}} reward points have been added to your account.'
    }
};

const getUserMarketingPreferences = (user = {}) => ({
    ...defaultPreferences,
    ...(user.marketingPreferences || {})
});

const renderTemplate = (template = '', context = {}) =>
    String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => String(context[key] ?? ''));

const wrapHtmlEmailBody = (body = '', previewText = '') => `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:24px;padding:32px;border:1px solid #e2e8f0;">
      <p style="margin:0 0 12px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#64748b;">Lavish Fashion</p>
      ${previewText ? `<p style="margin:0 0 16px;font-size:14px;color:#475569;">${previewText}</p>` : ''}
      <div style="font-size:15px;line-height:1.7;color:#1e293b;">${String(body).replace(/\n/g, '<br />')}</div>
    </div>
  </body>
</html>`;

const sendViaResend = async ({ email, subject, previewText = '', body }) => {
    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    const fromEmail = String(process.env.MARKETING_FROM_EMAIL || '').trim();
    const replyToEmail = String(process.env.MARKETING_REPLY_TO_EMAIL || '').trim();

    if (!apiKey || !fromEmail) {
        throw new Error('Resend email delivery is not fully configured');
    }

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: fromEmail,
            to: [email],
            reply_to: replyToEmail || undefined,
            subject,
            text: body,
            html: wrapHtmlEmailBody(body, previewText)
        })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(payload?.message || payload?.error || 'Email delivery failed');
    }

    return {
        messageId: String(payload?.id || '')
    };
};

const deliverEmail = async ({ email, subject, previewText = '', body }) => {
    const mode = getEmailDeliveryMode();
    const provider = getEmailProvider();

    if (mode === 'simulation') {
        return {
            deliveryProvider: 'simulation',
            messageId: `sim_${Date.now()}`,
            sentAt: Date.now()
        };
    }

    if (provider === 'resend') {
        const result = await sendViaResend({ email, subject, previewText, body });
        return {
            deliveryProvider: 'resend',
            messageId: result.messageId,
            sentAt: Date.now()
        };
    }

    throw new Error(`Unsupported email provider: ${provider}`);
};

const resolvePreferenceKey = (automationKey) => {
    if (automationKey === 'review_request') {
        return 'reviewReminders';
    }

    if (
        automationKey === 'order_delivered' ||
        automationKey === 'referral_reward_referrer' ||
        automationKey === 'referral_reward_new_customer' ||
        automationKey === 'review_published'
    ) {
        return 'loyaltyUpdates';
    }

    if (automationKey === 'campaign_broadcast') {
        return 'promotionalCampaigns';
    }

    return 'emailSubscribed';
};

const createEmailRecord = async ({
    user,
    subject,
    previewText = '',
    body,
    automationKey = 'manual',
    campaignId = '',
    metadata = {},
    preferenceKey = 'emailSubscribed'
}) => {
    const preferences = getUserMarketingPreferences(user);
    const isSubscribed = preferences.emailSubscribed !== false;
    const isPreferenceEnabled = preferences[preferenceKey] !== false;
    const shouldSend = Boolean(user?.email) && isSubscribed && isPreferenceEnabled;

    if (!shouldSend) {
        return marketingEmailModel.create({
            userId: user?._id ? String(user._id) : '',
            email: String(user?.email || '').trim().toLowerCase(),
            campaignId,
            automationKey,
            subject,
            previewText,
            body,
            status: 'skipped',
            reason: 'Recipient is unsubscribed or missing email',
            scheduledFor: Date.now(),
            sentAt: null,
            deliveryProvider: getEmailDeliveryMode(),
            metadata
        });
    }

    const emailRecord = await marketingEmailModel.create({
        userId: user?._id ? String(user._id) : '',
        email: String(user?.email || '').trim().toLowerCase(),
        campaignId,
        automationKey,
        subject,
        previewText,
        body,
        status: 'queued',
        reason: '',
        scheduledFor: Date.now(),
        sentAt: null,
        deliveryProvider: getEmailDeliveryMode(),
        metadata
    });

    try {
        const deliveryResult = await deliverEmail({
            email: String(user?.email || '').trim().toLowerCase(),
            subject,
            previewText,
            body
        });

        return marketingEmailModel.findByIdAndUpdate(
            emailRecord._id,
            {
                status: 'sent',
                sentAt: deliveryResult.sentAt,
                deliveryProvider: deliveryResult.deliveryProvider,
                deliveryProviderMessageId: deliveryResult.messageId,
                reason: ''
            },
            { new: true }
        ).lean();
    } catch (error) {
        return marketingEmailModel.findByIdAndUpdate(
            emailRecord._id,
            {
                status: 'failed',
                sentAt: null,
                deliveryProvider: getEmailProvider(),
                reason: String(error?.message || 'Email delivery failed').slice(0, 220)
            },
            { new: true }
        ).lean();
    }
};

const queueAutomationEmail = async ({ userId, automationKey, context = {}, campaignId = '' }) => {
    const user = typeof userId === 'object' && userId !== null
        ? userId
        : await userModel.findById(userId).lean();

    if (!user) {
        return null;
    }

    const template = automationTemplates[automationKey];
    if (!template) {
        return null;
    }

    const templateContext = {
        name: user.name || 'Customer',
        referralCode: user.referralCode || '',
        loyaltyPoints: Number(user.loyaltyPoints || 0),
        ...context
    };

    return createEmailRecord({
        user,
        subject: renderTemplate(template.subject, templateContext),
        previewText: renderTemplate(template.previewText, templateContext),
        body: renderTemplate(template.body, templateContext),
        automationKey,
        campaignId,
        metadata: context,
        preferenceKey: resolvePreferenceKey(automationKey)
    });
};

const resolveCampaignAudienceFilter = (campaign) => {
    if (campaign.audience === 'all_users') {
        return {};
    }

    if (campaign.audience === 'subscribed_users') {
        return { 'marketingPreferences.emailSubscribed': { $ne: false } };
    }

    if (campaign.audience === 'loyalty_members') {
        return { loyaltyPoints: { $gt: 0 } };
    }

    if (campaign.audience === 'recent_customers') {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return { createdAt: { $gte: thirtyDaysAgo } };
    }

    return {};
};

const dispatchMarketingCampaign = async (campaignId) => {
    const campaign = await marketingCampaignModel.findById(campaignId);

    if (!campaign) {
        throw new Error('Campaign not found');
    }

    const recipients = await userModel.find(resolveCampaignAudienceFilter(campaign)).lean();

    let sentCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const user of recipients) {
        const emailRecord = await createEmailRecord({
            user,
            subject: renderTemplate(campaign.subject, {
                name: user.name,
                referralCode: user.referralCode || '',
                loyaltyPoints: Number(user.loyaltyPoints || 0)
            }),
            previewText: renderTemplate(campaign.previewText, {
                name: user.name,
                referralCode: user.referralCode || '',
                loyaltyPoints: Number(user.loyaltyPoints || 0)
            }),
            body: renderTemplate(campaign.body, {
                name: user.name,
                referralCode: user.referralCode || '',
                loyaltyPoints: Number(user.loyaltyPoints || 0)
            }),
            automationKey: 'campaign_broadcast',
            campaignId: String(campaign._id),
            metadata: {
                campaignName: campaign.name,
                audience: campaign.audience
            },
            preferenceKey: 'promotionalCampaigns'
        });

        if (emailRecord.status === 'sent') {
            sentCount += 1;
        } else if (emailRecord.status === 'skipped') {
            skippedCount += 1;
        } else {
            failedCount += 1;
        }
    }

    const updatedCampaign = await marketingCampaignModel.findByIdAndUpdate(
        campaign._id,
        {
            status: 'sent',
            lastRunAt: Date.now(),
            queuedCount: recipients.length,
            sentCount,
            skippedCount
        },
        { new: true }
    ).lean();

    return {
        campaign: updatedCampaign,
        recipientsCount: recipients.length,
        sentCount,
        skippedCount,
        failedCount
    };
};

export {
    createEmailRecord,
    dispatchMarketingCampaign,
    getEmailDeliveryMode,
    getEmailProvider,
    getUserMarketingPreferences,
    queueAutomationEmail
};
