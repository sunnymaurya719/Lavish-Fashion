import userModel from '../models/userModel.js';
import { getCachedFitRecommendation, setCachedFitRecommendation } from './fitCacheService.js';
import { getFitInsightsForProduct } from './fitInsightsService.js';
import { buildRuleBasedFitRecommendation } from './fitRuleEngineService.js';
import { isMlServiceConfigured, requestMlSizeRecommendation } from './mlGatewayService.js';
import { getFitConfidenceMin } from './fitRuntimeService.js';

const normalizeOptionalNumber = (value) => {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? Number(parsedValue.toFixed(4)) : null;
};

const normalizeBodyFeatures = (bodyFeatures = null) => {
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

const buildRangeLabel = ({ bestSize = '', alternativeSize = '', sizes = [] }) => {
    const normalizedBestSize = String(bestSize || '').trim();
    const normalizedAlternativeSize = String(alternativeSize || '').trim();

    if (!normalizedBestSize) {
        return '';
    }

    if (!normalizedAlternativeSize || normalizedAlternativeSize === normalizedBestSize) {
        return normalizedBestSize;
    }

    const normalizedSizes = Array.isArray(sizes) ? sizes.map((size) => String(size || '').trim()) : [];
    const firstIndex = normalizedSizes.indexOf(normalizedBestSize);
    const secondIndex = normalizedSizes.indexOf(normalizedAlternativeSize);

    if (firstIndex === -1 || secondIndex === -1) {
        return `${normalizedBestSize}-${normalizedAlternativeSize}`;
    }

    return firstIndex < secondIndex
        ? `${normalizedBestSize}-${normalizedAlternativeSize}`
        : `${normalizedAlternativeSize}-${normalizedBestSize}`;
};

const applyConfidencePolicy = ({ result, product, bodyFeatures = null }) => {
    const confidenceMin = getFitConfidenceMin();
    const recommendationConfidence = Number(result?.recommendation?.confidence || 0);
    const lowConfidence = recommendationConfidence < confidenceMin;
    const confidenceBand = recommendationConfidence >= Math.min(0.85, confidenceMin + 0.18)
        ? 'high'
        : lowConfidence
            ? 'low'
            : 'medium';
    const fallbackRange =
        lowConfidence && !String(result?.recommendation?.range || '').trim()
            ? buildRangeLabel({
                bestSize: result?.recommendation?.size,
                alternativeSize: result?.alternatives?.[0]?.size,
                sizes: product?.sizes
            })
            : String(result?.recommendation?.range || '').trim();

    return {
        ...result,
        recommendation: {
            ...result.recommendation,
            range: fallbackRange
        },
        meta: {
            ...result.meta,
            confidenceMin,
            lowConfidence,
            confidenceBand,
            confidenceGuidance: lowConfidence
                ? bodyFeatures
                    ? 'Confidence is below the store threshold, so treat this as a best-fit range.'
                    : 'Confidence is below the store threshold. Add a camera scan or review the alternative size for a stronger recommendation.'
                : ''
        }
    };
};

const saveUserFitProfile = async ({ userId, userMetrics, bodyFeatures = null }) => {
    if (!userId) {
        return;
    }

    const updatePayload = {
        'fitProfile.heightCm': Number(userMetrics.heightCm),
        'fitProfile.weightKg': Number(userMetrics.weightKg),
        'fitProfile.preferredFit': userMetrics.preferredFit || 'regular'
    };
    const normalizedBodyFeatures = normalizeBodyFeatures(bodyFeatures);

    if (normalizedBodyFeatures) {
        updatePayload['fitProfile.bodyFeatures.shoulderRatio'] = normalizedBodyFeatures.shoulderRatio;
        updatePayload['fitProfile.bodyFeatures.hipRatio'] = normalizedBodyFeatures.hipRatio;
        updatePayload['fitProfile.bodyFeatures.torsoRatio'] = normalizedBodyFeatures.torsoRatio;
        updatePayload['fitProfile.bodyFeatures.scanQuality'] = normalizedBodyFeatures.scanQuality;
        updatePayload['fitProfile.lastScanAt'] = new Date();
    }

    await userModel.findByIdAndUpdate(
        userId,
        {
            $set: updatePayload
        },
        { runValidators: true }
    );
};

const recommendSizeForProduct = async ({ product, userMetrics, bodyFeatures = null, userId = '', requestId = '', log = null }) => {
    const mlConfigured = isMlServiceConfigured();
    const normalizedBodyFeatures = normalizeBodyFeatures(bodyFeatures);
    const cachedRecommendation = await getCachedFitRecommendation({
        product,
        userId,
        userMetrics,
        bodyFeatures: normalizedBodyFeatures,
        log,
        requestId
    });

    if (cachedRecommendation) {
        log?.info?.(
            {
                event: 'fit.cache.hit',
                requestId,
                cacheType: 'recommendation',
                productId: String(product?._id || '')
            },
            'Served fit recommendation from cache'
        );

        await saveUserFitProfile({
            userId,
            userMetrics,
            bodyFeatures: normalizedBodyFeatures
        });

        return {
            ...cachedRecommendation,
            meta: {
                ...(cachedRecommendation.meta || {}),
                cacheHit: true
            }
        };
    }

    let result = null;
    let fallbackReason = mlConfigured ? 'ml_not_attempted' : 'ml_not_configured';

    if (mlConfigured) {
        try {
            result = await requestMlSizeRecommendation({
                product,
                userMetrics,
                bodyFeatures: normalizedBodyFeatures,
                requestId,
                log
            });
            fallbackReason = '';
        } catch (error) {
            fallbackReason = error?.fallbackReason || 'ml_unavailable';
            log?.warn(
                {
                    event: 'fit.ml.fallback',
                    requestId,
                    fallbackReason
                },
                'Falling back to the rule engine for fit recommendation'
            );
        }
    }

    if (!result) {
        result = buildRuleBasedFitRecommendation({ product, userMetrics });
    }

    result = applyConfidencePolicy({
        result,
        product,
        bodyFeatures: normalizedBodyFeatures
    });

    let resolvedInsights = result.insights;

    try {
        resolvedInsights = await getFitInsightsForProduct({
            product,
            userMetrics
        });
    } catch (error) {
        log?.warn(
            {
                event: 'fit.insights.fallback',
                requestId,
                message: error?.message || 'Unknown fit insights failure'
            },
            'Falling back to embedded fit insights'
        );
    }

    const enrichedResult = {
        ...result,
        insights: {
            ...result.insights,
            ...resolvedInsights
        },
        meta: {
            ...result.meta,
            cacheHit: false,
            fallbackReason,
            mlConfigured
        }
    };

    await setCachedFitRecommendation({
        product,
        userId,
        userMetrics,
        bodyFeatures: normalizedBodyFeatures,
        recommendation: enrichedResult,
        log,
        requestId
    });

    await saveUserFitProfile({
        userId,
        userMetrics,
        bodyFeatures: normalizedBodyFeatures
    });

    return enrichedResult;
};

export { recommendSizeForProduct };
