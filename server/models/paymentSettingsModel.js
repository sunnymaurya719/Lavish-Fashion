import mongoose from 'mongoose';

const PAYMENT_SETTINGS_KEY = 'default';

const paymentSettingsSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            default: PAYMENT_SETTINGS_KEY,
            unique: true,
            immutable: true,
            trim: true
        },
        codEnabled: {
            type: Boolean,
            default: true
        },
        updatedByAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user',
            default: null
        },
        updatedByAdminEmail: {
            type: String,
            default: '',
            trim: true,
            lowercase: true,
            maxlength: 255
        }
    },
    {
        timestamps: true,
        minimize: false
    }
);

const paymentSettingsModel =
    mongoose.models.payment_settings || mongoose.model('payment_settings', paymentSettingsSchema);

export { PAYMENT_SETTINGS_KEY };
export default paymentSettingsModel;
