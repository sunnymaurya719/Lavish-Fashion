import express from 'express';
import adminAuth from '../middleware/adminAuth.js';
import { getAdminRealtimeToken } from '../controllers/realtimeController.js';

const realtimeRouter = express.Router();

realtimeRouter.post('/admin-token', adminAuth, getAdminRealtimeToken);

export default realtimeRouter;
