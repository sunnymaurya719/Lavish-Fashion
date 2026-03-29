import { describe, expect, it } from 'vitest';
import { buildRuleBasedFitRecommendation } from '../services/fitRuleEngineService.js';

describe('fitRuleEngineService', () => {
    it('recommends the middle topwear size for a balanced regular-fit profile', () => {
        const recommendation = buildRuleBasedFitRecommendation({
            product: {
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
            },
            userMetrics: {
                heightCm: 175,
                weightKg: 72,
                preferredFit: 'regular'
            }
        });

        expect(recommendation.recommendation.size).toBe('M');
        expect(recommendation.source).toBe('rule_engine');
        expect(recommendation.recommendation.confidence).toBeGreaterThan(0.6);
        expect(recommendation.alternatives[0].size).toBe('L');
    });

    it('throws when a product is not fit-ready', () => {
        expect(() =>
            buildRuleBasedFitRecommendation({
                product: {
                    _id: '507f1f77bcf86cd799439012',
                    name: 'Incomplete Fit Product',
                    category: 'Women',
                    subCategory: 'Topwear',
                    sizes: ['S', 'M'],
                    fitEnabled: false,
                    fitProfile: {
                        measurementTemplate: 'topwear',
                        fitBias: 'true_to_size',
                        stretchScore: 0.25,
                        measurementUnit: 'cm',
                        sizeMeasurements: []
                    }
                },
                userMetrics: {
                    heightCm: 165,
                    weightKg: 58,
                    preferredFit: 'regular'
                }
            })
        ).toThrow('This product does not have enough fit data for recommendations yet.');
    });
});
