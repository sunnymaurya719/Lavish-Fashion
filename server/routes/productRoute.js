import express from 'express';
import {
    addProduct,
    listAdminProducts,
    listInventoryProducts,
    listProducts,
    removeProduct,
    singleAdminProduct,
    singleProduct,
    updateProduct,
    updateProductInventory
} from '../controllers/productController.js';
import upload from '../middleware/multer.js';
import adminAuth from '../middleware/adminAuth.js';
import validateRequest from '../middleware/validateRequest.js';
import {
    productAddSchema,
    productInventoryUpdateSchema,
    productRemoveSchema,
    productSingleSchema,
    productUpdateSchema
} from '../validation/schemas.js';

const productRouter = express.Router();

productRouter.post('/add',adminAuth,upload.fields([{name:'image1',maxCount:1},{name:'image2',maxCount:1},{name:'image3',maxCount:1},{name:'image4',maxCount:1}]),validateRequest(productAddSchema),addProduct);
productRouter.put('/update',adminAuth,upload.fields([{name:'image1',maxCount:1},{name:'image2',maxCount:1},{name:'image3',maxCount:1},{name:'image4',maxCount:1}]),validateRequest(productUpdateSchema),updateProduct);
productRouter.get('/admin-list', adminAuth, listAdminProducts);
productRouter.post('/admin-single', adminAuth, validateRequest(productSingleSchema), singleAdminProduct);
productRouter.get('/inventory', adminAuth, listInventoryProducts);
productRouter.patch('/inventory', adminAuth, validateRequest(productInventoryUpdateSchema), updateProductInventory);
productRouter.post('/remove',adminAuth,validateRequest(productRemoveSchema),removeProduct);
productRouter.post('/single',validateRequest(productSingleSchema),singleProduct);
productRouter.get('/list',listProducts);

export default productRouter;
