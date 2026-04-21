/**
 * MongoDB aggregation backend for the Fit Analytics dashboard.
 *
 * Pushes the heavy work (orders × items × feedback) into the database so the
 * Node process never has to load full collections into memory. Products stay
 * on the JS side because `fitProfileSummary.completenessRatio` and `ready`
 * are derived in code via `normalizeProductFitData`, not stored fields.
 *
 * The returned shape is a direct match for the legacy in-memory function
 * `_getFitAnalyticsOverviewLegacy` so `FitAnalytics.jsx` consumes it verbatim.
 */

import fitFeedbackModel from '../models/fitFeedbackModel.js';
import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
import { isMlServiceConfigured } from './mlGatewayService.js';
import { normalizeProductFitData } from './productFitProfileService.js';
import {
    getFitConfidenceMin,
    getFitRolloutPercent,
    isFitAssistantGloballyEnabled,
    isFitCameraGloballyEnabled
} from './fitRuntimeService.js';

const RECENT_TREND_DAYS = 7;
const TOP_PRODUCTS_LIMIT = 6;
const INCOMPLETE_PRODUCTS_LIMIT = 8;
const RECENT_FEEDBACK_LIMIT = 8;
const TOP_PRODUCTS_AGG_FETCH = 64; // pull a few extra so feedback merge can re-sort

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

/**
 * Reconstructs the day-bucket map (UTC) covering the trailing `days` window
 * ending at `now`, then folds aggregated daily counts into it.
 */
const assembleTrend = ({ assistedByDay, feedbackByDay, now, days = RECENT_TREND_DAYS }) => {
    const today = toDate(now) || new Date();
    const trendMap = new Map();

    for (let offset = days - 1; offset >= 0; offset -= 1) {
        const date = new Date(
            Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset)
        );
        const key = getDayKey(date);
        trendMap.set(key, {
            key,
            label: dayFormatter.format(date),
            assistedItems: 0,
            feedbackEntries: 0
        });
    }

    Object.entries(assistedByDay).forEach(([dayKey, count]) => {
        const bucket = trendMap.get(dayKey);
        if (bucket) {
            bucket.assistedItems = Number(count) || 0;
        }
    });

    Object.entries(feedbackByDay).forEach(([dayKey, count]) => {
        const bucket = trendMap.get(dayKey);
        if (bucket) {
            bucket.feedbackEntries = Number(count) || 0;
        }
    });

    return Array.from(trendMap.values());
};

