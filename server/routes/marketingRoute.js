import express from 'express';
import adminAuth from '../middleware/adminAuth.js';
import validateRequest from '../middleware/validateRequest.js';
import {
    createCampaign,
    dispatchCampaign,
    listMarketingOverview,
    updateCampaign,
    updateCampaignStatus
} from '../controllers/marketingController.js';
import {
    marketingCampaignCreateSchema,
    marketingCampaignDispatchSchema,
    marketingCampaignStatusSchema,
    marketingCampaignUpdateSchema
} from '../validation/schemas.js';

const marketingRouter = express.Router();

marketingRouter.get('/admin', adminAuth, listMarketingOverview);
marketingRouter.post('/admin/create', adminAuth, validateRequest(marketingCampaignCreateSchema), createCampaign);
marketingRouter.put('/admin/update', adminAuth, validateRequest(marketingCampaignUpdateSchema), updateCampaign);
marketingRouter.patch('/admin/status', adminAuth, validateRequest(marketingCampaignStatusSchema), updateCampaignStatus);
marketingRouter.post('/admin/dispatch', adminAuth, validateRequest(marketingCampaignDispatchSchema), dispatchCampaign);

export default marketingRouter;
