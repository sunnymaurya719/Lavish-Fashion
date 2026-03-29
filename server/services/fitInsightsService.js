import fitFeedbackModel from '../models/fitFeedbackModel.js';
import orderModel from '../models/orderModel.js';
import userModel from '../models/userModel.js';

const DEFAULT_FIT_BIAS = 'true_to_size';
const PERSONALIZED_CROWD_MIN_SAMPLES = 3;
const PERSONALIZED_CROWD_MIN_SHARE = 0.5;
const GENERIC_CROWD_MIN_SAMPLES = 8;
const GENERIC_CROWD_MIN_SHARE = 0.35;
const MIN_FEEDBACK_FOR_TREND = 4;
const HEIGHT_TOLERANCE_CM = 7.5;
const WEIGHT_TOLERANCE_KG = 7.5;

const normalizeSize = (value) => String(value || '').trim().toUpperCase();
const normalizeFitBias = (value) =>
    ['runs_small', 'true_to_size', 'runs_large'].includes(String(value || '').trim())
        ? String(value).trim()
        : DEFAULT_FIT_BIAS;

const countSizeSelections = (sizes = []) =>
    sizes.reduce((counts, sizeValue) => {
        const size = normalizeSize(sizeValue);

        if (!size) {
            return counts;
        }

        counts[size] = (counts[size] || 0) + 1;
        return counts;
    }, {});

const resolveDominantSize = ({ sizeCounts = {}, minimumSamples = 0, minimumShare = 0, minimumCount = 1 }) => {
    const entries = Object.entries(sizeCounts).sort((left, right) => right[1] - left[1]);

    if (entries.length === 0) {
        return null;
    }

    const totalSamples = entries.reduce((sum, [, count]) => sum + Number(count || 0), 0);
    const [topSize, topCount] = entries[0];

    if (
        totalSamples < minimumSamples ||
        Number(topCount || 0) < minimumCount ||
        Number(topCount || 0) / Math.max(totalSamples, 1) < minimumShare
    ) {
        return null;
    }

    return {
        size: topSize,
        count: Number(topCount || 0),
        sampleCount: totalSamples
    };
};

const inferFitBiasFromFeedback = ({ feedbackEntries = [], fallbackFitBias = DEFAULT_FIT_BIAS }) => {
    if (!Array.isArray(feedbackEntries) || feedbackEntries.length < MIN_FEEDBACK_FOR_TREND) {
        return normalizeFitBias(fallbackFitBias);
    }

    const totals = feedbackEntries.reduce(
        (counts, entry) => {
            const feedbackValue = String(entry?.feedback || '').trim();

            if (feedbackValue === 'too_small') {
                counts.tooSmall += 1;
            } else if (feedbackValue === 'too_large') {
                counts.tooLarge += 1;
            } else if (feedbackValue === 'perfect') {
                counts.perfect += 1;
            }

            return counts;
        },
        { tooSmall: 0, tooLarge: 0, perfect: 0 }
    );
    const totalFeedback = totals.tooSmall + totals.tooLarge + totals.perfect;

    if (totals.tooSmall >= Math.max(3, Math.ceil(totalFeedback * 0.5)) && totals.tooSmall > totals.tooLarge) {
        return 'runs_small';
    }

    if (totals.tooLarge >= Math.max(3, Math.ceil(totalFeedback * 0.5)) && totals.tooLarge > totals.tooSmall) {
        return 'runs_large';
    }

    return DEFAULT_FIT_BIAS;
};

const buildGenericCrowdSignal = (orders = [], productId = '') => {
    const normalizedProductId = String(productId || '').trim();
    const sizeCounts = countSizeSelections(
        orders.flatMap((order) =>
            Array.isArray(order?.items)
                ? order.items
                    .filter((item) => String(item?._id || '').trim() === normalizedProductId)
                    .map((item) => item.size)
                : []
        )
    );
    const dominantSize = resolveDominantSize({
        sizeCounts,
        minimumSamples: GENERIC_CROWD_MIN_SAMPLES,
        minimumShare: GENERIC_CROWD_MIN_SHARE,
        minimumCount: 3
    });

    if (!dominantSize) {
        return {
            crowdSignal: '',
            dominantSize: '',
            sampleCount: 0
        };
    }

    return {
        crowdSignal: `Most shoppers buy ${dominantSize.size} in this style.`,
        dominantSize: dominantSize.size,
        sampleCount: dominantSize.sampleCount
    };
};

