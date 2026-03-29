import { afterEach, describe, expect, it, vi } from 'vitest';

const fitFeedbackFindMock = vi.fn();

vi.mock('../models/fitFeedbackModel.js', () => ({
    default: {
        find: fitFeedbackFindMock
    }
}));

const { listUserFitFeedback } = await import('../controllers/fitController.js');

const createRes = () => {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
};

describe('fitController listUserFitFeedback', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('returns fit feedback history for the authenticated user', async () => {
        const leanMock = vi.fn().mockResolvedValueOnce([
            {
                _id: '507f1f77bcf86cd799439099',
                productId: '507f1f77bcf86cd799439011',
                orderId: '507f1f77bcf86cd799439012',
                selectedSize: 'L',
                recommendedSize: 'M',
                feedback: 'too_large',
                source: 'manual',
                confidence: 0.82,
                modelVersion: 'rule-engine-v1',
                createdAt: new Date('2026-03-28T10:00:00.000Z')
            }
        ]);
        const sortMock = vi.fn(() => ({ lean: leanMock }));
        fitFeedbackFindMock.mockReturnValueOnce({ sort: sortMock });

        const req = {
            userId: 'user_1',
            log: { error: vi.fn() }
        };
        const res = createRes();

        await listUserFitFeedback(req, res);

        expect(fitFeedbackFindMock).toHaveBeenCalledWith({ userId: 'user_1' });
        expect(sortMock).toHaveBeenCalledWith({ createdAt: -1 });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            feedback: [
                {
                    _id: '507f1f77bcf86cd799439099',
                    productId: '507f1f77bcf86cd799439011',
                    orderId: '507f1f77bcf86cd799439012',
                    selectedSize: 'L',
                    recommendedSize: 'M',
                    feedback: 'too_large',
                    source: 'manual',
                    confidence: 0.82,
                    modelVersion: 'rule-engine-v1',
                    createdAt: new Date('2026-03-28T10:00:00.000Z')
                }
            ]
        });
    });
});
