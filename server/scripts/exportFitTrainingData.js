import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import connectDB from '../config/mongodb.js';
import fitFeedbackModel from '../models/fitFeedbackModel.js';
import orderModel from '../models/orderModel.js';
import productModel from '../models/productModel.js';
import userModel from '../models/userModel.js';
import { normalizeProductFitData, normalizeSizeLabel } from '../services/productFitProfileService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_OUTPUT_PATH = path.resolve(
    __dirname,
    '..',
    '..',
    'ml-service',
    'train',
    'data',
    'fit_feedback_export.jsonl'
);

const HELP_TEXT = `
Usage:
  node server/scripts/exportFitTrainingData.js [--out <path>] [--limit <number>] [--since <iso-date>] [--include-unready]

Options:
  --out <path>           Output JSONL path. Defaults to ml-service/train/data/fit_feedback_export.jsonl
  --limit <number>       Optional maximum number of fit feedback records to export
  --since <iso-date>     Optional ISO date filter applied to fit feedback createdAt
  --include-unready      Include fit-enabled products even if their fit profile summary is not rollout-ready
  --help                 Show this help message
`.trim();

const normalizeString = (value) => String(value || '').trim();

const normalizeOptionalNumber = (value, precision = 4) => {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? Number(parsedValue.toFixed(precision)) : null;
};

const normalizeDate = (value) => {
    if (!value && value !== 0) {
        return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const normalizeBodyFeatures = (bodyFeatures = {}) => {
    if (!bodyFeatures || typeof bodyFeatures !== 'object') {
        return null;
    }

    const normalized = {
        shoulderRatio: normalizeOptionalNumber(bodyFeatures.shoulderRatio),
        hipRatio: normalizeOptionalNumber(bodyFeatures.hipRatio),
        torsoRatio: normalizeOptionalNumber(bodyFeatures.torsoRatio),
        scanQuality: normalizeOptionalNumber(bodyFeatures.scanQuality)
    };

    return Object.values(normalized).some((value) => value !== null) ? normalized : null;
};

const createSummary = () => ({
    scannedFeedbackEntries: 0,
    exportedRecords: 0,
    skipped: {
        missingOrder: 0,
        missingProduct: 0,
        missingUser: 0,
        missingOrderItem: 0,
        productNotFitEnabled: 0,
        productNotReady: 0,
        missingUserMetrics: 0,
        invalidSelectedSize: 0,
        invalidRecommendedSize: 0
    }
});

const incrementSummary = (summary, key) => {
    summary.skipped[key] = Number(summary.skipped[key] || 0) + 1;
};

const parseArgs = (argv = []) => {
    const args = {
        out: DEFAULT_OUTPUT_PATH,
        limit: null,
        since: null,
        includeUnready: false,
        help: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];

        if (argument === '--help' || argument === '-h') {
            args.help = true;
            continue;
        }

        if (argument === '--include-unready') {
            args.includeUnready = true;
            continue;
        }

        if (argument === '--out') {
            const nextValue = argv[index + 1];
            if (!nextValue) {
                throw new Error('Missing value for --out');
            }

            args.out = path.resolve(process.cwd(), nextValue);
            index += 1;
            continue;
        }

        if (argument === '--limit') {
            const nextValue = Number(argv[index + 1]);
            if (!Number.isInteger(nextValue) || nextValue <= 0) {
                throw new Error('The --limit value must be a positive integer');
            }

            args.limit = nextValue;
            index += 1;
            continue;
        }

        if (argument === '--since') {
            const nextValue = argv[index + 1];
            const parsedDate = nextValue ? new Date(nextValue) : null;
            if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
                throw new Error('The --since value must be a valid ISO date');
            }

            args.since = parsedDate;
            index += 1;
            continue;
        }

        throw new Error(`Unknown argument: ${argument}`);
    }

    return args;
};

const findMatchingOrderItem = (order, productId) =>
    Array.isArray(order?.items) ? order.items.find((item) => normalizeString(item?._id) === productId) || null : null;