const buildOrdersAggregationPipeline = ({ confidenceMin, highConfidenceMin, trendStartDate }) => [
    { $match: { 'items.fitAssistant.recommendedSize': { $exists: true, $ne: '' } } },
    { $unwind: '$items' },
    { $match: { 'items.fitAssistant.recommendedSize': { $exists: true, $ne: '' } } },
    {
        $project: {
            _id: 0,
            productId: '$items._id',
            orderId: '$_id',
            selectedSize: { $ifNull: ['$items.size', ''] },
            recommendedSize: '$items.fitAssistant.recommendedSize',
            confidence: '$items.fitAssistant.confidence',
            modelVersion: { $ifNull: ['$items.fitAssistant.modelVersion', ''] },
            sourceRaw: { $ifNull: ['$items.fitAssistant.source', 'manual'] },
            statusRaw: { $ifNull: ['$status', ''] },
            date: '$date'
        }
    },
    {
        $project: {
            productId: 1,
            orderId: 1,
            selectedSize: 1,
            recommendedSize: 1,
            confidence: 1,
            modelVersion: 1,
            isOverride: {
                $and: [
                    { $ne: ['$selectedSize', ''] },
                    { $ne: ['$selectedSize', '$recommendedSize'] }
                ]
            },
            isDelivered: { $eq: [{ $toLower: '$statusRaw' }, 'delivered'] },
            sourceKey: {
                $cond: [
                    { $in: ['$sourceRaw', ['manual', 'camera', 'hybrid']] },
                    '$sourceRaw',
                    'manual'
                ]
            },
            engineKey: {
                $switch: {
                    branches: [
                        { case: { $eq: ['$modelVersion', ''] }, then: 'unknown' },
                        {
                            case: {
                                $regexMatch: {
                                    input: { $toLower: '$modelVersion' },
                                    regex: /^rule-engine/
                                }
                            },
                            then: 'rule_engine'
                        },
                        {
                            case: {
                                $regexMatch: {
                                    input: { $toLower: '$modelVersion' },
                                    regex: /^ml-fallback/
                                }
                            },
                            then: 'ml_heuristic_fallback'
                        }
                    ],
                    default: 'model_backed'
                }
            },
            confidenceBand: {
                $switch: {
                    branches: [
                        { case: { $eq: ['$confidence', null] }, then: 'unknown' },
                        { case: { $gte: ['$confidence', highConfidenceMin] }, then: 'high' },
                        { case: { $gte: ['$confidence', confidenceMin] }, then: 'medium' }
                    ],
                    default: 'low'
                }
            },
            dayKey: {
                $cond: [
                    { $ifNull: ['$date', false] },
                    { $dateToString: { format: '%Y-%m-%d', date: { $toDate: '$date' } } },
                    ''
                ]
            }
        }
    },
    {
        $facet: {
            totals: [
                {
                    $group: {
                        _id: null,
                        count: { $sum: 1 },
                        deliveredCount: { $sum: { $cond: ['$isDelivered', 1, 0] } },
                        overrideCount: { $sum: { $cond: ['$isOverride', 1, 0] } }
                    }
                }
            ],
            sourceCounts: [{ $group: { _id: '$sourceKey', count: { $sum: 1 } } }],
            engineCounts: [{ $group: { _id: '$engineKey', count: { $sum: 1 } } }],
            confidenceCounts: [{ $group: { _id: '$confidenceBand', count: { $sum: 1 } } }],
            productStats: [
                {
                    $group: {
                        _id: '$productId',
                        assistedItems: { $sum: 1 },
                        deliveredItems: { $sum: { $cond: ['$isDelivered', 1, 0] } },
                        overrideCount: { $sum: { $cond: ['$isOverride', 1, 0] } }
                    }
                },
                { $sort: { assistedItems: -1 } },
                { $limit: TOP_PRODUCTS_AGG_FETCH }
            ],
            deliveredItemPairs: [
                { $match: { isDelivered: true } },
                { $group: { _id: { orderId: '$orderId', productId: '$productId' } } },
                { $count: 'n' }
            ],
            trendCounts: [
                { $match: { dayKey: { $gte: trendStartDate } } },
                { $group: { _id: '$dayKey', count: { $sum: 1 } } }
            ]
        }
    }
];

const buildFeedbackAggregationPipeline = ({ trendStartDate }) => [
    {
        $facet: {
            totals: [{ $count: 'n' }],
            outcomeCounts: [{ $group: { _id: '$feedback', count: { $sum: 1 } } }],
            perProduct: [
                {
                    $group: {
                        _id: '$productId',
                        feedbackEntries: { $sum: 1 },
                        perfectFeedbackEntries: {
                            $sum: { $cond: [{ $eq: ['$feedback', 'perfect'] }, 1, 0] }
                        }
                    }
                }
            ],
            trendCounts: [
                {
                    $match: {
                        createdAt: { $type: 'date' }
                    }
                },
                {
                    $project: {
                        dayKey: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }
                    }
                },
                { $match: { dayKey: { $gte: trendStartDate } } },
                { $group: { _id: '$dayKey', count: { $sum: 1 } } }
            ],
            recent: [
                { $sort: { createdAt: -1 } },
                { $limit: RECENT_FEEDBACK_LIMIT },
                {
                    $project: {
                        _id: 1,
                        productId: 1,
                        orderId: 1,
                        feedback: 1,
                        source: 1,
                        confidence: 1,
                        selectedSize: 1,
                        recommendedSize: 1,
                        modelVersion: 1,
                        createdAt: 1
                    }
                }
            ]
        }
    }
];

const countsArrayToMap = (entries = []) => {
    const map = {};
    entries.forEach((entry) => {
        if (entry && entry._id != null) {
            map[String(entry._id)] = Number(entry.count || 0);
        }
    });
    return map;
};

const trendCountsArrayToMap = (entries = []) => {
    const map = {};
    entries.forEach((entry) => {
        if (entry && entry._id) {
            map[String(entry._id)] = Number(entry.count || 0);
        }
    });
    return map;
};

const getConfidenceThresholds = () => {
    const confidenceMin = getFitConfidenceMin();
    return {
        confidenceMin,
        highConfidenceMin: Math.min(0.85, confidenceMin + 0.18)
    };
};

