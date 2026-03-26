import express from 'express';
import adminAuth from '../middleware/adminAuth.js';
import authUser from '../middleware/auth.js';
import { getUserRewardsSummary, listAdminLoyaltyInsights } from '../controllers/loyaltyController.js';

const loyaltyRouter = express.Router();

loyaltyRouter.get('/summary', authUser, getUserRewardsSummary);
loyaltyRouter.get('/admin', adminAuth, listAdminLoyaltyInsights);

export default loyaltyRouter;
