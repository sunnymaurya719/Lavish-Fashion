import { describe, expect, it } from 'vitest';

import fitFeedbackModel from '../models/fitFeedbackModel.js';
import { fitFeedbackSchema } from '../validation/schemas.js';

describe('Improvement 1 — feedback predictionSource captured end-to-end', () => {
    it('Zod fitFeedbackSchema accepts predictionSource', () => {
        const result = fitFeedbackSchema.safeParse({
            productId: 'a'.repeat(24),
            orderId: 'b'.repeat(24),
            selectedSize: 'M',
            recommendedSize: 'M',
            feedback: 'perfect',
            confidence: 0.7,
            modelVersion: 'xgb-fit-v1',
            predictionSource: 'xgboost_regressor'
        });

        expect(result.success).toBe(true);
        expect(result.data.predictionSource).toBe('xgboost_regressor');
    });

    it('Zod fitFeedbackSchema treats predictionSource as optional (legacy clients)', () => {
        const result = fitFeedbackSchema.safeParse({
            productId: 'a'.repeat(24),
            orderId: 'b'.repeat(24),
            selectedSize: 'M',
            recommendedSize: 'M',
            feedback: 'perfect'
        });

        expect(result.success).toBe(true);
        expect(result.data.predictionSource).toBeUndefined();
    });

    it('Zod fitFeedbackSchema rejects oversized predictionSource', () => {
        const result = fitFeedbackSchema.safeParse({
            productId: 'a'.repeat(24),
            orderId: 'b'.repeat(24),
            selectedSize: 'M',
            recommendedSize: 'M',
            feedback: 'perfect',
            predictionSource: 'x'.repeat(64)
        });

        expect(result.success).toBe(false);
    });

    it('Mongoose model declares predictionSource field with sane defaults', () => {
        const path = fitFeedbackModel.schema.path('predictionSource');

        expect(path).toBeDefined();
        expect(path.instance).toBe('String');
        expect(path.options.maxlength).toBe(40);
        expect(path.options.default).toBeNull();
    });
});
