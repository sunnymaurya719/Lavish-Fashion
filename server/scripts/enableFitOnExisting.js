import 'dotenv/config';
import mongoose from 'mongoose';
import productModel from '../models/productModel.js';

const TOPWEAR = {
    S: { chest: 88, waist: 76, shoulder: 42, sleeveLength: 60, garmentLength: 68 },
    M: { chest: 94, waist: 82, shoulder: 44, sleeveLength: 62, garmentLength: 70 },
    L: { chest: 100, waist: 88, shoulder: 46, sleeveLength: 64, garmentLength: 72 },
    XL: { chest: 108, waist: 96, shoulder: 48, sleeveLength: 66, garmentLength: 74 },
    XXL: { chest: 116, waist: 104, shoulder: 50, sleeveLength: 68, garmentLength: 76 }
};
const BOTTOMWEAR = {
    S: { waist: 72, hip: 90, inseam: 78 },
    M: { waist: 78, hip: 96, inseam: 80 },
    L: { waist: 84, hip: 102, inseam: 82 },
    XL: { waist: 92, hip: 110, inseam: 82 },
    XXL: { waist: 100, hip: 118, inseam: 82 }
};

await mongoose.connect(process.env.MONGODB_URI.replace(/\/$/, '') + '/LavishFashion');
const products = await productModel.find({ fitEnabled: { $ne: true } });
console.log('Products without fit:', products.length);

let updated = 0;
for (const p of products) {
    if (!p.sizes || p.sizes.length === 0) continue;
    const sub = (p.subCategory || '').toLowerCase();
    let template = 'topwear';
    let map = TOPWEAR;
    if (sub.includes('bottom') || sub.includes('pant') || sub.includes('trouser')) {
        template = 'bottomwear';
        map = BOTTOMWEAR;
    }
    const sizeMeasurements = p.sizes.map(s => map[s] ? { size: s, ...map[s] } : null).filter(Boolean);
    if (sizeMeasurements.length === 0) continue;

    p.fitEnabled = true;
    p.sizeScale = 'alpha';
    p.fitProfile = {
        measurementTemplate: template,
        fitBias: 'true_to_size',
        stretchScore: 0.25,
        measurementUnit: 'cm',
        sizeMeasurements
    };
    await p.save();
    updated++;
    console.log('Updated:', p.name, '-', template, '-', sizeMeasurements.length, 'sizes');
}
console.log('Total updated:', updated);
await mongoose.disconnect();
