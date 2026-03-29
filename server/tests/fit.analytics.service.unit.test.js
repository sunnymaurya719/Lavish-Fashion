import { afterEach, describe, expect, it, vi } from 'vitest';

const productFindMock = vi.fn();
const orderFindMock = vi.fn();
const fitFeedbackFindMock = vi.fn();

vi.mock('../models/productModel.js', () => ({
    default: {
        find: productFindMock
    }
}));

vi.mock('../models/orderModel.js', () => ({
    default: {
        find: orderFindMock
    }
}));

vi.mock('../models/fitFeedbackModel.js', () => ({
    default: {
        find: fitFeedbackFindMock
    }
}));

vi.mock('../services/mlGatewayService.js', () => ({
    isMlServiceConfigured: vi.fn(() => true)
}));

vi.mock('../services/fitRuntimeService.js', () => ({
    getFitConfidenceMin: vi.fn(() => 0.6),
    getFitRolloutPercent: vi.fn(() => 55),
    isFitAssistantGloballyEnabled: vi.fn(() => true),
    isFitCameraGloballyEnabled: vi.fn(() => true)
}));

const { getFitAnalyticsOverview } = await import('../services/fitAnalyticsService.js');

const createSelectChain = (value) => ({
    select: vi.fn(() => ({
        lean: vi.fn().mockResolvedValueOnce(value)
    }))
});

