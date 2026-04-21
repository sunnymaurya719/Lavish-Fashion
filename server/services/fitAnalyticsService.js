import fitFeedbackModel from '../models/fitFeedbackModel.js';
import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
import { getFitAnalyticsAggregated } from './fitAnalyticsAggregationService.js';
import { isMlServiceConfigured } from './mlGatewayService.js';
import { normalizeProductFitData } from './productFitProfileService.js';
import {
    getFitConfidenceMin,
    getFitRolloutPercent,
    isFitAssistantGloballyEnabled,
    isFitCameraGloballyEnabled
} from './fitRuntimeService.js';

/**
 * Routes the analytics overview to either the new aggregation pipeline backend
 * or the legacy in-memory implementation. Defaults to aggregation; set
 * `FIT_ANALYTICS_USE_AGGREGATION=false` to fall back at runtime.
 */
const isAggregationBackendEnabled = () =>
    String(process.env.FIT_ANALYTICS_USE_AGGREGATION ?? '').trim().toLowerCase() !== 'false';

const RECENT_TREND_DAYS = 7;
const TOP_PRODUCTS_LIMIT = 6;
const INCOMPLETE_PRODUCTS_LIMIT = 8;
const RECENT_FEEDBACK_LIMIT = 8;

const RECOMMENDATION_SOURCE_OPTIONS = [
    { key: 'manual', label: 'Manual' },
    { key: 'camera', label: 'Camera' },
    { key: 'hybrid', label: 'Hybrid' }
];
const ENGINE_OPTIONS = [
    { key: 'model_backed', label: 'Model-backed' },
    { key: 'ml_heuristic_fallback', label: 'ML heuristic fallback' },
    { key: 'rule_engine', label: 'Rule engine' },
    { key: 'unknown', label: 'Unknown' }
];
const CONFIDENCE_OPTIONS = [
    { key: 'high', label: 'High' },
    { key: 'medium', label: 'Medium' },
    { key: 'low', label: 'Low' },
    { key: 'unknown', label: 'Unknown' }
];
const FEEDBACK_OPTIONS = [
    { key: 'perfect', label: 'Perfect' },
    { key: 'too_small', label: 'Too small' },
    { key: 'too_large', label: 'Too large' }
];

const dayFormatter = new Intl.DateTimeFormat('en-IN', {
    month: 'short',
    day: 'numeric'
});

const normalizeString = (value) => String(value || '').trim();

const normalizeOptionalNumber = (value) => {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
};

const roundRate = (value) => {
    const numericValue = Number(value || 0);
    return Number.isFinite(numericValue) ? Number(numericValue.toFixed(4)) : 0;
};

const createBreakdown = (options, counts) =>
    options.map((option) => ({
        key: option.key,
        label: option.label,
        count: Number(counts[option.key] || 0)
    }));

const incrementCount = (counts, key) => {
    counts[key] = Number(counts[key] || 0) + 1;
};