/**
 * Aggregation-backed equivalent of `getFitAnalyticsOverview`.
 *
 * Only orders + feedback are pushed to Mongo. Products stay in JS because the
 * readiness math (`fitProfileSummary`) is derived in code, not stored.
 */
const getFitAnalyticsAggregated = async ({ now = new Date() } = {}) => {
    const trendStartDate = (() => {
        const today = toDate(now) || new Date();
        const start = new Date(
            Date.UTC(
                today.getUTCFullYear(),
                today.getUTCMonth(),
                today.getUTCDate() - (RECENT_TREND_DAYS - 1)
            )
        );
        return start.toISOString().slice(0, 10);
    })();

    const { confidenceMin, highConfidenceMin } = getConfidenceThresholds();

    const [products, ordersFacetResult, feedbackFacetResult] = await Promise.all([
        productModel
            .find({})
            .select('_id name category status sizes fitEnabled sizeScale fitProfile updatedAt')
            .lean(),
        orderModel
            .aggregate(
                buildOrdersAggregationPipeline({ confidenceMin, highConfidenceMin, trendStartDate })
            )
            .allowDiskUse(true),
        fitFeedbackModel
            .aggregate(buildFeedbackAggregationPipeline({ trendStartDate }))
            .allowDiskUse(true)
    ]);

    const ordersFacet = ordersFacetResult?.[0] || {};
    const feedbackFacet = feedbackFacetResult?.[0] || {};

    const ordersTotals = ordersFacet.totals?.[0] || {
        count: 0,
        deliveredCount: 0,
        overrideCount: 0
    };
    const sourceCounts = countsArrayToMap(ordersFacet.sourceCounts);
    const engineCounts = countsArrayToMap(ordersFacet.engineCounts);
    const confidenceCounts = countsArrayToMap(ordersFacet.confidenceCounts);
    const productStatsAgg = Array.isArray(ordersFacet.productStats) ? ordersFacet.productStats : [];
    const feedbackEligibleDeliveredItems = Number(ordersFacet.deliveredItemPairs?.[0]?.n || 0);
    const assistedByDay = trendCountsArrayToMap(ordersFacet.trendCounts);

    const feedbackTotal = Number(feedbackFacet.totals?.[0]?.n || 0);
    const feedbackOutcomeCounts = countsArrayToMap(feedbackFacet.outcomeCounts);
    const feedbackPerProduct = new Map(
        (feedbackFacet.perProduct || []).map((entry) => [
            String(entry._id || ''),
            {
                feedbackEntries: Number(entry.feedbackEntries || 0),
                perfectFeedbackEntries: Number(entry.perfectFeedbackEntries || 0)
            }
        ])
    );
    const feedbackByDay = trendCountsArrayToMap(feedbackFacet.trendCounts);
    const recentFeedbackRaw = Array.isArray(feedbackFacet.recent) ? feedbackFacet.recent : [];

    // ── Product-side normalization (same as legacy path) ──────────────────
    const normalizedProducts = (Array.isArray(products) ? products : []).map((product) =>
        normalizeProductFitData(product)
    );
    const productMap = new Map(normalizedProducts.map((product) => [String(product._id), product]));
    const allIncompleteProducts = normalizedProducts
        .filter((product) => product.fitEnabled && !product.fitProfileSummary?.ready)
        .sort((left, right) => {
            const ratioDifference =
                Number(left.fitProfileSummary?.completenessRatio || 0) -
                Number(right.fitProfileSummary?.completenessRatio || 0);
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
            readinessPercent: Math.round(
                Number(product.fitProfileSummary?.completenessRatio || 0) * 100
            ),
            completedSizes: Number(product.fitProfileSummary?.completedSizes || 0),
            totalSizes: Number(product.fitProfileSummary?.totalSizes || 0),
            measurementTemplate: normalizeString(
                product.fitProfileSummary?.measurementTemplate ||
                    product.fitProfile?.measurementTemplate
            ),
            updatedAt: product.updatedAt || null
        }));

    // ── Top products: merge order productStats with feedback per-product ──
    const enrichedProductStats = productStatsAgg.map((entry) => {
        const productId = String(entry._id || '');
        const product = productMap.get(productId);
        const feedbackForProduct = feedbackPerProduct.get(productId) || {
            feedbackEntries: 0,
            perfectFeedbackEntries: 0
        };

        return {
            productId,
            name: product?.name || 'Archived product',
            category: product?.category || 'Unknown',
            assistedItems: Number(entry.assistedItems || 0),
            deliveredItems: Number(entry.deliveredItems || 0),
            overrideCount: Number(entry.overrideCount || 0),
            feedbackEntries: feedbackForProduct.feedbackEntries,
            perfectFeedbackEntries: feedbackForProduct.perfectFeedbackEntries
        };
    });

    const topProducts = enrichedProductStats
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
            perfectFeedbackRate: roundRate(
                entry.perfectFeedbackEntries / Math.max(entry.feedbackEntries, 1)
            )
        }));

    // ── Recent feedback (already sorted desc by createdAt by aggregation) ──
    const recentFeedback = recentFeedbackRaw.map((entry) => ({
        id: String(entry._id || ''),
        productId: String(entry.productId || ''),
        orderId: String(entry.orderId || ''),
        feedback: normalizeString(entry.feedback),
        source: normalizeString(entry.source),
        confidence:
            entry.confidence === null || entry.confidence === undefined
                ? null
                : Number(entry.confidence),
        selectedSize: normalizeString(entry.selectedSize),
        recommendedSize: normalizeString(entry.recommendedSize),
        modelVersion: normalizeString(entry.modelVersion),
        createdAt: entry.createdAt || null,
        productName: productMap.get(String(entry.productId || ''))?.name || 'Archived product'
    }));

    const assistedOrderItems = Number(ordersTotals.count || 0);
    const deliveredAssistedItems = Number(ordersTotals.deliveredCount || 0);
    const overrideCount = Number(ordersTotals.overrideCount || 0);

    const perfectFeedbackEntries = Number(feedbackOutcomeCounts.perfect || 0);
    const cameraSourceCount =
        Number(sourceCounts.camera || 0) + Number(sourceCounts.hybrid || 0);

    return {
        generatedAt: new Date(now).toISOString(),
        runtime: {
            fitAssistantEnabled: isFitAssistantGloballyEnabled(),
            fitCameraEnabled: isFitCameraGloballyEnabled(),
            fitRolloutPercent: getFitRolloutPercent(),
            fitConfidenceMin: confidenceMin,
            mlServiceConfigured: isMlServiceConfigured(),
            calibrationActive: Boolean(normalizeString(process.env.ML_CALIBRATION_PATH)),
            redisConfigured: Boolean(normalizeString(process.env.REDIS_URL))
        },
        summary: {
            totalCatalogProducts: normalizedProducts.length,
            fitEnabledProducts: normalizedProducts.filter((product) => product.fitEnabled).length,
            readyProducts: normalizedProducts.filter((product) => product.fitProfileSummary?.ready)
                .length,
            activeReadyProducts: normalizedProducts.filter(
                (product) => product.status === 'active' && product.fitProfileSummary?.ready
            ).length,
            incompleteFitProducts: allIncompleteProducts.length,
            assistedOrderItems,
            deliveredAssistedItems,
            feedbackEligibleDeliveredItems,
            feedbackEntries: feedbackTotal,
            feedbackCoverageRate: roundRate(
                feedbackTotal / Math.max(feedbackEligibleDeliveredItems, 1)
            ),
            overrideRate: roundRate(overrideCount / Math.max(assistedOrderItems, 1)),
            perfectFeedbackRate: roundRate(
                perfectFeedbackEntries / Math.max(feedbackTotal, 1)
            ),
            cameraAssistedRate: roundRate(cameraSourceCount / Math.max(assistedOrderItems, 1)),
            ruleEngineRate: roundRate(
                Number(engineCounts.rule_engine || 0) / Math.max(assistedOrderItems, 1)
            )
        },
        breakdowns: {
            recommendationSource: createBreakdown(RECOMMENDATION_SOURCE_OPTIONS, sourceCounts),
            engine: createBreakdown(ENGINE_OPTIONS, engineCounts),
            confidence: createBreakdown(CONFIDENCE_OPTIONS, confidenceCounts),
            feedback: createBreakdown(FEEDBACK_OPTIONS, feedbackOutcomeCounts)
        },
        trend: assembleTrend({ assistedByDay, feedbackByDay, now }),
        topProducts,
        incompleteProducts,
        recentFeedback
    };
};

export {
    getFitAnalyticsAggregated,
    buildOrdersAggregationPipeline,
    buildFeedbackAggregationPipeline,
    RECENT_TREND_DAYS,
    TOP_PRODUCTS_LIMIT,
    INCOMPLETE_PRODUCTS_LIMIT,
    RECENT_FEEDBACK_LIMIT
};
