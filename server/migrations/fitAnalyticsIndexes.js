/**
 * Idempotent index migration for the Fit Analytics aggregation backend.
 *
 * Run once after deploying the new aggregation pipeline:
 *
 *     node server/migrations/fitAnalyticsIndexes.js
 *
 * Safe to re-run: `createIndex` is a no-op when an index with the same
 * specification already exists.
 */

import mongoose from 'mongoose';
import 'dotenv/config';

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || '';

const INDEXES = [
    {
        collection: 'orders',
        spec: { date: -1, 'items.fitAssistant.recommendedSize': 1 },
        options: { name: 'fit_analytics_trend', sparse: true, background: true }
    },
    {
        collection: 'fit_feedback',
        spec: { productId: 1, createdAt: -1 },
        options: { name: 'fit_feedback_by_product', background: true }
    },
    {
        collection: 'fit_feedback',
        spec: { createdAt: -1 },
        options: { name: 'fit_feedback_by_created_at', background: true }
    },
    {
        collection: 'products',
        spec: { fitEnabled: 1, status: 1 },
        options: { name: 'fit_readiness', background: true }
    }
];

const createIndexesOnce = async () => {
    if (!MONGO_URI) {
        throw new Error('MONGO_URI (or MONGODB_URI) must be set to run this migration.');
    }

    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;

    for (const { collection, spec, options } of INDEXES) {
        const result = await db
            .collection(collection)
            .createIndex(spec, options)
            .catch((error) => {
                console.error(`✘ ${collection}.${options.name}: ${error.message}`);
                return null;
            });
        if (result) {
            console.log(`✔ ${collection}.${options.name} → ${result}`);
        }
    }

    await mongoose.disconnect();
};

createIndexesOnce()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Index migration failed:', error);
        process.exit(1);
    });
