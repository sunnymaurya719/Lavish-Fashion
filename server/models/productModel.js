import mongoose from "mongoose";

const sizeMeasurementSchema = new mongoose.Schema(
    {
        size: { type: String, required: true, trim: true, maxlength: 10 },
        chest: { type: Number, min: 0, default: null },
        waist: { type: Number, min: 0, default: null },
        hip: { type: Number, min: 0, default: null },
        shoulder: { type: Number, min: 0, default: null },
        sleeveLength: { type: Number, min: 0, default: null },
        inseam: { type: Number, min: 0, default: null },
        garmentLength: { type: Number, min: 0, default: null }
    },
    { _id: false, strict: true }
);

const productSchema = new mongoose.Schema({
    name: {type:String, required:true, trim: true},
    description: {type:String, required:true, trim: true},
    price: {type:Number, required:true, min: 0},
    image: {type:[String], required:true, default: []},
    category: {type:String, required:true, trim: true},
    subCategory: {type:String, required:true, trim: true},
    sizes: {type:[String], required:true, default: []},
    fitEnabled: { type: Boolean, default: false },
    sizeScale: { type: String, enum: ['alpha', 'numeric', 'waist', 'custom'], default: 'alpha' },
    fitProfile: {
        measurementTemplate: {
            type: String,
            enum: ['topwear', 'bottomwear', 'dress', 'outerwear', 'kids_general'],
            default: 'topwear'
        },
        fitBias: { type: String, enum: ['runs_small', 'true_to_size', 'runs_large'], default: 'true_to_size' },
        stretchScore: { type: Number, min: 0, max: 1, default: 0.25 },
        measurementUnit: { type: String, enum: ['cm'], default: 'cm' },
        sizeMeasurements: { type: [sizeMeasurementSchema], default: [] }
    },
    sku: { type: String, trim: true, maxlength: 40, default: '' },
    stock: { type: Number, min: 0, default: 25 },
    lowStockThreshold: { type: Number, min: 0, default: 5 },
    status: { type: String, enum: ['active', 'draft', 'archived'], default: 'active' },
    isFeatured: { type: Boolean, default: false },
    date: {type:Number, required:true}
}, { timestamps: true, strict: true })

const productModel = mongoose.models.product || mongoose.model("product", productSchema);

export default productModel;