const matchesMeasurementCohort = (fitProfile = {}, userMetrics = {}) => {
    const heightCm = Number(fitProfile?.heightCm || 0);
    const weightKg = Number(fitProfile?.weightKg || 0);
    const targetHeightCm = Number(userMetrics?.heightCm || 0);
    const targetWeightKg = Number(userMetrics?.weightKg || 0);

    if (!heightCm || !weightKg || !targetHeightCm || !targetWeightKg) {
        return false;
    }

    return (
        Math.abs(heightCm - targetHeightCm) <= HEIGHT_TOLERANCE_CM &&
        Math.abs(weightKg - targetWeightKg) <= WEIGHT_TOLERANCE_KG
    );
};

const buildPersonalizedCrowdSignal = async ({ feedbackEntries = [], userMetrics = null }) => {
    if (!userMetrics || !Array.isArray(feedbackEntries) || feedbackEntries.length === 0) {
        return {
            crowdSignal: '',
            sampleCount: 0
        };
    }

    const uniqueUserIds = [...new Set(feedbackEntries.map((entry) => String(entry?.userId || '').trim()).filter(Boolean))];

    if (uniqueUserIds.length === 0) {
        return {
            crowdSignal: '',
            sampleCount: 0
        };
    }

    const cohortUsers = await userModel.find({ _id: { $in: uniqueUserIds } }).select('_id fitProfile').lean();
    const userMap = new Map(cohortUsers.map((user) => [String(user._id), user]));
    const sizeCounts = countSizeSelections(
        feedbackEntries
            .filter((entry) => matchesMeasurementCohort(userMap.get(String(entry.userId))?.fitProfile, userMetrics))
            .map((entry) => entry.selectedSize)
    );
    const dominantSize = resolveDominantSize({
        sizeCounts,
        minimumSamples: PERSONALIZED_CROWD_MIN_SAMPLES,
        minimumShare: PERSONALIZED_CROWD_MIN_SHARE,
        minimumCount: 2
    });

    if (!dominantSize) {
        return {
            crowdSignal: '',
            sampleCount: 0
        };
    }

    return {
        crowdSignal: `Shoppers close to your measurements usually buy ${dominantSize.size}.`,
        sampleCount: dominantSize.sampleCount
    };
};

const getFitInsightsForProduct = async ({ product, userMetrics = null }) => {
    const productId = String(product?._id || '').trim();
    const fallbackFitBias = normalizeFitBias(product?.fitProfile?.fitBias);

    if (!productId) {
        return {
            fitBias: fallbackFitBias,
            crowdSignal: '',
            dominantSize: '',
            feedbackCount: 0,
            crowdSampleCount: 0
        };
    }

    const [feedbackEntries, deliveredOrders] = await Promise.all([
        fitFeedbackModel.find({ productId }).select('userId selectedSize feedback').lean(),
        orderModel.find({
            status: 'Delivered',
            'items._id': productId
        }).select('items').lean()
    ]);
    const personalizedSignal = await buildPersonalizedCrowdSignal({ feedbackEntries, userMetrics });
    const genericSignal = buildGenericCrowdSignal(deliveredOrders, productId);

    return {
        fitBias: inferFitBiasFromFeedback({ feedbackEntries, fallbackFitBias }),
        crowdSignal: personalizedSignal.crowdSignal || genericSignal.crowdSignal,
        dominantSize: genericSignal.dominantSize,
        feedbackCount: feedbackEntries.length,
        crowdSampleCount: personalizedSignal.sampleCount || genericSignal.sampleCount
    };
};

export { getFitInsightsForProduct };
