import express from 'express';
import adminAuth from '../middleware/adminAuth.js';
import authUser from '../middleware/auth.js';
import upload from '../middleware/multer.js';
import validateRequest from '../middleware/validateRequest.js';
import {
    createReview,
    getReviewEligibility,
    listAdminReviews,
    listProductReviews,
    updateReviewStatus
} from '../controllers/reviewController.js';
import {
    reviewCreateSchema,
    reviewEligibilitySchema,
    reviewProductParamsSchema,
    reviewStatusSchema
} from '../validation/schemas.js';

const reviewRouter = express.Router();

reviewRouter.get('/product/:productId', validateRequest(reviewProductParamsSchema, 'params'), listProductReviews);
reviewRouter.post('/eligibility', authUser, validateRequest(reviewEligibilitySchema), getReviewEligibility);
reviewRouter.post('/create', authUser, upload.array('media', 3), validateRequest(reviewCreateSchema), createReview);
reviewRouter.get('/admin', adminAuth, listAdminReviews);
reviewRouter.patch('/admin/status', adminAuth, validateRequest(reviewStatusSchema), updateReviewStatus);

export default reviewRouter;
