import express from 'express';
import { addToCart, getUserCart, removeFromCart, updateCart } from '../controllers/cartController.js';
import authUser from '../middleware/auth.js';


const cartRouter = express.Router();

cartRouter.post('/get',authUser,getUserCart);
cartRouter.post('/add',authUser,addToCart);
cartRouter.post('/remove',authUser,removeFromCart);
cartRouter.post('/update',authUser,updateCart);

export default cartRouter;

