import { getMeasurementTemplateFields, normalizeProductFitData } from './productFitProfileService.js';

const MODEL_VERSION = 'rule-engine-v1';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const roundValue = (value, precision = 2) => Number(Number(value || 0).toFixed(precision));

const circumferenceEaseByFit = {
    chest: { slim: 4, regular: 8, relaxed: 12 },
    waist: { slim: 2, regular: 5, relaxed: 8 },
    hip: { slim: 3, regular: 6, relaxed: 9 },
    shoulder: { slim: 0.5, regular: 1.5, relaxed: 3 }
};

const fieldWeights = {
    chest: 1.4,
    waist: 1.25,
    hip: 1.25,
    shoulder: 1.15,
    sleeveLength: 0.55,
    inseam: 0.8,
    garmentLength: 0.65
};

const fieldLabels = {
    chest: 'chest room',
    waist: 'waist balance',
    hip: 'hip ease',
    shoulder: 'shoulder width',
    sleeveLength: 'sleeve length',
    inseam: 'inseam length',
    garmentLength: 'overall length'
};

const categoryBodyEstimateFactors = {
    Men: {
        chest: { height: 0.51, weight: 0.21, base: -2 },
        waist: { height: 0.42, weight: 0.22, base: -4 },
        hip: { height: 0.5, weight: 0.18, base: -6 },
        shoulder: { height: 0.255, weight: 0.015, base: -1 }
    },
    Women: {
        chest: { height: 0.49, weight: 0.18, base: -4 },
        waist: { height: 0.39, weight: 0.2, base: -5 },
        hip: { height: 0.54, weight: 0.17, base: -6 },
        shoulder: { height: 0.235, weight: 0.01, base: -0.5 }
    },
    Kids: {
        chest: { height: 0.47, weight: 0.12, base: 4 },
        waist: { height: 0.4, weight: 0.12, base: 1 },
        hip: { height: 0.48, weight: 0.13, base: 2 },
        shoulder: { height: 0.23, weight: 0.008, base: 0 }
    }
};

const getBiasOffset = (fitBias) => {
    if (fitBias === 'runs_small') {
        return -1.25;
    }

    if (fitBias === 'runs_large') {
        return 1.25;
    }

    return 0;
};

const getLengthExpectation = ({ heightCm, measurementTemplate, field }) => {
    if (field === 'inseam') {
        return heightCm * 0.45;
    }

    if (field === 'sleeveLength') {
        return heightCm * 0.34;
    }

    const garmentLengthMultipliers = {
        topwear: 0.42,
        bottomwear: 0.45,
        dress: 0.63,
        outerwear: 0.47,
        kids_general: 0.41
    };

    return heightCm * (garmentLengthMultipliers[measurementTemplate] || 0.42);
};

const estimateBodyProfile = ({ heightCm, weightKg, category, preferredFit }) => {
    const normalizedCategory = categoryBodyEstimateFactors[category] ? category : 'Men';
    const factors = categoryBodyEstimateFactors[normalizedCategory];
    const heightMeters = heightCm / 100;
    const bmi = weightKg / Math.max(heightMeters * heightMeters, 0.1);
    const frameAdjustment = clamp((bmi - 22) * 0.55, -4, 7);
    const fitAdjustment =
        preferredFit === 'relaxed' ? 0.6 : preferredFit === 'slim' ? -0.35 : 0;

    return {
        chest: roundValue(factors.chest.height * heightCm + factors.chest.weight * weightKg + factors.chest.base + frameAdjustment),
        waist: roundValue(factors.waist.height * heightCm + factors.waist.weight * weightKg + factors.waist.base + frameAdjustment),
        hip: roundValue(factors.hip.height * heightCm + factors.hip.weight * weightKg + factors.hip.base + frameAdjustment * 0.6),
        shoulder: roundValue(
            factors.shoulder.height * heightCm + factors.shoulder.weight * weightKg + factors.shoulder.base + fitAdjustment
        ),
        bmi: roundValue(bmi)
    };
};

const getTargetMeasurement = ({ field, estimatedBodyProfile, stretchScore, preferredFit, heightCm, measurementTemplate }) => {
    if (field === 'sleeveLength' || field === 'inseam' || field === 'garmentLength') {
        return getLengthExpectation({ heightCm, measurementTemplate, field });
    }

    const preferredEase = circumferenceEaseByFit[field]?.[preferredFit] ?? circumferenceEaseByFit.waist.regular;
    const stretchAdjustment = field === 'shoulder' ? stretchScore * 0.75 : stretchScore * 2.2;
    return estimatedBodyProfile[field] + Math.max(0, preferredEase - stretchAdjustment);
};

