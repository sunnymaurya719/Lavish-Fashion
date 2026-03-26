import express from 'express';
import adminAuth from '../middleware/adminAuth.js';
import { getDashboardMetrics } from '../controllers/dashboardController.js';

const dashboardRouter = express.Router();

dashboardRouter.get('/', adminAuth, getDashboardMetrics);

export default dashboardRouter;
