import jwt from 'jsonwebtoken';
import fitFeedbackModel from '../models/fitFeedbackModel.js';
import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
import { extractToken } from '../middleware/auth.js';
import { getFitAnalyticsOverview } from '../services/fitAnalyticsService.js';
import { analyzeBodyScan } from '../services/fitBodyScanService.js';
import { getFitInsightsForProduct } from '../services/fitInsightsService.js';
import { recommendSizeForProduct } from '../services/fitRecommendationService.js';
import { assertFitAssistantAvailableForProduct } from '../services/fitRuntimeService.js';

const resolveOptionalUserId = (req) => {
    const token = extractToken(req);

    if (!token) {
        return '';
    }

    try {
        const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
        return String(decodedToken?.id || '').trim();
    } catch {
        return '';
    }
};

const recommendSize = async (req, res) => {
    try {
        const { productId, userMetrics, bodyFeatures } = req.body;
        const product = await productModel.findById(productId).lean();

        if (!product || product.status === 'archived') {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        assertFitAssistantAvailableForProduct(product);

        const recommendation = await recommendSizeForProduct({
            product,
            userMetrics,
            bodyFeatures,
            userId: resolveOptionalUserId(req),
            requestId: req.requestId,
            log: req.log
        });

        return res.status(200).json({
            success: true,
            ...recommendation
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to recommend product size');
        const statusCode = Number(error?.statusCode || 500);
        return res.status(statusCode).json({
            success: false,
            message: error.message || 'Unable to recommend a size right now'
        });
    }
};

const analyzeBody = async (req, res) => {
    try {
        const { heightCm, weightKg = null, imageBase64 = '', landmarks = [] } = req.body;
        const bodyScanResult = await analyzeBodyScan({
            scanInput: {
                heightCm,
                weightKg,
                imageBase64,
                landmarks
            },
            requestId: req.requestId,
            log: req.log
        });

        return res.status(200).json({
            success: true,
            ...bodyScanResult
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to analyze body scan');
        const statusCode = Number(error?.statusCode || 500);
        return res.status(statusCode).json({
            success: false,
            message: error.message || 'Unable to analyze the body scan right now'
        });
    }
};

const listUserFitFeedback = async (req, res) => {
    try {
        const feedbackEntries = await fitFeedbackModel.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();

        return res.status(200).json({
            success: true,
            feedback: feedbackEntries.map((entry) => ({
                _id: String(entry._id),
                productId: entry.productId,
                orderId: entry.orderId,
                selectedSize: entry.selectedSize,
                recommendedSize: entry.recommendedSize,
                feedback: entry.feedback,
                source: entry.source,
                confidence: entry.confidence,
                modelVersion: entry.modelVersion,
                createdAt: entry.createdAt
            }))
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch fit feedback history');
        return res.status(500).json({
            success: false,
            message: 'Unable to fetch fit feedback history'
        });
    }
};

const getFitAnalytics = async (req, res) => {
    try {
        const metrics = await getFitAnalyticsOverview();

        return res.status(200).json({
            success: true,
            metrics
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch fit analytics');
        return res.status(500).json({
            success: false,
            message: 'Unable to fetch fit analytics right now'
        });
    }
};

const getFitInsights = async (req, res) => {
    try {
        const { productId } = req.params;
        const product = await productModel.findById(productId).lean();

        if (!product || product.status === 'archived') {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        assertFitAssistantAvailableForProduct(product);

        const insights = await getFitInsightsForProduct({ product });

        return res.status(200).json({
            success: true,
            insights
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch fit insights');
        return res.status(500).json({
            success: false,
            message: 'Unable to fetch fit insights right now'
        });
    }
};

const submitFitFeedback = async (req, res) => {
    try {
        const {
            productId,
            orderId,
            selectedSize,
            recommendedSize,
            feedback,
            source = 'manual',
            confidence = null,
            modelVersion = 'rule-engine-v1'
        } = req.body;
        const [product, deliveredOrder] = await Promise.all([
            productModel.findById(productId).select('_id status').lean(),
            orderModel.findOne({
                _id: orderId,
                userId: req.userId,
                status: 'Delivered',
                'items._id': productId
            }).lean()
        ]);

        if (!product || product.status === 'archived') {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        if (!deliveredOrder) {
            return res.status(403).json({
                success: false,
                message: 'A delivered order for this product is required before submitting fit feedback'
            });
        }

        const fitFeedback = await fitFeedbackModel.create({
            userId: req.userId,
            productId,
            orderId,
            selectedSize,
            recommendedSize,
            feedback,
            source,
            confidence: confidence === null ? null : Number(confidence),
            modelVersion
        });

        return res.status(201).json({
            success: true,
            message: 'Fit feedback recorded successfully',
            feedbackId: String(fitFeedback._id)
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to store fit feedback');
        const statusCode = error?.code === 11000 ? 409 : 500;
        const message =
            error?.code === 11000
                ? 'You have already submitted fit feedback for this order'
                : 'Unable to record fit feedback';

        return res.status(statusCode).json({ success: false, message });
    }
};

export { analyzeBody, getFitAnalytics, getFitInsights, listUserFitFeedback, recommendSize, submitFitFeedback };
