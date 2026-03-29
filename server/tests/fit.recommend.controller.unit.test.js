import { afterEach, describe, expect, it, vi } from 'vitest';

const productFindByIdMock = vi.fn();
const recommendSizeForProductMock = vi.fn();

vi.mock('../models/productModel.js', () => ({
    default: {
        findById: productFindByIdMock
    }
}));

vi.mock('../services/fitRecommendationService.js', () => ({
    recommendSizeForProduct: recommendSizeForProductMock
}));

const { recommendSize } = await import('../controllers/fitController.js');

const createRes = () => {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
};

describe('fitController recommendSize', () => {
    afterEach(() => {
        vi.clearAllMocks();
        delete process.env.FIT_ASSISTANT_ENABLED;
        delete process.env.FIT_ENABLE_PERCENT;
    });

    it('returns 403 when the product is outside the fit rollout', async () => {
        process.env.FIT_ASSISTANT_ENABLED = 'true';
        process.env.FIT_ENABLE_PERCENT = '0';

        productFindByIdMock.mockReturnValueOnce({
            lean: vi.fn().mockResolvedValueOnce({
                _id: '507f1f77bcf86cd799439011',
                fitEnabled: true,
                status: 'active'
            })
        });

        const req = {
            body: {
                productId: '507f1f77bcf86cd799439011',
                userMetrics: {
                    heightCm: 175,
                    weightKg: 72,
                    preferredFit: 'regular'
                }
            },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await recommendSize(req, res);

        expect(recommendSizeForProductMock).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: 'Fit assistant is not enabled for this product yet.'
        });
    });
});
