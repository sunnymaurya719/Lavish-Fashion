import {v2 as cloudinary} from 'cloudinary';
import { unlink } from 'fs/promises';
import productModel from '../models/productModel.js';
import reviewModel from '../models/reviewModel.js';
import { backfillMissingProductInventory, normalizeInventoryFields } from '../services/productInventoryService.js';
import { buildProductFitConfig, normalizeProductFitData } from '../services/productFitProfileService.js';

const imageFieldNames = ['image1', 'image2', 'image3', 'image4'];
const subCategoryAliases = {
    Winter: 'Winterwear'
};

const normalizeSubCategory = (value) => {
    const trimmedValue = String(value || '').trim();
    return subCategoryAliases[trimmedValue] || trimmedValue;
};

const isCloudinaryConfigured = () =>
    Boolean(process.env.CLOUDINARY_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_SECRET_KEY);

const safeUnlink = async (path) => {
    if (!path) {
        return;
    }

    try {
        await unlink(path);
    } catch {
        // Ignore temporary file cleanup issues after upload attempts.
    }
};

const parseStringArray = (value) => {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }

    if (typeof value !== 'string') {
        return [];
    }

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
    } catch {
        return [];
    }
};

const parseJsonArray = (value) => {
    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value !== 'string') {
        return [];
    }

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const uploadImage = async (file) => {
    if (!isCloudinaryConfigured()) {
        const error = new Error('Product media uploads are not configured on the server');
        error.statusCode = 503;
        throw error;
    }

    try {
        const result = await cloudinary.uploader.upload(file.path, { resource_type: 'image' });
        return result.secure_url;
    } finally {
        await safeUnlink(file.path);
    }
};

const buildImageList = async ({ files, existingImages = [] }) => {
    const normalizedExistingImages = Array.isArray(existingImages) ? existingImages : [];
    const finalImages = [];

    for (const [index, fieldName] of imageFieldNames.entries()) {
        const file = files?.[fieldName]?.[0];

        if (file) {
            finalImages.push(await uploadImage(file));
            continue;
        }

        const existingImage = String(normalizedExistingImages[index] || '').trim();
        if (existingImage) {
            finalImages.push(existingImage);
        }
    }

    return finalImages;
};

const normalizeProductDocument = (product) => {
    if (!product) {
        return null;
    }

    const normalizedProduct = normalizeProductFitData(normalizeInventoryFields(product));
    normalizedProduct.subCategory = normalizeSubCategory(normalizedProduct.subCategory);
    return normalizedProduct;
};

const buildReviewSummaryMap = async (productIds = []) => {
    const normalizedProductIds = [...new Set(productIds.filter(Boolean).map((productId) => String(productId)))];

    if (normalizedProductIds.length === 0) {
        return new Map();
    }

    const publishedReviews = await reviewModel.find({
        productId: { $in: normalizedProductIds },
        status: 'published'
    }).lean();

    const reviewSummaryMap = new Map();

    normalizedProductIds.forEach((productId) => {
        const productReviews = publishedReviews.filter((review) => review.productId === productId);
        const reviewCount = productReviews.length;
        const averageRating = reviewCount > 0
            ? Number((productReviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviewCount).toFixed(1))
            : 0;

        reviewSummaryMap.set(productId, {
            reviewCount,
            averageRating
        });
    });

    return reviewSummaryMap;
};

const withReviewSummary = (product, reviewSummaryMap) => {
    const reviewSummary = reviewSummaryMap.get(String(product._id)) || {
        reviewCount: 0,
        averageRating: 0
    };

    return {
        ...product,
        reviewCount: reviewSummary.reviewCount,
        averageRating: reviewSummary.averageRating
    };
};

const getSingleNormalizedProduct = async (id) => {
    await backfillMissingProductInventory();
    const product = await productModel.findById(id).lean();

    if (!product) {
        return null;
    }

    const reviewSummaryMap = await buildReviewSummaryMap([id]);
    return withReviewSummary(normalizeProductDocument(product), reviewSummaryMap);
};

