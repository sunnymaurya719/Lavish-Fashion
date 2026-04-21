import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const productFindMock = vi.fn();
const orderAggregateMock = vi.fn();
const fitFeedbackAggregateMock = vi.fn();

beforeAll(() => {
    process.env.FIT_ANALYTICS_USE_AGGREGATION = 'true';
});

vi.mock('../models/productModel.js', () => ({
    default: { find: productFindMock }
}));

vi.mock('../models/orderModel.js', () => ({
    default: { aggregate: orderAggregateMock }
}));

vi.mock('../models/fitFeedbackModel.js', () => ({
    default: { aggregate: fitFeedbackAggregateMock }
}));

vi.mock('../services/mlGatewayService.js', () => ({
    isMlServiceConfigured: vi.fn(() => true)
}));

vi.mock('../services/fitRuntimeService.js', () => ({
    getFitConfidenceMin: vi.fn(() => 0.6),
    getFitRolloutPercent: vi.fn(() => 50),
    isFitAssistantGloballyEnabled: vi.fn(() => true),
    isFitCameraGloballyEnabled: vi.fn(() => false)
}));

const { getFitAnalyticsAggregated } = await import(
    '../services/fitAnalyticsAggregationService.js'
);
const { getFitAnalyticsOverview } = await import('../services/fitAnalyticsService.js');

const buildProductSelectChain = (value) => ({
    select: vi.fn(() => ({
        lean: vi.fn().mockResolvedValueOnce(value)
    }))
});

const buildAggregateChain = (value) => ({
    allowDiskUse: vi.fn(() => Promise.resolve(value))
});

const productFixture = [
    {
        _id: '507f1f77bcf86cd799439011',
        name: 'Tailored Shirt',
        category: 'Men',
        status: 'active',
        sizes: ['S', 'M', 'L'],
        fitEnabled: true,
        sizeScale: 'alpha',
        updatedAt: new Date('2026-03-28T09:00:00.000Z'),
        fitProfile: {
            measurementTemplate: 'topwear',
            fitBias: 'true_to_size',
            stretchScore: 0.25,
            sizeMeasurements: [
                { size: 'S', chest: 92, shoulder: 42, garmentLength: 69 },
                { size: 'M', chest: 98, shoulder: 44, garmentLength: 71 },
                { size: 'L', chest: 104, shoulder: 46, garmentLength: 73 }
            ]
        }
    },
    {
        _id: '507f1f77bcf86cd799439012',
        name: 'Relaxed Tee',
        category: 'Men',
        status: 'active',
        sizes: ['S', 'M', 'L'],
        fitEnabled: true,
        sizeScale: 'alpha',
        updatedAt: new Date('2026-03-27T09:00:00.000Z'),
        fitProfile: {
            measurementTemplate: 'topwear',
            fitBias: 'true_to_size',
            stretchScore: 0.4,
            sizeMeasurements: [{ size: 'S', chest: 90 }]
        }
    }
];

const ordersFacetFixture = [
    {
        totals: [{ _id: null, count: 6, deliveredCount: 4, overrideCount: 1 }],
        sourceCounts: [
            { _id: 'manual', count: 4 },
            { _id: 'camera', count: 2 }
        ],
        engineCounts: [
            { _id: 'model_backed', count: 5 },
            { _id: 'rule_engine', count: 1 }
        ],
        confidenceCounts: [
            { _id: 'high', count: 3 },
            { _id: 'medium', count: 2 },
            { _id: 'low', count: 1 }
        ],
        productStats: [
            {
                _id: '507f1f77bcf86cd799439011',
                assistedItems: 5,
                deliveredItems: 4,
                overrideCount: 1
            },
            {
                _id: '507f1f77bcf86cd799439012',
                assistedItems: 1,
                deliveredItems: 0,
                overrideCount: 0
            }
        ],
        deliveredItemPairs: [{ n: 4 }],
        trendCounts: [
            { _id: '2026-03-26', count: 2 },
            { _id: '2026-03-27', count: 3 },
            { _id: '2026-03-28', count: 1 }
        ]
    }
];

const feedbackFacetFixture = [
    {
        totals: [{ n: 4 }],
        outcomeCounts: [
            { _id: 'perfect', count: 3 },
            { _id: 'too_small', count: 1 }
        ],
        perProduct: [
            {
                _id: '507f1f77bcf86cd799439011',
                feedbackEntries: 3,
                perfectFeedbackEntries: 2
            },
            {
                _id: '507f1f77bcf86cd799439012',
                feedbackEntries: 1,
                perfectFeedbackEntries: 1
            }
        ],
        trendCounts: [
            { _id: '2026-03-27', count: 2 },
            { _id: '2026-03-28', count: 2 }
        ],
        recent: [
            {
                _id: 'fb-1',
                productId: '507f1f77bcf86cd799439011',
                orderId: 'order-1',
                feedback: 'perfect',
                source: 'manual',
                confidence: 0.78,
                selectedSize: 'M',
                recommendedSize: 'M',
                modelVersion: 'xgb-fit-v1',
                createdAt: new Date('2026-03-28T08:00:00.000Z')
            }
        ]
    }
];

