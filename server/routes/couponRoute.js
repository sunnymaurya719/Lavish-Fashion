import express from 'express';
import adminAuth from '../middleware/adminAuth.js';
import authUser from '../middleware/auth.js';
import validateRequest from '../middleware/validateRequest.js';
import {
    couponCreateSchema,
    couponStatusSchema,
    couponUpdateSchema,
    couponValidateSchema
} from '../validation/schemas.js';
import {
    createCoupon,
    listAdminCoupons,
    updateCoupon,
    updateCouponStatus,
    validateCoupon
} from '../controllers/couponController.js';

const couponRouter = express.Router();

couponRouter.get('/admin', adminAuth, listAdminCoupons);
couponRouter.post('/admin/create', adminAuth, validateRequest(couponCreateSchema), createCoupon);
couponRouter.put('/admin/update', adminAuth, validateRequest(couponUpdateSchema), updateCoupon);
couponRouter.patch('/admin/status', adminAuth, validateRequest(couponStatusSchema), updateCouponStatus);
couponRouter.post('/validate', authUser, validateRequest(couponValidateSchema), validateCoupon);

export default couponRouter;
