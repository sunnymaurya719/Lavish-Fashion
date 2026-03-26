import mongoose from "mongoose";

const productSchema = new mongoose.Schema({
    name: {type:String, required:true, trim: true},
    description: {type:String, required:true, trim: true},
    price: {type:Number, required:true, min: 0},
    image: {type:[String], required:true, default: []},
    category: {type:String, required:true, trim: true},
    subCategory: {type:String, required:true, trim: true},
    sizes: {type:[String], required:true, default: []},
    sku: { type: String, trim: true, maxlength: 40, default: '' },
    stock: { type: Number, min: 0, default: 25 },
    lowStockThreshold: { type: Number, min: 0, default: 5 },
    status: { type: String, enum: ['active', 'draft', 'archived'], default: 'active' },
    isFeatured: { type: Boolean, default: false },
    date: {type:Number, required:true}
}, { timestamps: true, strict: true })

const productModel = mongoose.models.product || mongoose.model("product", productSchema);

export default productModel;
