import { describe, expect, it } from 'vitest';

import { annotateModelVersionForFallback } from '../services/mlGatewayService.js';

describe('annotateModelVersionForFallback', () => {
    it('passes through model version when prediction succeeded', () => {
        expect(annotateModelVersionForFallback('xgb-fit-v1', 'xgboost_regressor')).toBe('xgb-fit-v1');
    });

    it('prepends ml-fallback marker when ml-service fell back internally', () => {
        expect(annotateModelVersionForFallback('xgb-fit-v1', 'heuristic_fallback')).toBe(
            'ml-fallback:xgb-fit-v1'
        );
        expect(annotateModelVersionForFallback('xgb-fit-v1', 'model_length_mismatch')).toBe(
            'ml-fallback:xgb-fit-v1'
        );
        expect(annotateModelVersionForFallback('xgb-fit-v1', 'model_error')).toBe(
            'ml-fallback:xgb-fit-v1'
        );
    });

    it('does not double-prefix an already-annotated version', () => {
        expect(
            annotateModelVersionForFallback('ml-fallback:xgb-fit-v1', 'heuristic_fallback')
        ).toBe('ml-fallback:xgb-fit-v1');
    });

    it('falls back to bare ml-fallback when version is empty', () => {
        expect(annotateModelVersionForFallback('', 'model_error')).toBe('ml-fallback');
    });

    it('truncates the annotated version to 60 characters', () => {
        const long = 'x'.repeat(80);
        const annotated = annotateModelVersionForFallback(long, 'heuristic_fallback');
        expect(annotated.length).toBeLessThanOrEqual(60);
        expect(annotated.startsWith('ml-fallback:')).toBe(true);
    });
});
