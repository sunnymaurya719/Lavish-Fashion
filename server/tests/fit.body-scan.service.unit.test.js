import { afterEach, describe, expect, it, vi } from 'vitest';

const isMlServiceConfiguredMock = vi.fn();
const requestMlBodyScanAnalysisMock = vi.fn();
const getCachedBodyScanAnalysisMock = vi.fn();
const setCachedBodyScanAnalysisMock = vi.fn();

vi.mock('../services/mlGatewayService.js', () => ({
    isMlServiceConfigured: isMlServiceConfiguredMock,
    requestMlBodyScanAnalysis: requestMlBodyScanAnalysisMock
}));

vi.mock('../services/fitCacheService.js', () => ({
    getCachedBodyScanAnalysis: getCachedBodyScanAnalysisMock,
    setCachedBodyScanAnalysis: setCachedBodyScanAnalysisMock
}));

const { analyzeBodyScan } = await import('../services/fitBodyScanService.js');

describe('fitBodyScanService', () => {
    afterEach(() => {
        vi.resetAllMocks();
    });

    it('returns the cached scan analysis before checking ML availability', async () => {
        getCachedBodyScanAnalysisMock.mockResolvedValueOnce({
            bodyFeatures: {
                shoulderRatio: 1.01,
                hipRatio: 0.97,
                torsoRatio: 1.08,
                scanQuality: 0.86
            },
            meta: {
                source: 'ml_service',
                imageStored: false,
                cacheHit: false
            }
        });
        isMlServiceConfiguredMock.mockReturnValueOnce(false);

        const result = await analyzeBodyScan({
            scanInput: {
                heightCm: 175,
                landmarks: [{ x: 0.4, y: 0.2 }]
            },
            log: {
                info: vi.fn()
            }
        });

        expect(result.bodyFeatures.scanQuality).toBe(0.86);
        expect(result.meta.cacheHit).toBe(true);
        expect(requestMlBodyScanAnalysisMock).not.toHaveBeenCalled();
    });

    it('stores a fresh scan analysis in cache after the ML service succeeds', async () => {
        getCachedBodyScanAnalysisMock.mockResolvedValueOnce(null);
        isMlServiceConfiguredMock.mockReturnValueOnce(true);
        requestMlBodyScanAnalysisMock.mockResolvedValueOnce({
            bodyFeatures: {
                shoulderRatio: 1.02,
                hipRatio: 0.98,
                torsoRatio: 1.09,
                scanQuality: 0.91
            },
            meta: {
                source: 'ml_service',
                imageStored: false
            }
        });

        const scanInput = {
            heightCm: 175,
            weightKg: 72,
            imageBase64: 'data:image/jpeg;base64,abc'
        };

        const result = await analyzeBodyScan({
            scanInput,
            requestId: 'req_scan_1',
            log: {
                info: vi.fn(),
                warn: vi.fn()
            }
        });

        expect(result.meta.cacheHit).toBe(false);
        expect(setCachedBodyScanAnalysisMock).toHaveBeenCalledWith({
            scanInput,
            result: {
                bodyFeatures: {
                    shoulderRatio: 1.02,
                    hipRatio: 0.98,
                    torsoRatio: 1.09,
                    scanQuality: 0.91
                },
                meta: {
                    source: 'ml_service',
                    imageStored: false
                }
            },
            requestId: 'req_scan_1',
            log: expect.any(Object)
        });
    });
});
