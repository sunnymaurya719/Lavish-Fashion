import express from 'express';
import rateLimit from 'express-rate-limit';
import { loginUser,registerUser,adminLogin } from '../controllers/userController.js';
import validateRequest from '../middleware/validateRequest.js';
import { adminLoginSchema, userLoginSchema, userRegisterSchema } from '../validation/schemas.js';

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

export default userRouter;