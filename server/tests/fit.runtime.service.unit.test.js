import { afterEach, describe, expect, it } from 'vitest';

const {
    assertFitAssistantAvailableForProduct,
    getFitConfidenceMin,
    getFitRolloutPercent,
    isFitRolloutActiveForProduct
} = await import('../services/fitRuntimeService.js');

describe('fitRuntimeService', () => {
    afterEach(() => {
        delete process.env.FIT_ASSISTANT_ENABLED;
        delete process.env.FIT_ENABLE_PERCENT;
        delete process.env.FIT_CONFIDENCE_MIN;
    });

    it('normalizes rollout and confidence env values into safe ranges', () => {
        process.env.FIT_ENABLE_PERCENT = '150';
        process.env.FIT_CONFIDENCE_MIN = '0.2';

        expect(getFitRolloutPercent()).toBe(100);
        expect(getFitConfidenceMin()).toBe(0.35);
    });

    it('disables fit assistant access when rollout percent is zero', () => {
        process.env.FIT_ASSISTANT_ENABLED = 'true';
        process.env.FIT_ENABLE_PERCENT = '0';

        expect(isFitRolloutActiveForProduct('507f1f77bcf86cd799439011')).toBe(false);
        expect(() =>
            assertFitAssistantAvailableForProduct({
                _id: '507f1f77bcf86cd799439011',
                fitEnabled: true
            })
        ).toThrow('Fit assistant is not enabled for this product yet.');
    });
});
