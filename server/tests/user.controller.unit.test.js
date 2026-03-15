import { afterEach, describe, expect, it, vi } from 'vitest';

const findOneMock = vi.fn();
const saveMock = vi.fn();
const userModelConstructorMock = vi.fn(() => ({ save: saveMock }));

userModelConstructorMock.findOne = findOneMock;

vi.mock('../models/userModel.js', () => ({
    default: userModelConstructorMock
}));

const compareMock = vi.fn();
const hashMock = vi.fn();

vi.mock('bcrypt', () => ({
    default: {
        compare: compareMock,
        hash: hashMock
    }
}));

const signMock = vi.fn(() => 'signed_token');

vi.mock('jsonwebtoken', () => ({
    default: {
        sign: signMock
    }
}));

const { loginUser, registerUser, adminLogin } = await import('../controllers/userController.js');

const createRes = () => {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
};

describe('userController unit tests', () => {
    afterEach(() => {
        vi.clearAllMocks();
        process.env.ADMIN_EMAIL = 'admin@example.com';
        process.env.ADMIN_PASSWORD = 'StrongAdminPass123';
        process.env.JWT_SECRET = 'test_secret';
    });

    it('returns 400 for missing login credentials', async () => {
        const req = { body: { email: '', password: '' }, log: { error: vi.fn() } };
        const res = createRes();

        await loginUser(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('returns 404 when login user does not exist', async () => {
        findOneMock.mockResolvedValueOnce(null);
        const req = { body: { email: 'user@example.com', password: 'SecurePass123' }, log: { error: vi.fn() } };
        const res = createRes();

        await loginUser(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('returns 401 for incorrect password', async () => {
        findOneMock.mockResolvedValueOnce({ _id: 'user_1', password: 'hash' });
        compareMock.mockResolvedValueOnce(false);

        const req = { body: { email: 'user@example.com', password: 'WrongPass123' }, log: { error: vi.fn() } };
        const res = createRes();

        await loginUser(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('returns 409 when registering an existing user', async () => {
        findOneMock.mockResolvedValueOnce({ _id: 'existing_user' });

        const req = {
            body: { name: 'User', email: 'user@example.com', password: 'SecurePass123' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await registerUser(req, res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('returns 400 for invalid registration email', async () => {
        findOneMock.mockResolvedValueOnce(null);

        const req = {
            body: { name: 'User', email: 'invalid_email', password: 'SecurePass123' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await registerUser(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('returns 401 for invalid admin credentials', async () => {
        const req = {
            body: { email: 'wrong@example.com', password: 'wrong-password' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await adminLogin(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });
});