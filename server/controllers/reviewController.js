import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
import reviewModel from '../models/reviewModel.js';
import userModel from '../models/userModel.js';
import { awardLoyaltyPoints, getReviewRewardPoints } from '../services/loyaltyService.js';
import { queueAutomationEmail } from '../services/marketingAutomationService.js';
import { uploadReviewMediaFiles } from '../services/reviewMediaService.js';

const isValidObjectId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

const buildReviewSummary = (reviews = []) => {
    const reviewCount = reviews.length;
    const totalRating = reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
    const averageRating = reviewCount > 0 ? Number((totalRating / reviewCount).toFixed(1)) : 0;
    const ratingBreakdown = [5, 4, 3, 2, 1].map((rating) => ({
        rating,
        count: reviews.filter((review) => Number(review.rating) === rating).length
    }));

    return {
        reviewCount,
        averageRating,
        ratingBreakdown
    };
};

const listProductReviews = async (req, res) => {
    try {
        const productId = String(req.params.productId || '').trim();

        if (!isValidObjectId(productId)) {
            return res.status(400).json({ success: false, message: 'Invalid product id' });
        }

        const reviews = await reviewModel.find({ productId, status: 'published' }).sort({ createdAt: -1 }).lean();

        res.set('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=60');
        return res.status(200).json({
            success: true,
            summary: buildReviewSummary(reviews),
            reviews: reviews.map((review) => ({
                _id: String(review._id),
                reviewerName: review.reviewerName,
                rating: review.rating,
                title: review.title,
                comment: review.comment,
                media: Array.isArray(review.media) ? review.media : [],
                isVerifiedPurchase: Boolean(review.isVerifiedPurchase),
                adminReply: review.adminReply || '',
                createdAt: review.createdAt
            }))
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch product reviews');
        return res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
    }
};

const getReviewEligibility = async (req, res) => {
    try {
        const { productId } = req.body;
        const [product, existingReview, deliveredOrder] = await Promise.all([
            productModel.findById(productId).select('_id status').lean(),
            reviewModel.findOne({ productId, userId: req.userId }).select('_id status').lean(),
            orderModel
                .findOne({
                    userId: req.userId,
                    status: 'Delivered',
                    'items._id': productId
                })
                .sort({ date: -1 })
                .lean()
        ]);

        if (!product || product.status === 'archived') {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        if (existingReview) {
            return res.status(200).json({
                success: true,
                eligibility: {
                    canReview: false,
                    alreadyReviewed: true,
                    reviewStatus: existingReview.status,
                    reason: 'You have already reviewed this product'
                }
            });
        }

        if (!deliveredOrder) {
            return res.status(200).json({
                success: true,
                eligibility: {
                    canReview: false,
                    alreadyReviewed: false,
                    reviewStatus: null,
                    reason: 'A delivered order is required before leaving a review'
                }
            });
        }

        return res.status(200).json({
            success: true,
            eligibility: {
                canReview: true,
                alreadyReviewed: false,
                reviewStatus: null,
                reason: '',
                orderId: String(deliveredOrder._id)
            }
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch review eligibility');
        return res.status(500).json({ success: false, message: 'Failed to fetch review eligibility' });
    }
};

const createReview = async (req, res) => {
    try {
        const { productId, rating, title, comment } = req.body;
        const [product, user, existingReview, deliveredOrder] = await Promise.all([
            productModel.findById(productId).select('_id name status').lean(),
            userModel.findById(req.userId).select('_id name').lean(),
            reviewModel.findOne({ productId, userId: req.userId }).select('_id').lean(),
            orderModel
                .findOne({
                    userId: req.userId,
                    status: 'Delivered',
                    'items._id': productId
                })
                .sort({ date: -1 })
                .lean()
        ]);

        if (!product || product.status === 'archived') {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (existingReview) {
            return res.status(409).json({ success: false, message: 'You have already reviewed this product' });
        }

        if (!deliveredOrder) {
            return res.status(403).json({ success: false, message: 'Delivered orders are required before reviewing' });
        }

        const uploadedMedia = await uploadReviewMediaFiles(req.files);

        const review = await reviewModel.create({
            userId: req.userId,
            productId,
            orderId: String(deliveredOrder._id),
            reviewerName: user.name,
            rating,
            title,
            comment,
            media: uploadedMedia,
            status: 'pending'
        });

        return res.status(201).json({
            success: true,
            message: 'Review submitted successfully and is pending moderation',
            review: {
                _id: String(review._id),
                status: review.status
            }
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to create review');
        const statusCode = error.message === 'Review media uploads are not configured on the server' ? 503 : 500;
        return res.status(statusCode).json({ success: false, message: error.message || 'Failed to submit review' });
    }
};

const listAdminReviews = async (req, res) => {
    try {
        const [reviews, products, users] = await Promise.all([
            reviewModel.find({}).sort({ createdAt: -1 }).lean(),
            productModel.find({}).select('_id name image category subCategory').lean(),
            userModel.find({}).select('_id name email').lean()
        ]);

        const productMap = new Map(products.map((product) => [String(product._id), product]));
        const userMap = new Map(users.map((user) => [String(user._id), user]));

        return res.status(200).json({
            success: true,
            metrics: {
                totalReviews: reviews.length,
                pendingReviews: reviews.filter((review) => review.status === 'pending').length,
                publishedReviews: reviews.filter((review) => review.status === 'published').length,
                rejectedReviews: reviews.filter((review) => review.status === 'rejected').length,
                averageRating: buildReviewSummary(reviews).averageRating,
                rewardPointsIssued: reviews.reduce((sum, review) => sum + Number(review.rewardPointsGranted || 0), 0)
            },
            reviews: reviews.map((review) => ({
                ...review,
                _id: String(review._id),
                media: Array.isArray(review.media) ? review.media : [],
                product: productMap.get(review.productId) || null,
                customer: userMap.get(review.userId) || null
            }))
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch admin reviews');
        return res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
    }
};

const updateReviewStatus = async (req, res) => {
    try {
        const { reviewId, status, adminReply = '' } = req.body;
        const existingReview = await reviewModel.findById(reviewId);

        if (!existingReview) {
            return res.status(404).json({ success: false, message: 'Review not found' });
        }

        const wasPublished = existingReview.status === 'published';
        existingReview.status = status;
        existingReview.adminReply = String(adminReply || '').trim();

        if (status === 'published' && !wasPublished && Number(existingReview.rewardPointsGranted || 0) === 0) {
            const rewardPoints = getReviewRewardPoints();
            const rewardResult = await awardLoyaltyPoints({
                userId: existingReview.userId,
                points: rewardPoints,
                type: 'review_published',
                description: 'Reward earned for publishing a verified product review',
                metadata: {
                    reviewId: String(existingReview._id),
                    productId: existingReview.productId
                }
            });

            existingReview.rewardPointsGranted = rewardPoints;

            const [user, product] = await Promise.all([
                userModel.findById(existingReview.userId).lean(),
                productModel.findById(existingReview.productId).select('name').lean()
            ]);

            await queueAutomationEmail({
                userId: user,
                automationKey: 'review_published',
                context: {
                    points: rewardPoints,
                    loyaltyPoints: Number(rewardResult?.user?.loyaltyPoints || user?.loyaltyPoints || 0),
                    productName: product?.name || 'your purchase'
                }
            });
        }

        await existingReview.save();

        return res.status(200).json({
            success: true,
            message: 'Review status updated successfully',
            review: existingReview
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to update review status');
        return res.status(500).json({ success: false, message: 'Failed to update review status' });
    }
};

export { createReview, getReviewEligibility, listAdminReviews, listProductReviews, updateReviewStatus };
