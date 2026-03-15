import express from 'express';
import { listProducts,addProduct,removeProduct,singleProduct } from '../controllers/productController.js';
import upload from '../middleware/multer.js';
import adminAuth from '../middleware/adminAuth.js';
import validateRequest from '../middleware/validateRequest.js';
import { productAddSchema, productRemoveSchema } from '../validation/schemas.js';

const productRouter = express.Router();

productRouter.post('/add',adminAuth,upload.fields([{name:'image1',maxCount:1},{name:'image2',maxCount:1},{name:'image3',maxCount:1},{name:'image4',maxCount:1}]),validateRequest(productAddSchema),addProduct);
productRouter.post('/remove',adminAuth,validateRequest(productRemoveSchema),removeProduct);
productRouter.post('/single',singleProduct);
productRouter.get('/list',listProducts);

export default productRouter;