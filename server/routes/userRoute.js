import express from 'express';
import rateLimit from 'express-rate-limit';
import {
    adminLogin,
    getUserProfile,
    getUserWishlist,
    loginUser,
    registerUser,
    toggleUserWishlist,
    updateMarketingPreferences,
    updateUserProfile
} from '../controllers/userController.js';
import authUser from '../middleware/auth.js';
import validateRequest from '../middleware/validateRequest.js';
import {
    adminLoginSchema,
    marketingPreferencesUpdateSchema,
    userLoginSchema,
    userProfileUpdateSchema,
    userRegisterSchema,
    wishlistToggleSchema
} from '../validation/schemas.js';

const userRouter = express.Router();

const authLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 15,
	standardHeaders: true,
	legacyHeaders: false,
	message: { success: false, message: 'Too many auth attempts. Try again later.' }
});

userRouter.post('/login',authLimiter,validateRequest(userLoginSchema),loginUser);
userRouter.post('/register',authLimiter,validateRequest(userRegisterSchema),registerUser);
userRouter.post('/admin',authLimiter,validateRequest(adminLoginSchema),adminLogin);
userRouter.get('/profile', authUser, getUserProfile);
userRouter.put('/profile', authUser, validateRequest(userProfileUpdateSchema), updateUserProfile);
userRouter.patch('/marketing-preferences', authUser, validateRequest(marketingPreferencesUpdateSchema), updateMarketingPreferences);
userRouter.get('/wishlist', authUser, getUserWishlist);
userRouter.post('/wishlist/toggle', authUser, validateRequest(wishlistToggleSchema), toggleUserWishlist);

export default userRouter;