const toDate = (value) => {
    if (!value && value !== 0) {
        return null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    const nextDate = new Date(value);
    return Number.isNaN(nextDate.getTime()) ? null : nextDate;
};

const getDayKey = (value) => {
    const date = toDate(value);
    return date ? date.toISOString().slice(0, 10) : '';
};

const isDeliveredStatus = (status) => normalizeString(status).toLowerCase() === 'delivered';

const getConfidenceThresholds = () => {
    const confidenceMin = getFitConfidenceMin();
    return {
        confidenceMin,
        highConfidenceMin: Math.min(0.85, confidenceMin + 0.18)
    };
};

const resolveConfidenceBand = (confidence, thresholds) => {
    const normalizedConfidence = normalizeOptionalNumber(confidence);

    if (normalizedConfidence === null) {
        return 'unknown';
    }

    if (normalizedConfidence >= thresholds.highConfidenceMin) {
        return 'high';
    }

    if (normalizedConfidence >= thresholds.confidenceMin) {
        return 'medium';
    }

    return 'low';
};

const resolveEngineKey = (modelVersion) => {
    const normalizedModelVersion = normalizeString(modelVersion).toLowerCase();

    if (!normalizedModelVersion) {
        return 'unknown';
    }

    if (normalizedModelVersion.startsWith('rule-engine')) {
        return 'rule_engine';
    }

    if (normalizedModelVersion.startsWith('ml-fallback')) {
        return 'ml_heuristic_fallback';
    }

    return 'model_backed';
};

const buildRecentTrend = ({ assistedItems, feedbackEntries, now = new Date(), days = RECENT_TREND_DAYS }) => {
    const today = toDate(now) || new Date();
    const trendMap = new Map();

    for (let offset = days - 1; offset >= 0; offset -= 1) {
        const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
        const key = getDayKey(date);
        trendMap.set(key, {
            key,
            label: dayFormatter.format(date),
            assistedItems: 0,
            feedbackEntries: 0
        });
    }

    assistedItems.forEach((item) => {
        const key = getDayKey(item.date);
        if (trendMap.has(key)) {
            trendMap.get(key).assistedItems += 1;
        }
    });

    feedbackEntries.forEach((entry) => {
        const key = getDayKey(entry.createdAt);
        if (trendMap.has(key)) {
            trendMap.get(key).feedbackEntries += 1;
        }
    });

    return Array.from(trendMap.values());
};

const getFitAnalyticsOverview = async (options = {}) => {
    if (isAggregationBackendEnabled()) {
        return getFitAnalyticsAggregated(options);
    }
    return _getFitAnalyticsOverviewLegacy(options);
};

const _getFitAnalyticsOverviewLegacy = async ({ now = new Date() } = {}) => {
    const [products, orders, feedbackEntries] = await Promise.all([
        productModel.find({}).select('_id name category status sizes fitEnabled sizeScale fitProfile updatedAt').lean(),
        orderModel.find({
            'items.fitAssistant.recommendedSize': { $exists: true, $ne: '' }
        }).select('_id items status date').lean(),
        fitFeedbackModel.find({}).select('_id productId orderId feedback source confidence selectedSize recommendedSize modelVersion createdAt').lean()
    ]);

    const normalizedProducts = (Array.isArray(products) ? products : []).map((product) => normalizeProductFitData(product));
    const productMap = new Map(normalizedProducts.map((product) => [String(product._id), product]));
    const allIncompleteProducts = normalizedProducts
        .filter((product) => product.fitEnabled && !product.fitProfileSummary?.ready)
        .sort((left, right) => {
            const ratioDifference =
                Number(left.fitProfileSummary?.completenessRatio || 0) - Number(right.fitProfileSummary?.completenessRatio || 0);
            if (ratioDifference !== 0) {
                return ratioDifference;
            }

            return normalizeString(left.name).localeCompare(normalizeString(right.name));
        });
    const incompleteProducts = allIncompleteProducts
        .slice(0, INCOMPLETE_PRODUCTS_LIMIT)
        .map((product) => ({
            productId: String(product._id),
            name: product.name,
            category: product.category,
            status: product.status,
            fitEnabled: Boolean(product.fitEnabled),
            readinessPercent: Math.round(Number(product.fitProfileSummary?.completenessRatio || 0) * 100),
            completedSizes: Number(product.fitProfileSummary?.completedSizes || 0),
            totalSizes: Number(product.fitProfileSummary?.totalSizes || 0),
            measurementTemplate: normalizeString(product.fitProfileSummary?.measurementTemplate || product.fitProfile?.measurementTemplate),
            updatedAt: product.updatedAt || null
        }));

    const confidenceThresholds = getConfidenceThresholds();
    const assistedItems = [];

    (Array.isArray(orders) ? orders : []).forEach((order) => {
        (Array.isArray(order?.items) ? order.items : []).forEach((item) => {
            const recommendedSize = normalizeString(item?.fitAssistant?.recommendedSize);

            if (!recommendedSize) {
                return;
            }

            assistedItems.push({
                orderId: String(order?._id || ''),
                productId: String(item?._id || ''),
                selectedSize: normalizeString(item?.size),
                recommendedSize,
                confidence: normalizeOptionalNumber(item?.fitAssistant?.confidence),
                source: ['manual', 'camera', 'hybrid'].includes(normalizeString(item?.fitAssistant?.source))
                    ? normalizeString(item?.fitAssistant?.source)
                    : 'manual',
                modelVersion: normalizeString(item?.fitAssistant?.modelVersion),
                status: normalizeString(order?.status),
                date: order?.date
            });
        });
    });

    const sourceCounts = {};
    const engineCounts = {};
    const confidenceCounts = {};
    const productStats = new Map();
    let deliveredAssistedItems = 0;
    let overrideCount = 0;

    assistedItems.forEach((item) => {
        const confidenceBand = resolveConfidenceBand(item.confidence, confidenceThresholds);
        const engineKey = resolveEngineKey(item.modelVersion);
        const productId = normalizeString(item.productId);
        const product = productMap.get(productId);
        const productStat = productStats.get(productId) || {
            productId,
            name: product?.name || 'Archived product',
            category: product?.category || 'Unknown',
            assistedItems: 0,
            deliveredItems: 0,
            overrideCount: 0,
            feedbackEntries: 0,
            perfectFeedbackEntries: 0
        };

        incrementCount(sourceCounts, item.source);
        incrementCount(engineCounts, engineKey);
        incrementCount(confidenceCounts, confidenceBand);

        productStat.assistedItems += 1;

        if (item.selectedSize && item.selectedSize !== item.recommendedSize) {
            overrideCount += 1;
            productStat.overrideCount += 1;
        }

        if (isDeliveredStatus(item.status)) {
            deliveredAssistedItems += 1;
            productStat.deliveredItems += 1;
        }

        productStats.set(productId, productStat);
    });

    const feedbackCounts = {};
    let perfectFeedbackEntries = 0;

    const normalizedFeedbackEntries = (Array.isArray(feedbackEntries) ? feedbackEntries : [])
        .map((entry) => ({
            id: String(entry?._id || ''),
            productId: String(entry?.productId || ''),
            orderId: String(entry?.orderId || ''),
            feedback: normalizeString(entry?.feedback),
            source: normalizeString(entry?.source),
            confidence: normalizeOptionalNumber(entry?.confidence),
            selectedSize: normalizeString(entry?.selectedSize),
            recommendedSize: normalizeString(entry?.recommendedSize),
            modelVersion: normalizeString(entry?.modelVersion),
            createdAt: entry?.createdAt || null
        }))
        .sort((left, right) => {
            const rightTimestamp = toDate(right.createdAt)?.getTime() || 0;
            const leftTimestamp = toDate(left.createdAt)?.getTime() || 0;
            return rightTimestamp - leftTimestamp;
        });

    normalizedFeedbackEntries.forEach((entry) => {
        incrementCount(feedbackCounts, entry.feedback);

        if (entry.feedback === 'perfect') {
            perfectFeedbackEntries += 1;
        }

        const productStat = productStats.get(entry.productId);
        if (productStat) {
            productStat.feedbackEntries += 1;
            if (entry.feedback === 'perfect') {
                productStat.perfectFeedbackEntries += 1;
            }
        }
    });

    const feedbackEligibleDeliveredItems = new Set(
        assistedItems
            .filter((item) => isDeliveredStatus(item.status))
            .map((item) => `${item.orderId}:${item.productId}`)
    ).size;
    const topProducts = Array.from(productStats.values())
        .sort((left, right) => {
            if (right.assistedItems !== left.assistedItems) {
                return right.assistedItems - left.assistedItems;
            }

            if (right.feedbackEntries !== left.feedbackEntries) {
                return right.feedbackEntries - left.feedbackEntries;
            }

            return left.name.localeCompare(right.name);
        })
        .slice(0, TOP_PRODUCTS_LIMIT)
        .map((entry) => ({
            productId: entry.productId,
            name: entry.name,
            category: entry.category,
            assistedItems: entry.assistedItems,
            deliveredItems: entry.deliveredItems,
            feedbackEntries: entry.feedbackEntries,
            overrideRate: roundRate(entry.overrideCount / Math.max(entry.assistedItems, 1)),
            perfectFeedbackRate: roundRate(entry.perfectFeedbackEntries / Math.max(entry.feedbackEntries, 1))
        }));

    return {
        generatedAt: new Date(now).toISOString(),
        runtime: {
            fitAssistantEnabled: isFitAssistantGloballyEnabled(),
            fitCameraEnabled: isFitCameraGloballyEnabled(),
            fitRolloutPercent: getFitRolloutPercent(),
            fitConfidenceMin: confidenceThresholds.confidenceMin,
            mlServiceConfigured: isMlServiceConfigured(),
            calibrationActive: Boolean(normalizeString(process.env.ML_CALIBRATION_PATH)),
            redisConfigured: Boolean(normalizeString(process.env.REDIS_URL))
        },
        summary: {
            totalCatalogProducts: normalizedProducts.length,
            fitEnabledProducts: normalizedProducts.filter((product) => product.fitEnabled).length,
            readyProducts: normalizedProducts.filter((product) => product.fitProfileSummary?.ready).length,
            activeReadyProducts: normalizedProducts.filter(
                (product) => product.status === 'active' && product.fitProfileSummary?.ready
            ).length,
            incompleteFitProducts: allIncompleteProducts.length,
            assistedOrderItems: assistedItems.length,
            deliveredAssistedItems,
            feedbackEligibleDeliveredItems,
            feedbackEntries: normalizedFeedbackEntries.length,
            feedbackCoverageRate: roundRate(normalizedFeedbackEntries.length / Math.max(feedbackEligibleDeliveredItems, 1)),
            overrideRate: roundRate(overrideCount / Math.max(assistedItems.length, 1)),
            perfectFeedbackRate: roundRate(perfectFeedbackEntries / Math.max(normalizedFeedbackEntries.length, 1)),
            cameraAssistedRate: roundRate(
                ((Number(sourceCounts.camera || 0) + Number(sourceCounts.hybrid || 0)) / Math.max(assistedItems.length, 1))
            ),
            ruleEngineRate: roundRate(Number(engineCounts.rule_engine || 0) / Math.max(assistedItems.length, 1))
        },
        breakdowns: {
            recommendationSource: createBreakdown(RECOMMENDATION_SOURCE_OPTIONS, sourceCounts),
            engine: createBreakdown(ENGINE_OPTIONS, engineCounts),
            confidence: createBreakdown(CONFIDENCE_OPTIONS, confidenceCounts),
            feedback: createBreakdown(FEEDBACK_OPTIONS, feedbackCounts)
        },
        trend: buildRecentTrend({
            assistedItems,
            feedbackEntries: normalizedFeedbackEntries,
            now
        }),
        topProducts,
        incompleteProducts,
        recentFeedback: normalizedFeedbackEntries.slice(0, RECENT_FEEDBACK_LIMIT).map((entry) => ({
            ...entry,
            productName: productMap.get(entry.productId)?.name || 'Archived product'
        }))
    };
};

export { getFitAnalyticsOverview, _getFitAnalyticsOverviewLegacy };
