import { afterEach, describe, expect, it, vi } from 'vitest';

const findByIdAndUpdateMock = vi.fn();
const requestMlSizeRecommendationMock = vi.fn();
const isMlServiceConfiguredMock = vi.fn();
const getFitInsightsForProductMock = vi.fn();
const getCachedFitRecommendationMock = vi.fn();
const setCachedFitRecommendationMock = vi.fn();

vi.mock('../models/userModel.js', () => ({
    default: {
        findByIdAndUpdate: findByIdAndUpdateMock
    }
}));

vi.mock('../services/mlGatewayService.js', () => ({
    isMlServiceConfigured: isMlServiceConfiguredMock,
    requestMlSizeRecommendation: requestMlSizeRecommendationMock
}));

vi.mock('../services/fitInsightsService.js', () => ({
    getFitInsightsForProduct: getFitInsightsForProductMock
}));

vi.mock('../services/fitCacheService.js', () => ({
    getCachedFitRecommendation: getCachedFitRecommendationMock,
    setCachedFitRecommendation: setCachedFitRecommendationMock
}));

const { recommendSizeForProduct } = await import('../services/fitRecommendationService.js');

const fitReadyProduct = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Structured Poplin Shirt',
    category: 'Men',
    subCategory: 'Topwear',
    sizes: ['S', 'M', 'L'],
    fitEnabled: true,
    sizeScale: 'alpha',
    fitProfile: {
        measurementTemplate: 'topwear',
        fitBias: 'true_to_size',
        stretchScore: 0.25,
        measurementUnit: 'cm',
        sizeMeasurements: [
            { size: 'S', chest: 100, shoulder: 43, garmentLength: 69 },
            { size: 'M', chest: 110, shoulder: 45.5, garmentLength: 73 },
            { size: 'L', chest: 116, shoulder: 47.5, garmentLength: 76 }
        ]
    }
};

const userMetrics = {
    heightCm: 175,
    weightKg: 72,
    preferredFit: 'regular'
};

