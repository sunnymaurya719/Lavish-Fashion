import { afterEach, describe, expect, it, vi } from 'vitest';

const findByIdMock = vi.fn();
const findByIdAndUpdateMock = vi.fn();

const userModelMock = {
    findById: findByIdMock,
    findByIdAndUpdate: findByIdAndUpdateMock
};

vi.mock('../models/userModel.js', () => ({
    default: userModelMock
}));

const { addToCart, updateCart, removeFromCart, getUserCart } = await import('../controllers/cartController.js');

const createRes = () => {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
};

describe('cartController unit tests', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('returns 404 when adding to cart for a non-existent user', async () => {
        findByIdMock.mockResolvedValueOnce(null);

        const req = {
            userId: 'user_1',
            body: { itemId: 'item_1', size: 'M' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await addToCart(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(findByIdAndUpdateMock).not.toHaveBeenCalled();
    });

    it('creates missing cart item map on updateCart and persists quantity', async () => {
        findByIdMock.mockResolvedValueOnce({ cartData: {} });

        const req = {
            userId: 'user_1',
            body: { itemId: 'item_1', size: 'L', quantity: 3 },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await updateCart(req, res);

        expect(findByIdAndUpdateMock).toHaveBeenCalledWith('user_1', {
            cartData: {
                item_1: {
                    L: 3
                }
            }
        });
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 404 when removing an item not present in cart', async () => {
        findByIdMock.mockResolvedValueOnce({ cartData: { item_1: { M: 1 } } });

        const req = {
            userId: 'user_1',
            body: { itemId: 'item_2', size: 'M' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await removeFromCart(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(findByIdAndUpdateMock).not.toHaveBeenCalled();
    });

    it('returns 404 when fetching cart for unknown user', async () => {
        findByIdMock.mockResolvedValueOnce(null);

        const req = {
            userId: 'missing_user',
            body: {},
            log: { error: vi.fn() }
        };
        const res = createRes();

        await getUserCart(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });
});
