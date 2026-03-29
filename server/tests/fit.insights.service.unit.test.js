import { afterEach, describe, expect, it, vi } from 'vitest';

const fitFeedbackFindMock = vi.fn();
const orderFindMock = vi.fn();
const userFindMock = vi.fn();

vi.mock('../models/fitFeedbackModel.js', () => ({
    default: {
        find: fitFeedbackFindMock
    }
}));

vi.mock('../models/orderModel.js', () => ({
    default: {
        find: orderFindMock
    }
}));

vi.mock('../models/userModel.js', () => ({
    default: {
        find: userFindMock
    }
}));

const { getFitInsightsForProduct } = await import('../services/fitInsightsService.js');

const fitReadyProduct = {
    _id: '507f1f77bcf86cd799439011',
    fitProfile: {
        fitBias: 'true_to_size'
    }
};

const createSelectChain = (value) => ({
    select: vi.fn(() => ({
        lean: vi.fn().mockResolvedValueOnce(value)
    }))
});

describe('fitInsightsService', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('derives a runs-small trend and generic crowd signal from feedback and delivered orders', async () => {
        fitFeedbackFindMock.mockReturnValueOnce(
            createSelectChain([
                { userId: 'user_1', selectedSize: 'M', feedback: 'too_small' },
                { userId: 'user_2', selectedSize: 'M', feedback: 'too_small' },
                { userId: 'user_3', selectedSize: 'M', feedback: 'too_small' },
                { userId: 'user_4', selectedSize: 'L', feedback: 'perfect' }
            ])
        );
        orderFindMock.mockReturnValueOnce(
            createSelectChain([
                { items: [{ _id: '507f1f77bcf86cd799439011', size: 'M' }] },
                { items: [{ _id: '507f1f77bcf86cd799439011', size: 'M' }] },
                { items: [{ _id: '507f1f77bcf86cd799439011', size: 'M' }] },
                { items: [{ _id: '507f1f77bcf86cd799439011', size: 'M' }] },
                { items: [{ _id: '507f1f77bcf86cd799439011', size: 'M' }] },
                { items: [{ _id: '507f1f77bcf86cd799439011', size: 'M' }] },
                { items: [{ _id: '507f1f77bcf86cd799439011', size: 'L' }] },
                { items: [{ _id: '507f1f77bcf86cd799439011', size: 'M' }] }
            ])
        );
        userFindMock.mockReturnValueOnce(
            createSelectChain([])
        );

        const insights = await getFitInsightsForProduct({
            product: fitReadyProduct,
            userMetrics: { heightCm: 175, weightKg: 72 }
        });

        expect(insights).toEqual({
            fitBias: 'runs_small',
            crowdSignal: 'Most shoppers buy M in this style.',
            dominantSize: 'M',
            feedbackCount: 4,
            crowdSampleCount: 8
        });
    });

    it('prefers a personalized crowd signal when similar shoppers have enough data', async () => {
        fitFeedbackFindMock.mockReturnValueOnce(
            createSelectChain([
                { userId: 'user_1', selectedSize: 'M', feedback: 'perfect' },
                { userId: 'user_2', selectedSize: 'M', feedback: 'perfect' },
                { userId: 'user_3', selectedSize: 'L', feedback: 'perfect' }
            ])
        );
        orderFindMock.mockReturnValueOnce(
            createSelectChain([
                { items: [{ _id: '507f1f77bcf86cd799439011', size: 'L' }] }
            ])
        );
        userFindMock.mockReturnValueOnce(
            createSelectChain([
                { _id: 'user_1', fitProfile: { heightCm: 174, weightKg: 71 } },
                { _id: 'user_2', fitProfile: { heightCm: 177, weightKg: 74 } },
                { _id: 'user_3', fitProfile: { heightCm: 180, weightKg: 76 } }
            ])
        );

        const insights = await getFitInsightsForProduct({
            product: fitReadyProduct,
            userMetrics: { heightCm: 175, weightKg: 72 }
        });

        expect(insights.crowdSignal).toBe('Shoppers close to your measurements usually buy M.');
        expect(insights.crowdSampleCount).toBe(3);
        expect(insights.fitBias).toBe('true_to_size');
    });
});