const evaluateSize = ({ sizeEntry, normalizedProduct, estimatedBodyProfile, userMetrics }) => {
    const requiredFields = getMeasurementTemplateFields(normalizedProduct.fitProfile.measurementTemplate);
    const stretchScore = Number(normalizedProduct.fitProfile.stretchScore || 0.25);
    const fitBiasOffset = getBiasOffset(normalizedProduct.fitProfile.fitBias);

    let totalPenalty = 0;
    let weightedScore = 0;
    let totalWeight = 0;
    const fieldBreakdown = [];

    requiredFields.forEach((field) => {
        const rawMeasurement = Number(sizeEntry?.[field] || 0);
        const weight = fieldWeights[field] || 1;

        if (!rawMeasurement) {
            totalPenalty += 6;
            fieldBreakdown.push({ field, penalty: 6, delta: -6, measurement: null });
            totalWeight += weight;
            return;
        }

        const adjustedMeasurement =
            field === 'sleeveLength' || field === 'inseam' || field === 'garmentLength'
                ? rawMeasurement
                : rawMeasurement + fitBiasOffset;
        const targetMeasurement = getTargetMeasurement({
            field,
            estimatedBodyProfile,
            stretchScore,
            preferredFit: userMetrics.preferredFit,
            heightCm: userMetrics.heightCm,
            measurementTemplate: normalizedProduct.fitProfile.measurementTemplate
        });
        const delta = adjustedMeasurement - targetMeasurement;
        const penalty =
            field === 'sleeveLength' || field === 'inseam' || field === 'garmentLength'
                ? Math.abs(delta) * 0.22 * weight
                : delta >= 0
                    ? delta * 0.35 * weight
                    : Math.abs(delta) * 1.1 * weight;

        totalPenalty += penalty;
        weightedScore += delta * weight;
        totalWeight += weight;
        fieldBreakdown.push({
            field,
            penalty: roundValue(penalty),
            delta: roundValue(delta),
            measurement: roundValue(adjustedMeasurement)
        });
    });

    return {
        size: sizeEntry.size,
        penalty: roundValue(totalPenalty),
        fitScore: totalWeight > 0 ? roundValue(weightedScore / totalWeight) : 0,
        fieldBreakdown: fieldBreakdown.sort((left, right) => left.penalty - right.penalty)
    };
};

const buildRecommendationReason = ({ bestCandidate, normalizedProduct }) => {
    const topFields = bestCandidate.fieldBreakdown
        .filter((item) => item.measurement !== null)
        .slice(0, 2)
        .map((item) => fieldLabels[item.field] || item.field);
    const stretchScore = Number(normalizedProduct.fitProfile.stretchScore || 0.25);
    const stretchLabel = stretchScore >= 0.6 ? 'higher stretch' : stretchScore >= 0.3 ? 'moderate stretch' : 'lower stretch';

    if (bestCandidate.fitScore < -1.5) {
        return `Closest match for ${topFields.join(' and ')} while avoiding an overly tight fit on this ${stretchLabel} garment.`;
    }

    if (bestCandidate.fitScore > 1.5) {
        return `Best balance for ${topFields.join(' and ')} without looking too loose on this ${stretchLabel} garment.`;
    }

    return `Best balance for ${topFields.join(' and ')} with the current cut and ${stretchLabel} profile.`;
};

const buildRangeLabel = ({ bestSize, alternativeSize, sizes }) => {
    if (!alternativeSize) {
        return bestSize;
    }

    const normalizedSizes = Array.isArray(sizes) ? sizes.map((size) => String(size || '').trim()) : [];
    const firstIndex = normalizedSizes.indexOf(bestSize);
    const secondIndex = normalizedSizes.indexOf(alternativeSize);

    if (firstIndex === -1 || secondIndex === -1) {
        return `${bestSize}-${alternativeSize}`;
    }

    return firstIndex < secondIndex ? `${bestSize}-${alternativeSize}` : `${alternativeSize}-${bestSize}`;
};

const buildRuleBasedFitRecommendation = ({ product, userMetrics }) => {
    const normalizedProduct = normalizeProductFitData(product);

    if (!normalizedProduct.fitProfileSummary?.ready) {
        const error = new Error('This product does not have enough fit data for recommendations yet.');
        error.statusCode = 422;
        throw error;
    }

    const preferredFit = ['slim', 'regular', 'relaxed'].includes(userMetrics?.preferredFit)
        ? userMetrics.preferredFit
        : 'regular';
    const normalizedUserMetrics = {
        heightCm: Number(userMetrics.heightCm),
        weightKg: Number(userMetrics.weightKg),
        preferredFit
    };
    const estimatedBodyProfile = estimateBodyProfile({
        heightCm: normalizedUserMetrics.heightCm,
        weightKg: normalizedUserMetrics.weightKg,
        category: normalizedProduct.category,
        preferredFit
    });
    const candidates = normalizedProduct.fitProfile.sizeMeasurements
        .filter((entry) => entry?.size)
        .map((entry) =>
            evaluateSize({
                sizeEntry: entry,
                normalizedProduct,
                estimatedBodyProfile,
                userMetrics: normalizedUserMetrics
            })
        )
        .sort((left, right) => left.penalty - right.penalty);

    if (candidates.length === 0) {
        const error = new Error('No size measurements are available for this product.');
        error.statusCode = 422;
        throw error;
    }

    const bestCandidate = candidates[0];
    const secondCandidate = candidates[1] || null;
    const penaltyScore = clamp(1 - bestCandidate.penalty / 18, 0, 1);
    const marginScore = secondCandidate ? clamp((secondCandidate.penalty - bestCandidate.penalty) / 10, 0, 0.2) : 0.16;
    const confidence = roundValue(clamp(0.38 + penaltyScore * 0.42 + marginScore, 0.38, 0.96));
    const alternatives = candidates.slice(1, 3).map((candidate) => ({
        size: candidate.size,
        confidence: roundValue(clamp(confidence - (candidate.penalty - bestCandidate.penalty) / 14, 0.18, 0.82))
    }));

    return {
        source: 'rule_engine',
        recommendation: {
            size: bestCandidate.size,
            confidence,
            reason: buildRecommendationReason({ bestCandidate, normalizedProduct }),
            range: confidence < 0.6 ? buildRangeLabel({
                bestSize: bestCandidate.size,
                alternativeSize: alternatives[0]?.size,
                sizes: normalizedProduct.sizes
            }) : ''
        },
        alternatives,
        insights: {
            fitBias: normalizedProduct.fitProfile.fitBias,
            crowdSignal: ''
        },
        meta: {
            modelVersion: MODEL_VERSION,
            fitTemplate: normalizedProduct.fitProfile.measurementTemplate,
            estimatedBodyProfile
        }
    };
};

export { MODEL_VERSION, buildRuleBasedFitRecommendation };
