import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getMlCircuitSnapshot,
    requestMlBodyScanAnalysis,
    requestMlSizeRecommendation
} from '../services/mlGatewayService.js';

const ORIGINAL_FETCH = globalThis.fetch;

const flushCircuit = async () => {
    // Send three failing requests so the breaker latches open.
    globalThis.fetch = vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ message: 'unavailable' })
    }));
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            await requestMlSizeRecommendation({
                product: { _id: 'p1', sizes: ['M'] },
                userMetrics: { heightCm: 170, weightKg: 65 },
                requestId: `r-${attempt}`
            });
        } catch (error) {
            // Expected — circuit accumulates failure counts.
            void error;
        }
    }
};

const PRODUCT_FIXTURE = { _id: 'p1', sizes: ['M'] };
const USER_METRICS_FIXTURE = { heightCm: 170, weightKg: 65 };

describe('mlGatewayService — operational hardening', () => {
    beforeEach(() => {
        process.env.ML_SERVICE_URL = 'http://ml.example.test';
        delete process.env.ML_BODY_SCAN_MAX_BASE64_CHARS;
    });

    afterEach(async () => {
        // Reset circuit between tests by simulating a successful call.
        globalThis.fetch = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                source: 'ml',
                recommendation: { size: 'M', confidence: 0.7, reason: '', range: '' },
                alternatives: [],
                insights: { fitBias: 'true_to_size', crowdSignal: '' },
                meta: {
                    modelVersion: 'xgb-fit-v1',
                    fitTemplate: 'topwear',
                    predictionSource: 'xgboost_regressor',
                    modelLoaded: true
                }
            })
        }));
        try {
            await requestMlSizeRecommendation({
                product: PRODUCT_FIXTURE,
                userMetrics: USER_METRICS_FIXTURE,
                requestId: 'reset'
            });
        } catch (error) {
            void error;
        }
        globalThis.fetch = ORIGINAL_FETCH;
        delete process.env.ML_SERVICE_URL;
    });

    it('emits a structured circuit.open log when the breaker latches', async () => {
        const logger = { info: vi.fn(), warn: vi.fn() };

        globalThis.fetch = vi.fn(async () => ({
            ok: false,
            status: 502,
            json: async () => ({ message: 'bad gateway' })
        }));

        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                await requestMlSizeRecommendation({
                    product: PRODUCT_FIXTURE,
                    userMetrics: USER_METRICS_FIXTURE,
                    requestId: `r-${attempt}`,
                    log: logger
                });
            } catch (error) {
                void error;
            }
        }

        const openLogs = logger.warn.mock.calls.filter(
            ([entry]) => entry?.event === 'fit.ml.circuit.open'
        );
        expect(openLogs.length).toBeGreaterThanOrEqual(1);
        expect(openLogs[0][0]).toMatchObject({
            event: 'fit.ml.circuit.open',
            reason: 'ml_http_5xx',
            consecutiveFailureCount: 3
        });

        const snapshot = getMlCircuitSnapshot();
        expect(snapshot.isOpen).toBe(true);
        expect(snapshot.consecutiveFailureCount).toBeGreaterThanOrEqual(3);
        expect(snapshot.openCount).toBeGreaterThanOrEqual(1);
    });

    it('emits a circuit.close log on the next successful response', async () => {
        await flushCircuit();

        const logger = { info: vi.fn(), warn: vi.fn() };
        globalThis.fetch = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                source: 'ml',
                recommendation: { size: 'M', confidence: 0.7, reason: '', range: '' },
                alternatives: [],
                insights: { fitBias: 'true_to_size', crowdSignal: '' },
                meta: {
                    modelVersion: 'xgb-fit-v1',
                    fitTemplate: 'topwear',
                    predictionSource: 'xgboost_regressor',
                    modelLoaded: true
                }
            })
        }));

        // Force-clear the open window to avoid the 30s wait.
        const snapshot = getMlCircuitSnapshot();
        expect(snapshot.isOpen).toBe(true);
        // Travel past the open window using fake timers.
        vi.useFakeTimers();
        vi.setSystemTime(new Date(Date.now() + snapshot.msUntilHalfOpen + 10));

        await requestMlSizeRecommendation({
            product: PRODUCT_FIXTURE,
            userMetrics: USER_METRICS_FIXTURE,
            requestId: 'r-recover',
            log: logger
        });
        vi.useRealTimers();

        const closeLogs = logger.info.mock.calls.filter(
            ([entry]) => entry?.event === 'fit.ml.circuit.close'
        );
        expect(closeLogs.length).toBe(1);
        expect(closeLogs[0][0]).toMatchObject({ event: 'fit.ml.circuit.close' });
        expect(getMlCircuitSnapshot().isOpen).toBe(false);
    });

    it('rejects oversized body-scan payloads before any network call', async () => {
        process.env.ML_BODY_SCAN_MAX_BASE64_CHARS = '32';
        const logger = { info: vi.fn(), warn: vi.fn() };
        const fetchMock = vi.fn();
        globalThis.fetch = fetchMock;

        await expect(
            requestMlBodyScanAnalysis({
                heightCm: 170,
                weightKg: 65,
                imageBase64: 'x'.repeat(64),
                requestId: 'r-big',
                log: logger
            })
        ).rejects.toMatchObject({
            fallbackReason: 'ml_body_scan_payload_too_large',
            statusCode: 413
        });

        expect(fetchMock).not.toHaveBeenCalled();
        const sizeLogs = logger.warn.mock.calls.filter(
            ([entry]) => entry?.event === 'fit.ml.body_scan.payload_too_large'
        );
        expect(sizeLogs.length).toBe(1);
        expect(sizeLogs[0][0]).toMatchObject({
            imageBase64Length: 64,
            maxBase64Chars: 32
        });
    });

    it('accepts body-scan payloads at or under the configured limit', async () => {
        process.env.ML_BODY_SCAN_MAX_BASE64_CHARS = '64';
        globalThis.fetch = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                bodyFeatures: {
                    shoulderRatio: 0.5,
                    hipRatio: 0.5,
                    torsoRatio: 0.5,
                    scanQuality: 0.7
                },
                meta: { source: 'image_heuristic', imageStored: false }
            })
        }));

        const result = await requestMlBodyScanAnalysis({
            heightCm: 170,
            weightKg: 65,
            imageBase64: 'x'.repeat(32),
            requestId: 'r-ok'
        });
        expect(result.bodyFeatures.scanQuality).toBe(0.7);
    });
});