const addProduct = async (req ,res) =>{
    try{
        const {
            name,
            description,
            price,
            category,
            subCategory,
            sizes,
            fitEnabled = false,
            sizeScale = 'alpha',
            measurementTemplate = 'topwear',
            fitBias = 'true_to_size',
            stretchScore = 0.25,
            sizeMeasurements = '[]',
            sku = '',
            stock = 25,
            lowStockThreshold = 5,
            status = 'active',
            isFeatured = false
        } = req.body;

        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).json({ success: false, message: 'At least one image is required' });
        }

        if (!isCloudinaryConfigured()) {
            return res.status(503).json({
                success: false,
                message: 'Product media uploads are not configured on the server'
            });
        }

        const imagesUrl = await buildImageList({ files: req.files });

        const normalizedSizes = parseStringArray(sizes);
        const fitConfig = buildProductFitConfig({
            fitEnabled,
            sizeScale,
            measurementTemplate,
            fitBias,
            stretchScore,
            sizeMeasurements: parseJsonArray(sizeMeasurements),
            sizes: normalizedSizes
        });

        const productData = {
            name,
            description,
            category,
            price: Number(price),
            subCategory: normalizeSubCategory(subCategory),
            sizes: normalizedSizes,
            fitEnabled: fitConfig.fitEnabled,
            sizeScale: fitConfig.sizeScale,
            fitProfile: fitConfig.fitProfile,
            sku: String(sku || '').trim().toUpperCase(),
            stock: Number(stock),
            lowStockThreshold: Number(lowStockThreshold),
            status,
            isFeatured: Boolean(isFeatured),
            image: imagesUrl,
            date: Date.now()
        };

        const product = new productModel(productData);
        await product.save();
        
        res.status(201).json({success:true,message:"Product added successfully"});
    }
    catch(error){
        req.log?.error({ err: error }, 'Error in adding product');
        res.status(500).json({success:false,message:"Error in adding product"});
    }
};

const updateProduct = async (req, res) => {
    try {
        const {
            id,
            name,
            description,
            price,
            category,
            subCategory,
            sizes,
            fitEnabled = false,
            sizeScale = 'alpha',
            measurementTemplate = 'topwear',
            fitBias = 'true_to_size',
            stretchScore = 0.25,
            sizeMeasurements = '[]',
            existingImages,
            sku = '',
            stock = 25,
            lowStockThreshold = 5,
            status = 'active',
            isFeatured = false
        } = req.body;
        const existingProduct = await productModel.findById(id);

        if (!existingProduct) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const retainedImages = existingImages
            ? parseStringArray(existingImages)
            : (Array.isArray(existingProduct.image) ? existingProduct.image : []);

        const hasNewMediaUploads = imageFieldNames.some((fieldName) => Boolean(req.files?.[fieldName]?.[0]));

        if (hasNewMediaUploads && !isCloudinaryConfigured()) {
            return res.status(503).json({
                success: false,
                message: 'Product media uploads are not configured on the server'
            });
        }

        const finalImages = await buildImageList({
            files: req.files,
            existingImages: retainedImages
        });

        if (finalImages.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one image is required' });
        }

        const normalizedSizes = parseStringArray(sizes);
        const fitConfig = buildProductFitConfig({
            fitEnabled,
            sizeScale,
            measurementTemplate,
            fitBias,
            stretchScore,
            sizeMeasurements: parseJsonArray(sizeMeasurements),
            sizes: normalizedSizes
        });

        await productModel.findByIdAndUpdate(
            id,
            {
                name,
                description,
                category,
                price: Number(price),
                subCategory: normalizeSubCategory(subCategory),
                sizes: normalizedSizes,
                fitEnabled: fitConfig.fitEnabled,
                sizeScale: fitConfig.sizeScale,
                fitProfile: fitConfig.fitProfile,
                sku: String(sku || '').trim().toUpperCase(),
                stock: Number(stock),
                lowStockThreshold: Number(lowStockThreshold),
                status,
                isFeatured: Boolean(isFeatured),
                image: finalImages
            },
            { new: true, runValidators: true }
        );

        return res.status(200).json({ success: true, message: 'Product updated successfully' });
    } catch (error) {
        req.log?.error({ err: error }, 'Error in updating product');
        return res.status(500).json({ success: false, message: 'Error in updating product' });
    }
};

