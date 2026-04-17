import express from 'express';
import { testShiprocketConnection } from '../controllers/orderController.js';
import adminAuth from '../middleware/adminAuth.js';

const testRouter = express.Router();

testRouter.get('/shiprocket', adminAuth, testShiprocketConnection);

export default testRouter;