describe('fitRecommendationService', () => {
    afterEach(() => {
        vi.clearAllMocks();
        delete process.env.FIT_CONFIDENCE_MIN;
    });

    it('returns the ML service response when the gateway succeeds', async () => {
        isMlServiceConfiguredMock.mockReturnValueOnce(true);
        getCachedFitRecommendationMock.mockResolvedValueOnce(null);
        getFitInsightsForProductMock.mockResolvedValueOnce({
            fitBias: 'runs_small',
            crowdSignal: 'Shoppers close to your measurements usually buy M.',
            dominantSize: 'M',
            feedbackCount: 6,
            crowdSampleCount: 4
        });
        requestMlSizeRecommendationMock.mockResolvedValueOnce({
            source: 'ml',
            recommendation: {
                size: 'M',
                confidence: 0.91,
                reason: 'Best fit from the remote ML service.',
                range: ''
            },
            alternatives: [{ size: 'L', confidence: 0.64 }],
            insights: {
                fitBias: 'true_to_size',
                crowdSignal: ''
            },
            meta: {
                modelVersion: 'xgb-fit-v0',
                fitTemplate: 'topwear',
                predictionSource: 'xgboost_regressor',
                modelLoaded: true
            }
        });

        const recommendation = await recommendSizeForProduct({
            product: fitReadyProduct,
            userMetrics,
            bodyFeatures: {
                shoulderRatio: 1.04,
                hipRatio: 0.96,
                torsoRatio: 1.08,
                scanQuality: 0.88
            },
            userId: 'user_1',
            requestId: 'req_1',
            log: {
                warn: vi.fn()
            }
        });

        expect(recommendation.source).toBe('ml');
        expect(recommendation.recommendation.size).toBe('M');
        expect(recommendation.insights).toEqual({
            fitBias: 'runs_small',
            crowdSignal: 'Shoppers close to your measurements usually buy M.',
            dominantSize: 'M',
            feedbackCount: 6,
            crowdSampleCount: 4
        });
        expect(recommendation.meta.fallbackReason).toBe('');
        expect(recommendation.meta.mlConfigured).toBe(true);
        expect(recommendation.meta.cacheHit).toBe(false);
        expect(setCachedFitRecommendationMock).toHaveBeenCalledOnce();
        expect(findByIdAndUpdateMock).toHaveBeenCalledWith(
            'user_1',
            expect.objectContaining({
                $set: expect.objectContaining({
                    'fitProfile.heightCm': 175,
                    'fitProfile.weightKg': 72,
                    'fitProfile.preferredFit': 'regular',
                    'fitProfile.bodyFeatures.shoulderRatio': 1.04,
                    'fitProfile.bodyFeatures.hipRatio': 0.96,
                    'fitProfile.bodyFeatures.torsoRatio': 1.08,
                    'fitProfile.bodyFeatures.scanQuality': 0.88,
                    'fitProfile.lastScanAt': expect.any(Date)
                })
            }),
            { runValidators: true }
        );
    });

    it('falls back to the rule engine when the ML gateway fails', async () => {
        isMlServiceConfiguredMock.mockReturnValueOnce(true);
        getCachedFitRecommendationMock.mockResolvedValueOnce(null);
        getFitInsightsForProductMock.mockResolvedValueOnce({
            fitBias: 'true_to_size',
            crowdSignal: '',
            dominantSize: '',
            feedbackCount: 0,
            crowdSampleCount: 0
        });
        requestMlSizeRecommendationMock.mockRejectedValueOnce(Object.assign(new Error('Timed out'), { fallbackReason: 'ml_timeout' }));

        const log = {
            warn: vi.fn()
        };

        const recommendation = await recommendSizeForProduct({
            product: fitReadyProduct,
            userMetrics,
            requestId: 'req_2',
            log
        });

        expect(recommendation.source).toBe('rule_engine');
        expect(recommendation.recommendation.size).toBe('M');
        expect(recommendation.insights.fitBias).toBe('true_to_size');
        expect(recommendation.meta.fallbackReason).toBe('ml_timeout');
        expect(recommendation.meta.mlConfigured).toBe(true);
        expect(recommendation.meta.cacheHit).toBe(false);
        expect(setCachedFitRecommendationMock).toHaveBeenCalledOnce();
        expect(log.warn).toHaveBeenCalled();
        expect(findByIdAndUpdateMock).not.toHaveBeenCalled();
    });

    it('returns the cached recommendation when available', async () => {
        isMlServiceConfiguredMock.mockReturnValueOnce(true);
        getCachedFitRecommendationMock.mockResolvedValueOnce({
            source: 'ml',
            recommendation: {
                size: 'M',
                confidence: 0.94,
                reason: 'Cached result.',
                range: ''
            },
            alternatives: [{ size: 'L', confidence: 0.62 }],
            insights: {
                fitBias: 'runs_small',
                crowdSignal: 'Shoppers close to your measurements usually buy M.'
            },
            meta: {
                modelVersion: 'xgb-fit-v1',
                fitTemplate: 'topwear',
                predictionSource: 'xgboost_regressor',
                modelLoaded: true,
                cacheHit: false
            }
        });

        const recommendation = await recommendSizeForProduct({
            product: fitReadyProduct,
            userMetrics,
            userId: 'user_2',
            log: {
                info: vi.fn(),
                warn: vi.fn()
            }
        });

        expect(recommendation.source).toBe('ml');
        expect(recommendation.meta.cacheHit).toBe(true);
        expect(requestMlSizeRecommendationMock).not.toHaveBeenCalled();
        expect(getFitInsightsForProductMock).not.toHaveBeenCalled();
        expect(setCachedFitRecommendationMock).not.toHaveBeenCalled();
        expect(findByIdAndUpdateMock).toHaveBeenCalledOnce();
    });

    it('marks a recommendation as low confidence when it falls below the store threshold', async () => {
        process.env.FIT_CONFIDENCE_MIN = '0.7';
        isMlServiceConfiguredMock.mockReturnValueOnce(true);
        getCachedFitRecommendationMock.mockResolvedValueOnce(null);
        getFitInsightsForProductMock.mockResolvedValueOnce({
            fitBias: 'true_to_size',
            crowdSignal: '',
            dominantSize: '',
            feedbackCount: 0,
            crowdSampleCount: 0
        });
        requestMlSizeRecommendationMock.mockResolvedValueOnce({
            source: 'ml',
            recommendation: {
                size: 'M',
                confidence: 0.54,
                reason: 'Best available match from the ML service.',
                range: ''
            },
            alternatives: [{ size: 'L', confidence: 0.49 }],
            insights: {
                fitBias: 'true_to_size',
                crowdSignal: ''
            },
            meta: {
                modelVersion: 'xgb-fit-v1',
                fitTemplate: 'topwear',
                predictionSource: 'xgboost_regressor',
                modelLoaded: true
            }
        });

        const recommendation = await recommendSizeForProduct({
            product: fitReadyProduct,
            userMetrics
        });

        expect(recommendation.meta.lowConfidence).toBe(true);
        expect(recommendation.meta.confidenceMin).toBe(0.7);
        expect(recommendation.recommendation.range).toBe('M-L');
        expect(recommendation.meta.confidenceGuidance).toContain('camera scan');
    });
});
