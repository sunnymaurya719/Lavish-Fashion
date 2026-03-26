import express from 'express';
import adminAuth from '../middleware/adminAuth.js';
import validateRequest from '../middleware/validateRequest.js';
import {
    adminCustomerDetailSchema,
    adminCustomerNotesSchema
} from '../validation/schemas.js';
import {
    getCustomerDetail,
    listCustomers,
    updateCustomerNotes
} from '../controllers/customerController.js';

const customerRouter = express.Router();

customerRouter.get('/', adminAuth, listCustomers);
customerRouter.post('/detail', adminAuth, validateRequest(adminCustomerDetailSchema), getCustomerDetail);
customerRouter.put('/notes', adminAuth, validateRequest(adminCustomerNotesSchema), updateCustomerNotes);

export default customerRouter;
