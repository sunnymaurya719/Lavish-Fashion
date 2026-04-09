import 'dotenv/config';
import mongoose from 'mongoose';
import productModel from '../models/productModel.js';

const PLACEHOLDER_IMG = 'https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg';

const PRODUCTS = [
    {
        name: 'Classic Cotton T-Shirt',
        description: 'A soft, breathable cotton t-shirt perfect for everyday wear. Comfortable fit with reinforced stitching.',
        price: 999,
        image: [PLACEHOLDER_IMG],
        category: 'Men',
        subCategory: 'Topwear',
        sizes: ['S', 'M', 'L', 'XL'],
        status: 'active',
        date: Date.now(),
        fitEnabled: true,
        sizeScale: 'alpha',
        fitProfile: {
            measurementTemplate: 'topwear',
            fitBias: 'true_to_size',
            stretchScore: 0.3,
            measurementUnit: 'cm',
            sizeMeasurements: [
                { size: 'S', chest: 88, waist: 76, shoulder: 42, sleeveLength: 60, garmentLength: 68 },
                { size: 'M', chest: 94, waist: 82, shoulder: 44, sleeveLength: 62, garmentLength: 70 },
                { size: 'L', chest: 100, waist: 88, shoulder: 46, sleeveLength: 64, garmentLength: 72 },
                { size: 'XL', chest: 108, waist: 96, shoulder: 48, sleeveLength: 66, garmentLength: 74 }
            ]
        }
    },
    {
        name: 'Slim Fit Chinos',
        description: 'Modern slim-fit chinos made from stretch cotton twill. Versatile enough for casual and semi-formal occasions.',
        price: 1799,
        image: [PLACEHOLDER_IMG],
        category: 'Men',
        subCategory: 'Bottomwear',
        sizes: ['S', 'M', 'L', 'XL'],
        status: 'active',
        date: Date.now(),
        fitEnabled: true,
        sizeScale: 'alpha',
        fitProfile: {
            measurementTemplate: 'bottomwear',
            fitBias: 'runs_small',
            stretchScore: 0.4,
            measurementUnit: 'cm',
            sizeMeasurements: [
                { size: 'S', waist: 72, hip: 90, inseam: 78 },
                { size: 'M', waist: 78, hip: 96, inseam: 80 },
                { size: 'L', waist: 84, hip: 102, inseam: 82 },
                { size: 'XL', waist: 92, hip: 110, inseam: 82 }
            ]
        }
    },
    {
        name: 'Floral Wrap Dress',
        description: 'Elegant wrap dress with a flattering silhouette. Lightweight fabric with beautiful floral print.',
        price: 2499,
        image: [PLACEHOLDER_IMG],
        category: 'Women',
        subCategory: 'Topwear',
        sizes: ['S', 'M', 'L', 'XL'],
        status: 'active',
        date: Date.now(),
        fitEnabled: true,
        sizeScale: 'alpha',
        fitProfile: {
            measurementTemplate: 'dress',
            fitBias: 'true_to_size',
            stretchScore: 0.2,
            measurementUnit: 'cm',
            sizeMeasurements: [
                { size: 'S', chest: 84, waist: 68, hip: 90, garmentLength: 95 },
                { size: 'M', chest: 90, waist: 74, hip: 96, garmentLength: 97 },
                { size: 'L', chest: 96, waist: 80, hip: 102, garmentLength: 99 },
                { size: 'XL', chest: 104, waist: 88, hip: 110, garmentLength: 101 }
            ]
        }
    },
    {
        name: 'Women Relaxed Fit Blazer',
        description: 'A structured yet comfortable blazer for Women. Perfect layering piece for the office or a night out.',
        price: 3299,
        image: [PLACEHOLDER_IMG],
        category: 'Women',
        subCategory: 'Topwear',
        sizes: ['S', 'M', 'L', 'XL', 'XXL'],
        status: 'active',
        date: Date.now(),
        fitEnabled: true,
        sizeScale: 'alpha',
        fitProfile: {
            measurementTemplate: 'outerwear',
            fitBias: 'runs_large',
            stretchScore: 0.1,
            measurementUnit: 'cm',
            sizeMeasurements: [
                { size: 'S', chest: 92, shoulder: 44, sleeveLength: 58, garmentLength: 62 },
                { size: 'M', chest: 98, shoulder: 46, sleeveLength: 60, garmentLength: 64 },
                { size: 'L', chest: 104, shoulder: 48, sleeveLength: 62, garmentLength: 66 },
                { size: 'XL', chest: 112, shoulder: 50, sleeveLength: 64, garmentLength: 68 },
                { size: 'XXL', chest: 120, shoulder: 52, sleeveLength: 66, garmentLength: 70 }
            ]
        }
    },
    {
        name: 'Kids Cartoon Print Tee',
        description: 'Fun cartoon print t-shirt for kids. Made from soft cotton for all-day comfort.',
        price: 599,
        image: [PLACEHOLDER_IMG],
        category: 'Kids',
        subCategory: 'Topwear',
        sizes: ['S', 'M', 'L'],
        status: 'active',
        date: Date.now(),
        fitEnabled: true,
        sizeScale: 'alpha',
        fitProfile: {
            measurementTemplate: 'kids_general',
            fitBias: 'true_to_size',
            stretchScore: 0.35,
            measurementUnit: 'cm',
            sizeMeasurements: [
                { size: 'S', chest: 60, waist: 54, hip: 62, garmentLength: 42 },
                { size: 'M', chest: 66, waist: 60, hip: 68, garmentLength: 46 },
                { size: 'L', chest: 72, waist: 66, hip: 74, garmentLength: 50 }
            ]
        }
    }
];