//function for list products

const listProducts = async (req , res) =>{
    try{
        await backfillMissingProductInventory();
        const products = await productModel.find({ status: 'active' }).sort({ date: -1 }).lean();
        const reviewSummaryMap = await buildReviewSummaryMap(products.map((product) => product._id));
        const normalizedProducts = products.map((product) =>
            withReviewSummary(normalizeProductDocument(product), reviewSummaryMap)
        );

        res.status(200).json({success:true,products: normalizedProducts});
    }
    catch(error){
        req.log?.error({ err: error }, 'Error in fetching products');
        res.status(500).json({success:false,message:"Error in fetching products"})
    }
};

const listAdminProducts = async (req, res) => {
    try {
        await backfillMissingProductInventory();
        const products = await productModel.find({}).sort({ date: -1 }).lean();
        const reviewSummaryMap = await buildReviewSummaryMap(products.map((product) => product._id));

        return res.status(200).json({
            success: true,
            products: products.map((product) => withReviewSummary(normalizeProductDocument(product), reviewSummaryMap))
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Error in fetching admin products');
        return res.status(500).json({ success: false, message: 'Error in fetching products' });
    }
};

const listInventoryProducts = async (req, res) => {
    try {
        await backfillMissingProductInventory();
        const products = await productModel.find({}).sort({ stock: 1, date: -1 }).lean();
        const reviewSummaryMap = await buildReviewSummaryMap(products.map((product) => product._id));

        return res.status(200).json({
            success: true,
            products: products.map((product) => withReviewSummary(normalizeProductDocument(product), reviewSummaryMap))
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Error in fetching inventory products');
        return res.status(500).json({ success: false, message: 'Error in fetching inventory products' });
    }
};

//function for removing product

const removeProduct = async (req , res) =>{
      try{
        const {id} = req.body;
                const deleted = await productModel.findByIdAndDelete(id);

                if (!deleted) {
                        return res.status(404).json({ success: false, message: 'Product not found' });
                }

                res.status(200).json({success:true,message:"Product removed successfully"});
      }
      catch(error){
        req.log?.error({ err: error }, 'Error in removing product');
                res.status(500).json({success:false,message:"Error in removing product"})
      }
};

//function for single product info

const singleProduct = async (req,res) =>{

    try{
        const {id} = req.body;
        const product = await getSingleNormalizedProduct(id);

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        res.status(200).json({success:true,product});
    }
    catch(error){
        req.log?.error({ err: error }, 'Error in fetching single product');
        res.status(500).json({success:false,message:"Error in fetching single product"})
    }

};

const singleAdminProduct = async (req, res) => {
    try {
        const { id } = req.body;
        const product = await getSingleNormalizedProduct(id);

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        return res.status(200).json({ success: true, product });
    } catch (error) {
        req.log?.error({ err: error }, 'Error in fetching admin product');
        return res.status(500).json({ success: false, message: 'Error in fetching product' });
    }
};

const updateProductInventory = async (req, res) => {
    try {
        const { id, stock, lowStockThreshold, status } = req.body;
        const updatedProduct = await productModel.findByIdAndUpdate(
            id,
            {
                stock: Number(stock),
                lowStockThreshold: Number(lowStockThreshold),
                status
            },
            { new: true, runValidators: true }
        ).lean();

        if (!updatedProduct) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        return res.status(200).json({
            success: true,
            message: 'Inventory updated successfully',
            product: normalizeProductDocument(updatedProduct)
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Error in updating product inventory');
        return res.status(500).json({ success: false, message: 'Error in updating inventory' });
    }
};

export {addProduct, listAdminProducts, listInventoryProducts, listProducts, removeProduct, singleAdminProduct, singleProduct, updateProduct, updateProductInventory};