const buildExportRecord = ({ feedbackEntry, product, order, orderItem, user }) => {
    const normalizedProduct = normalizeProductFitData(product);
    const userHeightCm = normalizeOptionalNumber(user?.fitProfile?.heightCm, 2);
    const userWeightKg = normalizeOptionalNumber(user?.fitProfile?.weightKg, 2);
    const selectedSize = normalizeSizeLabel(feedbackEntry.selectedSize || orderItem?.size);
    const recommendedSize = normalizeSizeLabel(feedbackEntry.recommendedSize || orderItem?.fitAssistant?.recommendedSize);

    return {
        exportVersion: 'fit_feedback_export_v1',
        feedbackId: normalizeString(feedbackEntry._id),
        userId: normalizeString(feedbackEntry.userId),
        productId: normalizeString(feedbackEntry.productId),
        orderId: normalizeString(feedbackEntry.orderId),
        feedback: {
            outcome: normalizeString(feedbackEntry.feedback),
            selectedSize,
            recommendedSize,
            source: normalizeString(feedbackEntry.source) || 'manual',
            confidence: normalizeOptionalNumber(feedbackEntry.confidence),
            modelVersion: normalizeString(feedbackEntry.modelVersion),
            createdAt: normalizeDate(feedbackEntry.createdAt)
        },
        product: {
            productId: normalizeString(product._id),
            name: normalizeString(product.name),
            category: normalizeString(product.category),
            subCategory: normalizeString(product.subCategory),
            status: normalizeString(product.status),
            fitEnabled: Boolean(normalizedProduct.fitEnabled),
            sizeScale: normalizeString(normalizedProduct.sizeScale),
            sizes: Array.isArray(normalizedProduct.sizes) ? normalizedProduct.sizes.map((size) => normalizeSizeLabel(size)).filter(Boolean) : [],
            fitProfile: normalizedProduct.fitProfile,
            fitProfileSummary: normalizedProduct.fitProfileSummary
        },
        user: {
            userId: normalizeString(user._id),
            heightCm: userHeightCm,
            weightKg: userWeightKg,
            preferredFit: normalizeString(user?.fitProfile?.preferredFit) || 'regular',
            bodyFeatures: normalizeBodyFeatures(user?.fitProfile?.bodyFeatures),
            lastScanAt: normalizeDate(user?.fitProfile?.lastScanAt)
        },
        orderContext: {
            orderDate: normalizeDate(order?.date),
            deliveredAt: normalizeDate(order?.deliveredAt),
            status: normalizeString(order?.status),
            checkoutSource: normalizeString(order?.checkoutSource),
            itemSize: normalizeSizeLabel(orderItem?.size),
            fitAssistant: {
                recommendedSize: normalizeSizeLabel(orderItem?.fitAssistant?.recommendedSize),
                confidence: normalizeOptionalNumber(orderItem?.fitAssistant?.confidence),
                source: normalizeString(orderItem?.fitAssistant?.source) || 'manual',
                modelVersion: normalizeString(orderItem?.fitAssistant?.modelVersion)
            }
        }
    };
};