describe('fitAnalyticsAggregationService', () => {
    afterEach(() => {
        vi.clearAllMocks();
        delete process.env.REDIS_URL;
    });

    it('shapes the analytics overview from $facet aggregation results', async () => {
        productFindMock.mockReturnValueOnce(buildProductSelectChain(productFixture));
        orderAggregateMock.mockReturnValueOnce(buildAggregateChain(ordersFacetFixture));
        fitFeedbackAggregateMock.mockReturnValueOnce(buildAggregateChain(feedbackFacetFixture));

        const metrics = await getFitAnalyticsAggregated({
            now: new Date('2026-03-28T10:00:00.000Z')
        });

        expect(orderAggregateMock).toHaveBeenCalledTimes(1);
        expect(fitFeedbackAggregateMock).toHaveBeenCalledTimes(1);

        // Top-level shape parity with the legacy implementation.
        expect(Object.keys(metrics).sort()).toEqual(
            [
                'breakdowns',
                'generatedAt',
                'incompleteProducts',
                'recentFeedback',
                'runtime',
                'summary',
                'topProducts',
                'trend'
            ].sort()
        );

        // Summary numbers come straight from the aggregation totals.
        expect(metrics.summary.assistedOrderItems).toBe(6);
        expect(metrics.summary.deliveredAssistedItems).toBe(4);
        expect(metrics.summary.feedbackEntries).toBe(4);
        expect(metrics.summary.feedbackEligibleDeliveredItems).toBe(4);
        expect(metrics.summary.overrideRate).toBeCloseTo(1 / 6, 4);
        expect(metrics.summary.perfectFeedbackRate).toBeCloseTo(0.75, 4);
        expect(metrics.summary.cameraAssistedRate).toBeCloseTo(2 / 6, 4);
        expect(metrics.summary.ruleEngineRate).toBeCloseTo(1 / 6, 4);

        // Breakdowns preserve the canonical option vocabulary.
        expect(metrics.breakdowns.engine.map((entry) => entry.key)).toEqual([
            'model_backed',
            'ml_heuristic_fallback',
            'rule_engine',
            'unknown'
        ]);
        expect(metrics.breakdowns.engine.find((entry) => entry.key === 'model_backed').count).toBe(
            5
        );
        expect(metrics.breakdowns.engine.find((entry) => entry.key === 'rule_engine').count).toBe(
            1
        );

        // Top products merge order productStats with feedback per-product.
        expect(metrics.topProducts[0]).toMatchObject({
            productId: '507f1f77bcf86cd799439011',
            name: 'Tailored Shirt',
            assistedItems: 5,
            feedbackEntries: 3
        });
        expect(metrics.topProducts[0].perfectFeedbackRate).toBeCloseTo(2 / 3, 4);

        // Trend covers the trailing 7 UTC days ending at `now`.
        expect(metrics.trend).toHaveLength(7);
        expect(metrics.trend.map((bucket) => bucket.key)).toEqual([
            '2026-03-22',
            '2026-03-23',
            '2026-03-24',
            '2026-03-25',
            '2026-03-26',
            '2026-03-27',
            '2026-03-28'
        ]);
        const day28 = metrics.trend.find((bucket) => bucket.key === '2026-03-28');
        expect(day28).toMatchObject({ assistedItems: 1, feedbackEntries: 2 });

        // Recent feedback is enriched with product name from the product map.
        expect(metrics.recentFeedback[0]).toMatchObject({
            id: 'fb-1',
            productName: 'Tailored Shirt',
            feedback: 'perfect'
        });

        // Runtime block surfaces the same flags as the legacy path.
        expect(metrics.runtime).toMatchObject({
            fitAssistantEnabled: true,
            fitCameraEnabled: false,
            fitRolloutPercent: 50,
            fitConfidenceMin: 0.6,
            mlServiceConfigured: true
        });
    });

    it('routes through getFitAnalyticsOverview when FIT_ANALYTICS_USE_AGGREGATION is on', async () => {
        productFindMock.mockReturnValueOnce(buildProductSelectChain(productFixture));
        orderAggregateMock.mockReturnValueOnce(buildAggregateChain(ordersFacetFixture));
        fitFeedbackAggregateMock.mockReturnValueOnce(buildAggregateChain(feedbackFacetFixture));

        const metrics = await getFitAnalyticsOverview({
            now: new Date('2026-03-28T10:00:00.000Z')
        });

        expect(orderAggregateMock).toHaveBeenCalledTimes(1);
        expect(metrics.summary.assistedOrderItems).toBe(6);
    });

    it('returns zeroed metrics when collections are empty', async () => {
        productFindMock.mockReturnValueOnce(buildProductSelectChain([]));
        orderAggregateMock.mockReturnValueOnce(buildAggregateChain([{}]));
        fitFeedbackAggregateMock.mockReturnValueOnce(buildAggregateChain([{}]));

        const metrics = await getFitAnalyticsAggregated({
            now: new Date('2026-03-28T10:00:00.000Z')
        });

        expect(metrics.summary.assistedOrderItems).toBe(0);
        expect(metrics.summary.feedbackEntries).toBe(0);
        expect(metrics.topProducts).toEqual([]);
        expect(metrics.recentFeedback).toEqual([]);
        expect(metrics.trend).toHaveLength(7);
        expect(
            metrics.trend.every((bucket) => bucket.assistedItems === 0 && bucket.feedbackEntries === 0)
        ).toBe(true);
    });
});
