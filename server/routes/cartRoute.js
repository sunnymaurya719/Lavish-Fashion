import express from 'express';
import { addToCart, getUserCart, removeFromCart, updateCart } from '../controllers/cartController.js';
import authUser from '../middleware/auth.js';
import validateRequest from '../middleware/validateRequest.js';
import { cartAddSchema, cartRemoveSchema, cartUpdateSchema } from '../validation/schemas.js';


const cartRouter = express.Router();

cartRouter.post('/get',authUser,getUserCart);
cartRouter.post('/add',authUser,validateRequest(cartAddSchema),addToCart);
cartRouter.post('/remove',authUser,validateRequest(cartRemoveSchema),removeFromCart);
cartRouter.post('/update',authUser,validateRequest(cartUpdateSchema),updateCart);

export default cartRouter;

