import {v2 as cloudinary} from 'cloudinary';
import productModel from '../models/productModel.js';

//function for add product

const addProduct = async (req ,res) =>{
    try{
        const {name,description, price,category,subCategory,sizes} = req.body ;
        
        const image1 = req.files.image1 && req.files.image1[0];
        const image2 = req.files.image2 && req.files.image2[0];
        const image3 = req.files.image3 && req.files.image3[0];
        const image4 = req.files.image4 && req.files.image4[0];

        const images = [image1,image2,image3,image4].filter(img => img !== undefined);

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
        
        res.json({success:true,message:"Product added successfully"});
    }
    catch(error){
        console.log("Error in adding product : ",error);
        res.json({success:false,message:"Error in adding product"})
    }
}

//function for list products

const listProducts = async (req , res) =>{
    try{
        const products = await productModel.find({});
        res.json({success:true,products});
    }
    catch(error){
        console.log("Error in fetching products : ",error);
        res.json({success:false,message:"Error in fetching products"})
    }
}

//function for removing product

const removeProduct = async (req , res) =>{
      try{
        const {id} = req.body;
        await productModel.findByIdAndDelete(id);
        res.json({success:true,message:"Product removed successfully"});
      }
      catch(error){
        console.log("Error in removing product : ",error);
        res.json({success:false,message:"Error in removing product"})
      }
}

//function for single product info

const singleProduct = async (req,res) =>{

    try{
        const {id} = req.body;
        const product = await productModel.findById(id);
        res.json({success:true,product});
    }
    catch(error){
        console.log("Error in fetching single product : ",error);
        res.json({success:false,message:"Error in fetching single product"})
    }

}

export {addProduct, listProducts,removeProduct,singleProduct} 