describe('fitAnalyticsService', () => {
    afterEach(() => {
        vi.clearAllMocks();
        delete process.env.REDIS_URL;
    });

    it('builds fit monitoring metrics from products, assisted orders, and feedback', async () => {
        process.env.REDIS_URL = 'redis://localhost:6379';

        productFindMock.mockReturnValueOnce(
            createSelectChain([
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
                        sizeMeasurements: [
                            { size: 'S', chest: 90 },
                            { size: 'M', chest: null },
                            { size: 'L', chest: null }
                        ]
                    }
                },
                {
                    _id: '507f1f77bcf86cd799439013',
                    name: 'Weekend Dress',
                    category: 'Women',
                    status: 'draft',
                    sizes: ['S', 'M'],
                    fitEnabled: false,
                    sizeScale: 'alpha',
                    updatedAt: new Date('2026-03-26T09:00:00.000Z'),
                    fitProfile: {
                        measurementTemplate: 'dress',
                        fitBias: 'true_to_size',
                        stretchScore: 0.2,
                        sizeMeasurements: []
                    }
                }
            ])
        );
        orderFindMock.mockReturnValueOnce(
            createSelectChain([
                {
                    _id: '507f1f77bcf86cd799439101',
                    status: 'Delivered',
                    date: Date.parse('2026-03-28T08:00:00.000Z'),
                    items: [
                        {
                            _id: '507f1f77bcf86cd799439011',
                            size: 'M',
                            fitAssistant: {
                                recommendedSize: 'M',
                                confidence: 0.91,
                                source: 'manual',
                                modelVersion: 'xgb-fit-v0'
                            }
                        }
                    ]
                },
                {
                    _id: '507f1f77bcf86cd799439102',
                    status: 'Delivered',
                    date: Date.parse('2026-03-27T08:00:00.000Z'),
                    items: [
                        {
                            _id: '507f1f77bcf86cd799439011',
                            size: 'L',
                            fitAssistant: {
                                recommendedSize: 'M',
                                confidence: 0.55,
                                source: 'hybrid',
                                modelVersion: 'rule-engine-v1'
                            }
                        }
                    ]
                },
                {
                    _id: '507f1f77bcf86cd799439103',
                    status: 'Order Placed',
                    date: Date.parse('2026-03-29T08:00:00.000Z'),
                    items: [
                        {
                            _id: '507f1f77bcf86cd799439012',
                            size: 'S',
                            fitAssistant: {
                                recommendedSize: 'S',
                                confidence: null,
                                source: 'camera',
                                modelVersion: ''
                            }
                        }
                    ]
                }
            ])
        );
        fitFeedbackFindMock.mockReturnValueOnce(
            createSelectChain([
                {
                    _id: '507f1f77bcf86cd799439201',
                    productId: '507f1f77bcf86cd799439011',
                    orderId: '507f1f77bcf86cd799439101',
                    feedback: 'perfect',
                    source: 'manual',
                    confidence: 0.91,
                    selectedSize: 'M',
                    recommendedSize: 'M',
                    modelVersion: 'xgb-fit-v0',
                    createdAt: new Date('2026-03-29T09:00:00.000Z')
                },
                {
                    _id: '507f1f77bcf86cd799439202',
                    productId: '507f1f77bcf86cd799439011',
                    orderId: '507f1f77bcf86cd799439102',
                    feedback: 'too_small',
                    source: 'hybrid',
                    confidence: 0.55,
                    selectedSize: 'L',
                    recommendedSize: 'M',
                    modelVersion: 'rule-engine-v1',
                    createdAt: new Date('2026-03-28T09:00:00.000Z')
                }
            ])
        );

        const metrics = await getFitAnalyticsOverview({
            now: new Date('2026-03-29T12:00:00.000Z')
        });

        expect(metrics.runtime).toEqual({
            fitAssistantEnabled: true,
            fitCameraEnabled: true,
            fitRolloutPercent: 55,
            fitConfidenceMin: 0.6,
            mlServiceConfigured: true,
            redisConfigured: true
        });
        expect(metrics.summary).toEqual({
            totalCatalogProducts: 3,
            fitEnabledProducts: 2,
            readyProducts: 1,
            activeReadyProducts: 1,
            incompleteFitProducts: 1,
            assistedOrderItems: 3,
            deliveredAssistedItems: 2,
            feedbackEligibleDeliveredItems: 2,
            feedbackEntries: 2,
            feedbackCoverageRate: 1,
            overrideRate: 0.3333,
            perfectFeedbackRate: 0.5,
            cameraAssistedRate: 0.6667,
            ruleEngineRate: 0.3333
        });
        expect(metrics.breakdowns.recommendationSource).toEqual([
            { key: 'manual', label: 'Manual', count: 1 },
            { key: 'camera', label: 'Camera', count: 1 },
            { key: 'hybrid', label: 'Hybrid', count: 1 }
        ]);
        expect(metrics.breakdowns.engine).toEqual([
            { key: 'model_backed', label: 'Model-backed', count: 1 },
            { key: 'rule_engine', label: 'Rule engine', count: 1 },
            { key: 'unknown', label: 'Unknown', count: 1 }
        ]);
        expect(metrics.breakdowns.confidence).toEqual([
            { key: 'high', label: 'High', count: 1 },
            { key: 'medium', label: 'Medium', count: 0 },
            { key: 'low', label: 'Low', count: 1 },
            { key: 'unknown', label: 'Unknown', count: 1 }
        ]);
        expect(metrics.breakdowns.feedback).toEqual([
            { key: 'perfect', label: 'Perfect', count: 1 },
            { key: 'too_small', label: 'Too small', count: 1 },
            { key: 'too_large', label: 'Too large', count: 0 }
        ]);
        expect(metrics.topProducts).toEqual([
            {
                productId: '507f1f77bcf86cd799439011',
                name: 'Tailored Shirt',
                category: 'Men',
                assistedItems: 2,
                deliveredItems: 2,
                feedbackEntries: 2,
                overrideRate: 0.5,
                perfectFeedbackRate: 0.5
            },
            {
                productId: '507f1f77bcf86cd799439012',
                name: 'Relaxed Tee',
                category: 'Men',
                assistedItems: 1,
                deliveredItems: 0,
                feedbackEntries: 0,
                overrideRate: 0,
                perfectFeedbackRate: 0
            }
        ]);
        expect(metrics.incompleteProducts).toEqual([
            {
                productId: '507f1f77bcf86cd799439012',
                name: 'Relaxed Tee',
                category: 'Men',
                status: 'active',
                fitEnabled: true,
                readinessPercent: 11,
                completedSizes: 0,
                totalSizes: 3,
                measurementTemplate: 'topwear',
                updatedAt: new Date('2026-03-27T09:00:00.000Z')
            }
        ]);
        expect(metrics.recentFeedback).toEqual([
            expect.objectContaining({
                id: '507f1f77bcf86cd799439201',
                productId: '507f1f77bcf86cd799439011',
                productName: 'Tailored Shirt',
                feedback: 'perfect'
            }),
            expect.objectContaining({
                id: '507f1f77bcf86cd799439202',
                productId: '507f1f77bcf86cd799439011',
                productName: 'Tailored Shirt',
                feedback: 'too_small'
            })
        ]);
        expect(metrics.trend).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ key: '2026-03-27', assistedItems: 1, feedbackEntries: 0 }),
                expect.objectContaining({ key: '2026-03-28', assistedItems: 1, feedbackEntries: 1 }),
                expect.objectContaining({ key: '2026-03-29', assistedItems: 1, feedbackEntries: 1 })
            ])
        );
    });
});
