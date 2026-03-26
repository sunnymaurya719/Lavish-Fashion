import loyaltyTransactionModel from '../models/loyaltyTransactionModel.js';
import userModel from '../models/userModel.js';
import { determineLoyaltyTier, getUserLoyaltySummary } from '../services/loyaltyService.js';

const listAdminLoyaltyInsights = async (req, res) => {
    try {
        const [users, recentTransactions] = await Promise.all([
            userModel.find({}).sort({ loyaltyPoints: -1, lifetimeLoyaltyPoints: -1 }).lean(),
            loyaltyTransactionModel.find({}).sort({ createdAt: -1 }).limit(14).lean()
        ]);

        const userMap = new Map(users.map((user) => [String(user._id), user]));
        const totalPointsIssued = recentTransactions
            .filter((transaction) => Number(transaction.points || 0) > 0)
            .reduce((sum, transaction) => sum + Number(transaction.points || 0), 0);

        return res.status(200).json({
            success: true,
            metrics: {
                activeMembers: users.filter((user) => Number(user.loyaltyPoints || 0) > 0).length,
                totalPointsIssued,
                successfulReferrals: users.reduce((sum, user) => sum + Number(user.successfulReferralCount || 0), 0),
                tierBreakdown: ['Bronze', 'Silver', 'Gold', 'Platinum'].map((tier) => ({
                    tier,
                    count: users.filter(
                        (user) => determineLoyaltyTier(user.lifetimeLoyaltyPoints || user.loyaltyPoints || 0).currentTier === tier
                    ).length
                })),
                topMembers: users.slice(0, 8).map((user) => ({
                    _id: String(user._id),
                    name: user.name,
                    email: user.email,
                    loyaltyPoints: Number(user.loyaltyPoints || 0),
                    lifetimeLoyaltyPoints: Number(user.lifetimeLoyaltyPoints || 0),
                    successfulReferralCount: Number(user.successfulReferralCount || 0),
                    loyaltyTier: determineLoyaltyTier(user.lifetimeLoyaltyPoints || user.loyaltyPoints || 0).currentTier
                })),
                topReferrers: [...users]
                    .sort((left, right) => Number(right.successfulReferralCount || 0) - Number(left.successfulReferralCount || 0))
                    .slice(0, 8)
                    .map((user) => ({
                        _id: String(user._id),
                        name: user.name,
                        email: user.email,
                        successfulReferralCount: Number(user.successfulReferralCount || 0),
                        referralCode: user.referralCode || ''
                    })),
                recentTransactions: recentTransactions.map((transaction) => ({
                    ...transaction,
                    _id: String(transaction._id),
                    customer: userMap.get(transaction.userId)
                        ? {
                            _id: transaction.userId,
                            name: userMap.get(transaction.userId).name,
                            email: userMap.get(transaction.userId).email
                        }
                        : null
                }))
            }
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch loyalty admin insights');
        return res.status(500).json({ success: false, message: 'Failed to fetch loyalty insights' });
    }
};

const getUserRewardsSummary = async (req, res) => {
    try {
        const summary = await getUserLoyaltySummary(req.userId);

        if (!summary) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        return res.status(200).json({
            success: true,
            summary
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch loyalty summary');
        return res.status(500).json({ success: false, message: 'Failed to fetch rewards summary' });
    }
};

export { getUserRewardsSummary, listAdminLoyaltyInsights };
