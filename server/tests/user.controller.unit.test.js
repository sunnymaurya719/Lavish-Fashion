import { afterEach, describe, expect, it, vi } from 'vitest';

const findOneMock = vi.fn();
const findByIdMock = vi.fn();
const findByIdAndUpdateMock = vi.fn();
const saveMock = vi.fn();
const userModelConstructorMock = vi.fn(() => ({ save: saveMock }));
const productFindByIdMock = vi.fn();

userModelConstructorMock.findOne = findOneMock;
userModelConstructorMock.findById = findByIdMock;
userModelConstructorMock.findByIdAndUpdate = findByIdAndUpdateMock;

vi.mock('../models/userModel.js', () => ({
    default: userModelConstructorMock
}));

vi.mock('../models/productModel.js', () => ({
    default: {
        findById: productFindByIdMock
    }
}));

const compareMock = vi.fn();
const hashMock = vi.fn();
const determineLoyaltyTierMock = vi.fn(() => ({ currentTier: 'Bronze' }));
const ensureUserReferralCodeMock = vi.fn(async (user) => user?.referralCode || 'LAVI1234');
const generateUniqueReferralCodeMock = vi.fn(async () => 'LAVI1234');
const getUserAvailableLoyaltyPointsMock = vi.fn((user = {}) =>
    Math.max(0, Number(user.loyaltyPoints || 0) - Number(user.reservedLoyaltyPoints || 0))
);
const getUserMarketingPreferencesMock = vi.fn((user = {}) => ({
    emailSubscribed: true,
    promotionalCampaigns: true,
    loyaltyUpdates: true,
    reviewReminders: true,
    ...(user.marketingPreferences || {})
}));
const queueAutomationEmailMock = vi.fn();
const verifyGoogleIdTokenMock = vi.fn();
const isGoogleEmailAuthoritativeMock = vi.fn(() => true);

class GoogleAuthConfigurationErrorMock extends Error {}
class GoogleTokenVerificationErrorMock extends Error {}

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

vi.mock('../services/loyaltyService.js', () => ({
    determineLoyaltyTier: determineLoyaltyTierMock,
    ensureUserReferralCode: ensureUserReferralCodeMock,
    generateUniqueReferralCode: generateUniqueReferralCodeMock,
    getUserAvailableLoyaltyPoints: getUserAvailableLoyaltyPointsMock
}));

vi.mock('../services/marketingAutomationService.js', () => ({
    getUserMarketingPreferences: getUserMarketingPreferencesMock,
    queueAutomationEmail: queueAutomationEmailMock
}));

vi.mock('../services/googleAuthService.js', () => ({
    GoogleAuthConfigurationError: GoogleAuthConfigurationErrorMock,
    GoogleTokenVerificationError: GoogleTokenVerificationErrorMock,
    isGoogleEmailAuthoritative: isGoogleEmailAuthoritativeMock,
    verifyGoogleIdToken: verifyGoogleIdTokenMock
}));

