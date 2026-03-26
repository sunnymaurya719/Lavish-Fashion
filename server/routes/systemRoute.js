import express from 'express';
import { getSystemBootstrap } from '../controllers/systemController.js';

const systemRouter = express.Router();

systemRouter.get('/bootstrap', getSystemBootstrap);

export default systemRouter;
