const FIT_SIZE_SCALE_VALUES = ['alpha', 'numeric', 'waist', 'custom'];
const FIT_BIAS_VALUES = ['runs_small', 'true_to_size', 'runs_large'];
const FIT_MEASUREMENT_TEMPLATES = {
    topwear: ['chest', 'shoulder', 'garmentLength'],
    bottomwear: ['waist', 'hip', 'inseam'],
    dress: ['chest', 'waist', 'hip', 'garmentLength'],
    outerwear: ['chest', 'shoulder', 'sleeveLength', 'garmentLength'],
    kids_general: ['chest', 'waist', 'hip', 'garmentLength']
};
const FIT_MEASUREMENT_FIELDS = [
    'chest',
    'waist',
    'hip',
    'shoulder',
    'sleeveLength',
    'inseam',
    'garmentLength'
];
const DEFAULT_FIT_PROFILE = {
    measurementTemplate: 'topwear',
    fitBias: 'true_to_size',
    stretchScore: 0.25,
    measurementUnit: 'cm',
    sizeMeasurements: []
};

const normalizeString = (value) => String(value || '').trim();

const normalizeSizeLabel = (value) => normalizeString(value).toUpperCase();

const normalizeNumber = (value) => {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        return null;
    }

    return Number(parsedValue.toFixed(2));
};

const normalizeBoolean = (value) => value === true || value === 'true' || value === 1 || value === '1';

const normalizeSizeMeasurements = (sizeMeasurements = [], sizes = []) => {
    const normalizedSizes = Array.isArray(sizes) ? sizes.map(normalizeSizeLabel).filter(Boolean) : [];
    const sizeMap = new Map();

    normalizedSizes.forEach((size) => {
        sizeMap.set(size, { size });
    });

    (Array.isArray(sizeMeasurements) ? sizeMeasurements : []).forEach((item) => {
        const size = normalizeSizeLabel(item?.size);

        if (!size || (normalizedSizes.length > 0 && !normalizedSizes.includes(size))) {
            return;
        }

        const baseEntry = sizeMap.get(size) || { size };
        const nextEntry = { ...baseEntry };

        FIT_MEASUREMENT_FIELDS.forEach((field) => {
            nextEntry[field] = normalizeNumber(item?.[field]);
        });

        sizeMap.set(size, nextEntry);
    });

    return Array.from(sizeMap.values()).map((item) => {
        const normalizedItem = { size: item.size };
        FIT_MEASUREMENT_FIELDS.forEach((field) => {
            normalizedItem[field] = normalizeNumber(item[field]);
        });
        return normalizedItem;
    });
};

const getMeasurementTemplateFields = (template) =>
    FIT_MEASUREMENT_TEMPLATES[normalizeString(template)] || FIT_MEASUREMENT_TEMPLATES.topwear;

const buildProductFitConfig = ({
    fitEnabled = false,
    sizeScale = 'alpha',
    measurementTemplate = DEFAULT_FIT_PROFILE.measurementTemplate,
    fitBias = DEFAULT_FIT_PROFILE.fitBias,
    stretchScore = DEFAULT_FIT_PROFILE.stretchScore,
    sizeMeasurements = [],
    sizes = []
} = {}) => {
    const normalizedTemplate = FIT_MEASUREMENT_TEMPLATES[measurementTemplate]
        ? measurementTemplate
        : DEFAULT_FIT_PROFILE.measurementTemplate;
    const normalizedFitBias = FIT_BIAS_VALUES.includes(fitBias) ? fitBias : DEFAULT_FIT_PROFILE.fitBias;
    const normalizedSizeScale = FIT_SIZE_SCALE_VALUES.includes(sizeScale) ? sizeScale : 'alpha';
    const normalizedStretchScore = normalizeNumber(stretchScore);

    return {
        fitEnabled: normalizeBoolean(fitEnabled),
        sizeScale: normalizedSizeScale,
        fitProfile: {
            measurementTemplate: normalizedTemplate,
            fitBias: normalizedFitBias,
            stretchScore: normalizedStretchScore === null ? DEFAULT_FIT_PROFILE.stretchScore : Math.min(1, normalizedStretchScore),
            measurementUnit: 'cm',
            sizeMeasurements: normalizeSizeMeasurements(sizeMeasurements, sizes)
        }
    };
};

const buildFitProfileSummary = ({ fitEnabled = false, sizeScale = 'alpha', sizes = [], fitProfile = {} } = {}) => {
    const normalizedSizes = Array.isArray(sizes) ? sizes.map(normalizeSizeLabel).filter(Boolean) : [];
    const normalizedFitProfile = {
        ...DEFAULT_FIT_PROFILE,
        ...(fitProfile || {})
    };
    const requiredFields = getMeasurementTemplateFields(normalizedFitProfile.measurementTemplate);
    const sizeMeasurements = normalizeSizeMeasurements(normalizedFitProfile.sizeMeasurements, normalizedSizes);
    const totalRequiredFields = normalizedSizes.length * requiredFields.length;

    let completedFields = 0;
    let completedSizes = 0;

    sizeMeasurements.forEach((entry) => {
        const filledFieldsForSize = requiredFields.filter((field) => normalizeNumber(entry?.[field]) !== null);
        completedFields += filledFieldsForSize.length;
        if (filledFieldsForSize.length === requiredFields.length) {
            completedSizes += 1;
        }
    });

    const minimumSizeCount = normalizedSizes.length > 1 ? 2 : 1;
    const completenessRatio = totalRequiredFields > 0 ? Number((completedFields / totalRequiredFields).toFixed(2)) : 0;
    const ready =
        normalizeBoolean(fitEnabled) &&
        normalizedSizes.length >= minimumSizeCount &&
        completedSizes >= minimumSizeCount &&
        requiredFields.length > 0;

    return {
        enabled: normalizeBoolean(fitEnabled),
        ready,
        sizeScale: FIT_SIZE_SCALE_VALUES.includes(normalizeString(sizeScale)) ? normalizeString(sizeScale) : 'alpha',
        measurementTemplate: normalizedFitProfile.measurementTemplate,
        requiredFields,
        totalSizes: normalizedSizes.length,
        completedSizes,
        completenessRatio
    };
};

const normalizeProductFitData = (product = {}) => {
    const normalizedConfig = buildProductFitConfig({
        fitEnabled: product.fitEnabled,
        sizeScale: product.sizeScale,
        measurementTemplate: product.fitProfile?.measurementTemplate,
        fitBias: product.fitProfile?.fitBias,
        stretchScore: product.fitProfile?.stretchScore,
        sizeMeasurements: product.fitProfile?.sizeMeasurements,
        sizes: product.sizes
    });
    const fitProfileSummary = buildFitProfileSummary({
        fitEnabled: normalizedConfig.fitEnabled,
        sizeScale: normalizedConfig.sizeScale,
        sizes: product.sizes,
        fitProfile: normalizedConfig.fitProfile
    });

    return {
        ...product,
        ...normalizedConfig,
        fitProfileSummary
    };
};

export {
    DEFAULT_FIT_PROFILE,
    FIT_BIAS_VALUES,
    FIT_MEASUREMENT_FIELDS,
    FIT_MEASUREMENT_TEMPLATES,
    FIT_SIZE_SCALE_VALUES,
    buildFitProfileSummary,
    buildProductFitConfig,
    getMeasurementTemplateFields,
    normalizeNumber,
    normalizeProductFitData,
    normalizeSizeLabel,
    normalizeSizeMeasurements
};