const {
    adminLogin,
    getUserProfile,
    getUserWishlist,
    googleAuthUser,
    loginUser,
    registerUser,
    toggleUserWishlist,
    updateMarketingPreferences,
    updateUserProfile
} = await import('../controllers/userController.js');

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
        determineLoyaltyTierMock.mockReturnValue({ currentTier: 'Bronze' });
        ensureUserReferralCodeMock.mockImplementation(async (user) => user?.referralCode || 'LAVI1234');
        generateUniqueReferralCodeMock.mockResolvedValue('LAVI1234');
        getUserAvailableLoyaltyPointsMock.mockImplementation((user = {}) =>
            Math.max(0, Number(user.loyaltyPoints || 0) - Number(user.reservedLoyaltyPoints || 0))
        );
        getUserMarketingPreferencesMock.mockImplementation((user = {}) => ({
            emailSubscribed: true,
            promotionalCampaigns: true,
            loyaltyUpdates: true,
            reviewReminders: true,
            ...(user.marketingPreferences || {})
        }));
        isGoogleEmailAuthoritativeMock.mockReturnValue(true);
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
        findOneMock.mockResolvedValueOnce({ _id: 'user_1', password: 'hashed_password' });
        compareMock.mockResolvedValueOnce(false);

        const req = { body: { email: 'user@example.com', password: 'WrongPass123' }, log: { error: vi.fn() } };
        const res = createRes();

        await loginUser(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('returns 400 when local login is attempted for a Google-only account', async () => {
        findOneMock.mockResolvedValueOnce({
            _id: 'user_1',
            password: '',
            googleId: 'google_sub_1'
        });

        const req = { body: { email: 'user@example.com', password: 'SecurePass123' }, log: { error: vi.fn() } };
        const res = createRes();

        await loginUser(req, res);

        expect(compareMock).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: 'This account uses Google sign-in. Please continue with Google.'
        });
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

    it('returns 400 for invalid referral code format during registration', async () => {
        findOneMock.mockResolvedValueOnce(null);

        const req = {
            body: {
                name: 'User',
                email: 'user@example.com',
                password: 'SecurePass123',
                referralCode: 'AB12'
            },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await registerUser(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Referral code is invalid' });
        expect(userModelConstructorMock).not.toHaveBeenCalled();
    });

    it('creates a new user from a Google credential', async () => {
        verifyGoogleIdTokenMock.mockResolvedValueOnce({
            sub: 'google_sub_1',
            email: 'googleuser@example.com',
            email_verified: true,
            name: 'Google User',
            picture: 'https://example.com/avatar.png'
        });
        findOneMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
        saveMock.mockResolvedValueOnce({ _id: 'google_user_1', referralCode: 'LAVI1234' });

        const req = {
            body: { credential: 'google_credential' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await googleAuthUser(req, res);

        expect(verifyGoogleIdTokenMock).toHaveBeenCalledWith('google_credential');
        expect(userModelConstructorMock).toHaveBeenCalledWith(
            expect.objectContaining({
                email: 'googleuser@example.com',
                googleId: 'google_sub_1',
                authProvider: 'google',
                avatarUrl: 'https://example.com/avatar.png'
            })
        );
        expect(queueAutomationEmailMock).toHaveBeenCalledWith(
            expect.objectContaining({
                automationKey: 'welcome_signup',
                context: { referralCode: 'LAVI1234' }
            })
        );
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                token: 'signed_token',
                isNewUser: true,
                provider: 'google'
            })
        );
    });

    it('links Google auth to an existing local account when the email is authoritative', async () => {
        verifyGoogleIdTokenMock.mockResolvedValueOnce({
            sub: 'google_sub_2',
            email: 'user@example.com',
            email_verified: true,
            name: 'User Example',
            picture: 'https://example.com/avatar-2.png'
        });
        findOneMock
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                _id: 'user_1',
                email: 'user@example.com',
                password: 'hashed_password',
                googleId: '',
                googleLinkedAt: null,
                avatarUrl: '',
                name: 'User Example'
            });
        findByIdAndUpdateMock.mockResolvedValueOnce({ _id: 'user_1' });

        const req = {
            body: { credential: 'google_credential' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await googleAuthUser(req, res);

        expect(isGoogleEmailAuthoritativeMock).toHaveBeenCalledWith(
            expect.objectContaining({
                sub: 'google_sub_2',
                email: 'user@example.com'
            })
        );
        expect(findByIdAndUpdateMock).toHaveBeenCalledWith(
            'user_1',
            expect.objectContaining({
                googleId: 'google_sub_2',
                googleEmailVerified: true,
                googlePicture: 'https://example.com/avatar-2.png',
                avatarUrl: 'https://example.com/avatar-2.png',
                authProvider: 'hybrid'
            }),
            { new: true, runValidators: true }
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                token: 'signed_token',
                isNewUser: false,
                provider: 'google'
            })
        );
    });

    it('blocks Google linking when the email is not authoritative for an existing local account', async () => {
        verifyGoogleIdTokenMock.mockResolvedValueOnce({
            sub: 'google_sub_3',
            email: 'user@example.com',
            email_verified: true,
            name: 'User Example'
        });
        isGoogleEmailAuthoritativeMock.mockReturnValueOnce(false);
        findOneMock
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                _id: 'user_1',
                email: 'user@example.com',
                password: 'hashed_password',
                googleId: ''
            });

        const req = {
            body: { credential: 'google_credential' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await googleAuthUser(req, res);

        expect(findByIdAndUpdateMock).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: 'This email already has an account. Please sign in with email and password first.'
        });
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

    it('returns 404 when profile user is missing', async () => {
        findByIdMock.mockResolvedValueOnce(null);

        const req = {
            userId: 'missing_user',
            log: { error: vi.fn() }
        };
        const res = createRes();

        await getUserProfile(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('updates the user profile successfully', async () => {
        findByIdMock.mockResolvedValueOnce({
            _id: 'user_1',
            marketingPreferences: {
                promotionalCampaigns: false
            }
        });
        findByIdAndUpdateMock.mockResolvedValueOnce({
            _id: 'user_1',
            name: 'Updated User',
            email: 'user@example.com',
            phone: '+911234567890',
            referralCode: 'LAVI1234',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
            toObject: () => ({
                _id: 'user_1',
                name: 'Updated User',
                email: 'user@example.com',
                phone: '+911234567890',
                referralCode: 'LAVI1234',
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
                updatedAt: new Date('2026-01-02T00:00:00.000Z')
            })
        });

        const req = {
            userId: 'user_1',
            body: { name: 'Updated User', phone: '+911234567890' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await updateUserProfile(req, res);

        expect(findByIdAndUpdateMock).toHaveBeenCalledWith(
            'user_1',
            { name: 'Updated User', phone: '+911234567890' },
            { new: true, runValidators: true }
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                profile: expect.objectContaining({
                    name: 'Updated User',
                    email: 'user@example.com',
                    phone: '+911234567890'
                })
            })
        );
    });

    it('returns the user profile with available and reserved loyalty balances', async () => {
        findByIdMock.mockResolvedValueOnce({
            _id: 'user_1',
            name: 'Profile User',
            email: 'profile@example.com',
            phone: '+911111111111',
            wishlist: ['507f1f77bcf86cd799439011'],
            referralCode: 'LAVI1234',
            successfulReferralCount: 2,
            loyaltyPoints: 220,
            reservedLoyaltyPoints: 40,
            lifetimeLoyaltyPoints: 400,
            marketingPreferences: {
                emailSubscribed: true,
                promotionalCampaigns: false,
                loyaltyUpdates: true,
                reviewReminders: true
            },
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
            toObject() {
                return {
                    _id: 'user_1',
                    name: 'Profile User',
                    email: 'profile@example.com',
                    phone: '+911111111111',
                    wishlist: ['507f1f77bcf86cd799439011'],
                    referralCode: 'LAVI1234',
                    successfulReferralCount: 2,
                    loyaltyPoints: 220,
                    reservedLoyaltyPoints: 40,
                    lifetimeLoyaltyPoints: 400,
                    marketingPreferences: {
                        emailSubscribed: true,
                        promotionalCampaigns: false,
                        loyaltyUpdates: true,
                        reviewReminders: true
                    },
                    createdAt: new Date('2026-01-01T00:00:00.000Z'),
                    updatedAt: new Date('2026-01-02T00:00:00.000Z')
                };
            }
        });

        const req = {
            userId: 'user_1',
            log: { error: vi.fn() }
        };
        const res = createRes();

        await getUserProfile(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                profile: expect.objectContaining({
                    loyaltyPoints: 220,
                    reservedLoyaltyPoints: 40,
                    availableLoyaltyPoints: 180,
                    wishlistCount: 1
                })
            })
        );
    });

    it('registers a user with a referral code and queues welcome automation', async () => {
        findOneMock
            .mockResolvedValueOnce(null)
            .mockReturnValueOnce({
                select: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValueOnce({
                        _id: 'referrer_1',
                        email: 'referrer@example.com'
                    })
                })
            });
        hashMock.mockResolvedValueOnce('hashed_password');
        saveMock.mockResolvedValueOnce({ _id: 'user_1', referralCode: 'LAVI1234' });

        const req = {
            body: {
                name: 'User',
                email: 'user@example.com',
                password: 'SecurePass123',
                referralCode: 'share10'
            },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await registerUser(req, res);

        expect(generateUniqueReferralCodeMock).toHaveBeenCalledWith('User');
        expect(userModelConstructorMock).toHaveBeenCalledWith(
            expect.objectContaining({
                referredBy: 'referrer_1',
                referralCode: 'LAVI1234'
            })
        );
        expect(queueAutomationEmailMock).toHaveBeenCalledWith(
            expect.objectContaining({
                automationKey: 'welcome_signup',
                context: { referralCode: 'LAVI1234' }
            })
        );
        expect(res.status).toHaveBeenCalledWith(201);
    });

    it('retries registration when generated referral code conflicts', async () => {
        findOneMock.mockResolvedValueOnce(null);
        hashMock.mockResolvedValueOnce('hashed_password');
        generateUniqueReferralCodeMock
            .mockResolvedValueOnce('LAVI1234')
            .mockResolvedValueOnce('LAVI5678');
        saveMock
            .mockRejectedValueOnce({ code: 11000, keyPattern: { referralCode: 1 } })
            .mockResolvedValueOnce({ _id: 'user_2', referralCode: 'LAVI5678' });

        const req = {
            body: {
                name: 'Retry User',
                email: 'retry@example.com',
                password: 'SecurePass123'
            },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await registerUser(req, res);

        expect(generateUniqueReferralCodeMock).toHaveBeenCalledTimes(2);
        expect(userModelConstructorMock).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ referralCode: 'LAVI5678' })
        );
        expect(queueAutomationEmailMock).toHaveBeenCalledWith(
            expect.objectContaining({
                context: { referralCode: 'LAVI5678' }
            })
        );
        expect(res.status).toHaveBeenCalledWith(201);
    });

    it('returns the user wishlist successfully', async () => {
        findByIdMock.mockReturnValueOnce({
            lean: vi.fn().mockResolvedValueOnce({
                wishlist: ['507f1f77bcf86cd799439011']
            })
        });

        const req = {
            userId: 'user_1',
            log: { error: vi.fn() }
        };
        const res = createRes();

        await getUserWishlist(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            wishlist: ['507f1f77bcf86cd799439011']
        });
    });

    it('adds a product to the wishlist successfully', async () => {
        productFindByIdMock.mockReturnValueOnce({
            select: vi.fn().mockResolvedValueOnce({ _id: '507f1f77bcf86cd799439011' })
        });
        findByIdMock.mockResolvedValueOnce({
            wishlist: []
        });
        findByIdAndUpdateMock.mockResolvedValueOnce({
            wishlist: ['507f1f77bcf86cd799439011']
        });

        const req = {
            userId: 'user_1',
            body: { itemId: '507f1f77bcf86cd799439011' },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await toggleUserWishlist(req, res);

        expect(findByIdAndUpdateMock).toHaveBeenCalledWith(
            'user_1',
            { wishlist: ['507f1f77bcf86cd799439011'] },
            { new: true, runValidators: true }
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                message: 'Added to wishlist',
                wishlist: ['507f1f77bcf86cd799439011']
            })
        );
    });

    it('updates marketing preferences successfully', async () => {
        findByIdMock.mockResolvedValueOnce({
            _id: 'user_1',
            marketingPreferences: {
                emailSubscribed: true,
                promotionalCampaigns: true,
                loyaltyUpdates: true,
                reviewReminders: true
            }
        });
        findByIdAndUpdateMock.mockResolvedValueOnce({
            marketingPreferences: {
                emailSubscribed: true,
                promotionalCampaigns: false,
                loyaltyUpdates: true,
                reviewReminders: false
            }
        });

        const req = {
            userId: 'user_1',
            body: {
                promotionalCampaigns: false,
                reviewReminders: false
            },
            log: { error: vi.fn() }
        };
        const res = createRes();

        await updateMarketingPreferences(req, res);

        expect(findByIdAndUpdateMock).toHaveBeenCalledWith(
            'user_1',
            {
                marketingPreferences: {
                    emailSubscribed: true,
                    promotionalCampaigns: false,
                    loyaltyUpdates: true,
                    reviewReminders: false
                }
            },
            { new: true, runValidators: true }
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                marketingPreferences: expect.objectContaining({
                    promotionalCampaigns: false,
                    reviewReminders: false
                })
            })
        );
    });
});
