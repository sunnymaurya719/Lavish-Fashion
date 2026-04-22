import mongoose from 'mongoose';
import paymentSettingsModel, { PAYMENT_SETTINGS_KEY } from '../models/paymentSettingsModel.js';

const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);

const normalizeEnvValue = (value) => String(value ?? '').trim().toLowerCase();

const resolveBooleanFromEnv = (value, fallback = true) => {
    const normalizedValue = normalizeEnvValue(value);

    if (!normalizedValue) {
        return fallback;
    }

    return TRUE_ENV_VALUES.has(normalizedValue);
};

const getDefaultPaymentSettings = () => ({
    codEnabled: resolveBooleanFromEnv(process.env.COD_ENABLED, true)
});

const buildActorUpdate = (actor = {}) => ({
    updatedByAdminId: mongoose.Types.ObjectId.isValid(actor?.id) ? actor.id : null,
    updatedByAdminEmail: String(actor?.email || '').trim().toLowerCase()
});

const serializePaymentSettings = (doc) => {
    const defaults = getDefaultPaymentSettings();
    const hasStoredSettings = Boolean(doc);

    return {
        codEnabled: hasStoredSettings ? doc.codEnabled !== false : defaults.codEnabled,
        source: hasStoredSettings ? 'database' : 'env_default',
        defaults,
        updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
        updatedBy: {
            id: doc?.updatedByAdminId ? String(doc.updatedByAdminId) : null,
            email: String(doc?.updatedByAdminEmail || '').trim().toLowerCase()
        }
    };
};

const getPaymentSettings = async () => {
    const doc = await paymentSettingsModel.findOne({ key: PAYMENT_SETTINGS_KEY }).lean();
    return serializePaymentSettings(doc);
};

const isCodEnabled = async () => {
    const settings = await getPaymentSettings();
    return Boolean(settings.codEnabled);
};

const updatePaymentSettings = async ({ codEnabled, actor }) => {
    const doc = await paymentSettingsModel
        .findOneAndUpdate(
            { key: PAYMENT_SETTINGS_KEY },
            {
                $set: {
                    codEnabled: Boolean(codEnabled),
                    ...buildActorUpdate(actor)
                },
                $setOnInsert: {
                    key: PAYMENT_SETTINGS_KEY
                }
            },
            {
                new: true,
                upsert: true,
                setDefaultsOnInsert: true
            }
        )
        .lean();

    return serializePaymentSettings(doc);
};

export { getDefaultPaymentSettings, getPaymentSettings, isCodEnabled, updatePaymentSettings };
