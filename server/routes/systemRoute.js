import express from 'express';
import { getSystemBootstrap } from '../controllers/systemController.js';
import { testShiprocketConnection } from '../controllers/orderController.js';
import adminAuth from '../middleware/adminAuth.js';

const systemRouter = express.Router();

systemRouter.get('/bootstrap', getSystemBootstrap);
systemRouter.get('/shiprocket/test', adminAuth, testShiprocketConnection);

export default systemRouter;