const exportFitTrainingData = async (options) => {
    const summary = createSummary();
    const feedbackFilter = options.since ? { createdAt: { $gte: options.since } } : {};
    const feedbackQuery = fitFeedbackModel
        .find(feedbackFilter)
        .sort({ createdAt: 1 })
        .select('_id userId productId orderId selectedSize recommendedSize feedback source confidence modelVersion createdAt')
        .lean();

    if (options.limit) {
        feedbackQuery.limit(options.limit);
    }

    const feedbackEntries = await feedbackQuery;
    summary.scannedFeedbackEntries = feedbackEntries.length;

    const orderIds = [...new Set(feedbackEntries.map((entry) => normalizeString(entry.orderId)).filter(Boolean))];
    const productIds = [...new Set(feedbackEntries.map((entry) => normalizeString(entry.productId)).filter(Boolean))];
    const userIds = [...new Set(feedbackEntries.map((entry) => normalizeString(entry.userId)).filter(Boolean))];

    const [orders, products, users] = await Promise.all([
        orderModel
            .find({ _id: { $in: orderIds } })
            .select('_id userId items status date deliveredAt checkoutSource')
            .lean(),
        productModel
            .find({ _id: { $in: productIds } })
            .select('_id name category subCategory status sizes fitEnabled sizeScale fitProfile')
            .lean(),
        userModel
            .find({ _id: { $in: userIds } })
            .select('_id fitProfile.heightCm fitProfile.weightKg fitProfile.preferredFit fitProfile.bodyFeatures fitProfile.lastScanAt')
            .lean()
    ]);

    const orderMap = new Map((orders || []).map((order) => [normalizeString(order._id), order]));
    const productMap = new Map((products || []).map((product) => [normalizeString(product._id), product]));
    const userMap = new Map((users || []).map((user) => [normalizeString(user._id), user]));

    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    const writer = fs.createWriteStream(options.out, { encoding: 'utf8' });

    try {
        for (const feedbackEntry of feedbackEntries) {
            const orderId = normalizeString(feedbackEntry.orderId);
            const productId = normalizeString(feedbackEntry.productId);
            const userId = normalizeString(feedbackEntry.userId);
            const order = orderMap.get(orderId);
            const product = productMap.get(productId);
            const user = userMap.get(userId);

            if (!order) {
                incrementSummary(summary, 'missingOrder');
                continue;
            }

            if (!product) {
                incrementSummary(summary, 'missingProduct');
                continue;
            }

            if (!user) {
                incrementSummary(summary, 'missingUser');
                continue;
            }

            const orderItem = findMatchingOrderItem(order, productId);
            if (!orderItem) {
                incrementSummary(summary, 'missingOrderItem');
                continue;
            }

            const normalizedProduct = normalizeProductFitData(product);
            if (!normalizedProduct.fitEnabled) {
                incrementSummary(summary, 'productNotFitEnabled');
                continue;
            }

            if (!options.includeUnready && !normalizedProduct.fitProfileSummary?.ready) {
                incrementSummary(summary, 'productNotReady');
                continue;
            }

            if (
                normalizeOptionalNumber(user?.fitProfile?.heightCm, 2) === null ||
                normalizeOptionalNumber(user?.fitProfile?.weightKg, 2) === null
            ) {
                incrementSummary(summary, 'missingUserMetrics');
                continue;
            }

            const selectedSize = normalizeSizeLabel(feedbackEntry.selectedSize || orderItem?.size);
            const recommendedSize = normalizeSizeLabel(
                feedbackEntry.recommendedSize || orderItem?.fitAssistant?.recommendedSize
            );

            if (!selectedSize) {
                incrementSummary(summary, 'invalidSelectedSize');
                continue;
            }

            if (!recommendedSize) {
                incrementSummary(summary, 'invalidRecommendedSize');
                continue;
            }

            const record = buildExportRecord({
                feedbackEntry,
                product,
                order,
                orderItem,
                user
            });

            if (!writer.write(`${JSON.stringify(record)}\n`)) {
                await once(writer, 'drain');
            }

            summary.exportedRecords += 1;
        }
    } finally {
        writer.end();
        await once(writer, 'finish');
    }

    return summary;
};

const main = async () => {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
        console.log(HELP_TEXT);
        return;
    }

    if (!normalizeString(process.env.MONGODB_URI)) {
        throw new Error('MONGODB_URI is required to export fit training data');
    }

    await connectDB();

    try {
        const summary = await exportFitTrainingData(options);
        console.log(
            JSON.stringify(
                {
                    outputPath: options.out,
                    ...summary
                },
                null,
                2
            )
        );
    } finally {
        await mongoose.disconnect();
    }
};

main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
});
