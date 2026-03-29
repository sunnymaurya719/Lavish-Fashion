import { afterEach, describe, expect, it, vi } from 'vitest';

const analyzeBodyScanMock = vi.fn();

vi.mock('../services/fitBodyScanService.js', () => ({
    analyzeBodyScan: analyzeBodyScanMock
}));

const { analyzeBody } = await import('../controllers/fitController.js');

const createRes = () => {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
};

describe('fitController analyzeBody', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('returns analyzed body features from the body scan service', async () => {
        analyzeBodyScanMock.mockResolvedValueOnce({
            bodyFeatures: {
                shoulderRatio: 1.02,
                hipRatio: 0.99,
                torsoRatio: 1.08,
                scanQuality: 0.52
            },
            meta: {
                source: 'image_heuristic',
                imageStored: false
            }
        });

        const req = {
            body: {
                heightCm: 175,
                weightKg: 72,
                imageBase64: 'data:image/jpeg;base64,abc'
            },
            requestId: 'req_123',
            log: { error: vi.fn() }
        };
        const res = createRes();

        await analyzeBody(req, res);

        expect(analyzeBodyScanMock).toHaveBeenCalledWith({
            scanInput: {
                heightCm: 175,
                weightKg: 72,
                imageBase64: 'data:image/jpeg;base64,abc',
                landmarks: []
            },
            requestId: 'req_123',
            log: req.log
        });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            bodyFeatures: {
                shoulderRatio: 1.02,
                hipRatio: 0.99,
                torsoRatio: 1.08,
                scanQuality: 0.52
            },
            meta: {
                source: 'image_heuristic',
                imageStored: false
            }
        });
    });

    it('returns a service error when body scan analysis is unavailable', async () => {
        analyzeBodyScanMock.mockRejectedValueOnce(Object.assign(new Error('Camera-based body scan is unavailable right now.'), { statusCode: 503 }));

        const req = {
            body: {
                heightCm: 175,
                landmarks: [{ x: 0.4, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.42, y: 0.7 }, { x: 0.58, y: 0.7 }]
            },
            requestId: 'req_456',
            log: { error: vi.fn() }
        };
        const res = createRes();

        await analyzeBody(req, res);

        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: 'Camera-based body scan is unavailable right now.'
        });
    });
});
