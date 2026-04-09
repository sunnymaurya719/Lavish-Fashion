import loyaltyTransactionModel from '../models/loyaltyTransactionModel.js';
import userModel from '../models/userModel.js';
import { determineLoyaltyTier, getUserLoyaltySummary, awardLoyaltyPoints } from '../services/loyaltyService.js';

const listAdminLoyaltyInsights = async (req, res) => {
    try {
        const [
            activeMembersCount,
            totalPointsIssuedResult,
            totalSuccessfulReferrals,
            topMembers,
            topReferrers,
            recentTransactions
        ] = await Promise.all([
            userModel.countDocuments({ loyaltyPoints: { $gt: 0 } }),
            loyaltyTransactionModel.aggregate([
                { $match: { points: { $gt: 0 } } },
                { $group: { _id: null, total: { $sum: '$points' } } }
            ]),
            userModel.aggregate([
                { $group: { _id: null, total: { $sum: '$successfulReferralCount' } } }
            ]),
            userModel
                .find({})
                .sort({ loyaltyPoints: -1, lifetimeLoyaltyPoints: -1 })
                .limit(8)
                .select('_id name email loyaltyPoints lifetimeLoyaltyPoints successfulReferralCount')
                .lean(),
            userModel
                .find({ successfulReferralCount: { $gt: 0 } })
                .sort({ successfulReferralCount: -1 })
                .limit(8)
                .select('_id name email successfulReferralCount referralCode')
                .lean(),
            loyaltyTransactionModel.find({}).sort({ createdAt: -1 }).limit(14).lean()
        ]);

        const totalPointsIssued = totalPointsIssuedResult[0]?.total || 0;
        const successfulReferrals = totalSuccessfulReferrals[0]?.total || 0;

        // Tier breakdown via aggregation to avoid loading all users
        const tierBreakdown = await userModel.aggregate([
            {
                $project: {
                    tierPoints: {
                        $ifNull: [
                            { $cond: [{ $gt: ['$lifetimeLoyaltyPoints', 0] }, '$lifetimeLoyaltyPoints', '$loyaltyPoints'] },
                            0
                        ]
                    }
                }
            },
            {
                $project: {
                    tier: {
                        $switch: {
                            branches: [
                                { case: { $gte: ['$tierPoints', 3000] }, then: 'Platinum' },
                                { case: { $gte: ['$tierPoints', 1500] }, then: 'Gold' },
                                { case: { $gte: ['$tierPoints', 500] }, then: 'Silver' }
                            ],
                            default: 'Bronze'
                        }
                    }
                }
            },
            { $group: { _id: '$tier', count: { $sum: 1 } } }
        ]);

        const tierMap = new Map(tierBreakdown.map((item) => [item._id, item.count]));

        // Build user map only for recent transaction user IDs
        const transactionUserIds = [...new Set(recentTransactions.map((t) => t.userId).filter(Boolean))];
        const transactionUsers = transactionUserIds.length > 0
            ? await userModel.find({ _id: { $in: transactionUserIds } }).select('_id name email').lean()
            : [];
        const userMap = new Map(transactionUsers.map((user) => [String(user._id), user]));

        return res.status(200).json({
            success: true,
            metrics: {
                activeMembers: activeMembersCount,
                totalPointsIssued,
                successfulReferrals,
                tierBreakdown: ['Bronze', 'Silver', 'Gold', 'Platinum'].map((tier) => ({
                    tier,
                    count: tierMap.get(tier) || 0
                })),
                topMembers: topMembers.map((user) => ({
                    _id: String(user._id),
                    name: user.name,
                    email: user.email,
                    loyaltyPoints: Number(user.loyaltyPoints || 0),
                    lifetimeLoyaltyPoints: Number(user.lifetimeLoyaltyPoints || 0),
                    successfulReferralCount: Number(user.successfulReferralCount || 0),
                    loyaltyTier: determineLoyaltyTier(user.lifetimeLoyaltyPoints || user.loyaltyPoints || 0).currentTier
                })),
                topReferrers: topReferrers.map((user) => ({
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

const adminManualAdjustment = async (req, res) => {
    try {
        const { userId, points, description } = req.body;
        const normalizedPoints = Math.floor(Number(points || 0));
        const trimmedDescription = String(description || '').trim();

        if (!userId || typeof userId !== 'string' || !/^[a-f\d]{24}$/i.test(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid user id' });
        }

        if (normalizedPoints === 0) {
            return res.status(400).json({ success: false, message: 'Points adjustment cannot be zero' });
        }

        if (trimmedDescription.length < 3 || trimmedDescription.length > 180) {
            return res.status(400).json({ success: false, message: 'Description must be between 3 and 180 characters' });
        }

        const result = await awardLoyaltyPoints({
            userId,
            points: normalizedPoints,
            type: 'manual_adjustment',
            description: trimmedDescription,
            metadata: { adjustedBy: 'admin' }
        });

        if (!result) {
            return res.status(404).json({ success: false, message: 'User not found or insufficient balance for deduction' });
        }

        return res.status(200).json({
            success: true,
            message: `Adjusted ${normalizedPoints > 0 ? '+' : ''}${normalizedPoints} points for user`,
            transaction: {
                _id: String(result.transaction._id),
                points: result.transaction.points,
                balanceAfter: result.transaction.balanceAfter,
                description: result.transaction.description
            }
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to perform manual loyalty adjustment');
        return res.status(500).json({ success: false, message: 'Failed to adjust loyalty points' });
    }
};

const getUserTransactionHistory = async (req, res) => {
    try {
        const page = Math.max(1, Math.floor(Number(req.query.page || 1)));
        const limit = Math.min(50, Math.max(1, Math.floor(Number(req.query.limit || 20))));
        const skip = (page - 1) * limit;

        const [transactions, totalCount] = await Promise.all([
            loyaltyTransactionModel
                .find({ userId: req.userId })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            loyaltyTransactionModel.countDocuments({ userId: req.userId })
        ]);

        return res.status(200).json({
            success: true,
            transactions,
            pagination: {
                page,
                limit,
                totalCount,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch transaction history');
        return res.status(500).json({ success: false, message: 'Failed to fetch transaction history' });
    }
};

export { getUserRewardsSummary, listAdminLoyaltyInsights, adminManualAdjustment, getUserTransactionHistory };