async function seed() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const existing = await productModel.countDocuments({});
    console.log(`Existing products: ${existing}`);

    if (existing > 0) {
        // Update existing products with fit data
        const products = await productModel.find({}).lean();
        let updated = 0;

        for (const product of products) {
            if (!product.sizes || product.sizes.length === 0) continue;

            const template = resolveTemplate(product.category, product.subCategory);
            const measurementMap = getMeasurements(template);

            const sizeMeasurements = product.sizes
                .map((size) => {
                    const data = measurementMap[size];
                    if (!data) return null;
                    return { size, ...data };
                })
                .filter(Boolean);

            if (sizeMeasurements.length === 0) continue;

            await productModel.updateOne(
                { _id: product._id },
                {
                    $set: {
                        fitEnabled: true,
                        sizeScale: 'alpha',
                        'fitProfile.measurementTemplate': template,
                        'fitProfile.fitBias': 'true_to_size',
                        'fitProfile.stretchScore': 0.25,
                        'fitProfile.measurementUnit': 'cm',
                        'fitProfile.sizeMeasurements': sizeMeasurements
                    }
                }
            );
            updated++;
            console.log(`  Updated: "${product.name}" — ${template}`);
        }

        console.log(`Updated ${updated} existing products.`);
    } else {
        // Insert sample products
        const result = await productModel.insertMany(PRODUCTS);
        console.log(`Inserted ${result.length} sample products with fit data:`);
        result.forEach((p) => console.log(`  - ${p.name} (${p._id})`));
    }

    await mongoose.disconnect();
    console.log('Done.');
}

const TOPWEAR_MEASUREMENTS = {
    S: { chest: 88, waist: 76, shoulder: 42, sleeveLength: 60, garmentLength: 68 },
    M: { chest: 94, waist: 82, shoulder: 44, sleeveLength: 62, garmentLength: 70 },
    L: { chest: 100, waist: 88, shoulder: 46, sleeveLength: 64, garmentLength: 72 },
    XL: { chest: 108, waist: 96, shoulder: 48, sleeveLength: 66, garmentLength: 74 },
    XXL: { chest: 116, waist: 104, shoulder: 50, sleeveLength: 68, garmentLength: 76 }
};

const BOTTOMWEAR_MEASUREMENTS = {
    S: { waist: 72, hip: 90, inseam: 78 },
    M: { waist: 78, hip: 96, inseam: 80 },
    L: { waist: 84, hip: 102, inseam: 82 },
    XL: { waist: 92, hip: 110, inseam: 82 },
    XXL: { waist: 100, hip: 118, inseam: 82 }
};

const resolveTemplate = (category, subCategory) => {
    const sub = (subCategory || '').toLowerCase();
    if (sub.includes('bottom') || sub.includes('pant') || sub.includes('jean')) return 'bottomwear';
    if (sub.includes('dress') || sub.includes('gown')) return 'dress';
    if ((category || '').toLowerCase().includes('kid')) return 'kids_general';
    return 'topwear';
};

const getMeasurements = (template) => {
    if (template === 'bottomwear') return BOTTOMWEAR_MEASUREMENTS;
    return TOPWEAR_MEASUREMENTS;
};

seed().catch((err) => {
    console.error(err);
    process.exit(1);
});

