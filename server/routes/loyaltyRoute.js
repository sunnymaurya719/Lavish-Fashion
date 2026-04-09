import express from 'express';
import adminAuth from '../middleware/adminAuth.js';
import authUser from '../middleware/auth.js';
import { getUserRewardsSummary, listAdminLoyaltyInsights, adminManualAdjustment, getUserTransactionHistory } from '../controllers/loyaltyController.js';

const loyaltyRouter = express.Router();

loyaltyRouter.get('/summary', authUser, getUserRewardsSummary);
loyaltyRouter.get('/transactions', authUser, getUserTransactionHistory);
loyaltyRouter.get('/admin', adminAuth, listAdminLoyaltyInsights);
loyaltyRouter.post('/admin/adjust', adminAuth, adminManualAdjustment);

export default loyaltyRouter;
