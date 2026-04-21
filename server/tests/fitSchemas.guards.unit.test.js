import { describe, expect, it } from 'vitest';

import { fitBodyScanSchema, fitRecommendSchema } from '../validation/schemas.js';

describe('fit Zod schemas — server-side guards', () => {
    describe('fitRecommendSchema bodyFeatures bounds', () => {
        const baseInput = {
            productId: 'a'.repeat(24),
            userMetrics: { heightCm: 170, weightKg: 65 }
        };

        it('rejects body ratio above the upper bound', () => {
            const result = fitRecommendSchema.safeParse({
                ...baseInput,
                bodyFeatures: { shoulderRatio: 1e6 }
            });
            expect(result.success).toBe(false);
        });

        it('rejects unknown body feature fields (.strict)', () => {
            const result = fitRecommendSchema.safeParse({
                ...baseInput,
                bodyFeatures: { shoulderRatio: 0.5, evil: '$ne' }
            });
            expect(result.success).toBe(false);
        });

        it('accepts realistic body ratios', () => {
            const result = fitRecommendSchema.safeParse({
                ...baseInput,
                bodyFeatures: { shoulderRatio: 0.55, hipRatio: 0.6, torsoRatio: 0.5, scanQuality: 0.8 }
            });
            expect(result.success).toBe(true);
        });
    });

    describe('fitBodyScanSchema landmark strictness', () => {
        it('rejects landmark objects with unknown fields', () => {
            const result = fitBodyScanSchema.safeParse({
                heightCm: 170,
                landmarks: [
                    { x: 0.1, y: 0.1, payload: 'oops' },
                    { x: 0.2, y: 0.2 },
                    { x: 0.3, y: 0.3 },
                    { x: 0.4, y: 0.4 }
                ]
            });
            expect(result.success).toBe(false);
        });

        it('accepts well-formed landmarks', () => {
            const result = fitBodyScanSchema.safeParse({
                heightCm: 170,
                landmarks: [
                    { x: 0.1, y: 0.1, visibility: 0.9 },
                    { x: 0.2, y: 0.2 },
                    { x: 0.3, y: 0.3 },
                    { x: 0.4, y: 0.4 }
                ]
            });
            expect(result.success).toBe(true);
        });

        it('rejects oversized base64 image payloads', () => {
            // Default cap (no env set) is 1_680_000.
            const result = fitBodyScanSchema.safeParse({
                heightCm: 170,
                imageBase64: `data:image/png;base64,${'A'.repeat(1_700_000)}`
            });
            expect(result.success).toBe(false);
        });
    });
});
