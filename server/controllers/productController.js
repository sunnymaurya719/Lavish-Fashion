import {v2 as cloudinary} from 'cloudinary';
import productModel from '../models/productModel.js';

//function for add product

const addProduct = async (req ,res) =>{
    try{
        const {name,description, price,category,subCategory,sizes} = req.body ;

        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).json({ success: false, message: 'At least one image is required' });
        }
        
        const image1 = req.files.image1 && req.files.image1[0];
        const image2 = req.files.image2 && req.files.image2[0];
        const image3 = req.files.image3 && req.files.image3[0];
        const image4 = req.files.image4 && req.files.image4[0];

        const images = [image1,image2,image3,image4].filter(img => img !== undefined);

        if (images.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one image is required' });
        }

        let imagesUrl = await Promise.all(
            images.map(async (img) => {
                let result = await cloudinary.uploader.upload(img.path,{resource_type:'image'});
                return result.secure_url;
            })
        )

        const productData = {
            name,
            description,
            category,
            price: Number(price),
            subCategory,
            sizes: JSON.parse(sizes),
            image: imagesUrl,
            date: Date.now()
        }

        console.log(productData);
        const product = new productModel(productData);
        await product.save();
        
        res.status(201).json({success:true,message:"Product added successfully"});
    }
    catch(error){
        console.log("Error in adding product : ",error);
        res.status(500).json({success:false,message:"Error in adding product"})
    }
}

//function for list products

const listProducts = async (req , res) =>{
    try{
        const products = await productModel.find({});
        res.status(200).json({success:true,products});
    }
    catch(error){
        console.log("Error in fetching products : ",error);
        res.status(500).json({success:false,message:"Error in fetching products"})
    }
}

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
        console.log("Error in removing product : ",error);
                res.status(500).json({success:false,message:"Error in removing product"})
      }
}

//function for single product info

const singleProduct = async (req,res) =>{

    try{
        const {id} = req.body;
        const product = await productModel.findById(id);

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        res.status(200).json({success:true,product});
    }
    catch(error){
        console.log("Error in fetching single product : ",error);
        res.status(500).json({success:false,message:"Error in fetching single product"})
    }

}

export {addProduct, listProducts,removeProduct,singleProduct} 