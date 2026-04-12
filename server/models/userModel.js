import mongoose from "mongoose";

const objectIdStringRegex = /^[a-f\d]{24}$/i;

const isPlainObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const isValidCartData = (cartData) => {
    if (!isPlainObject(cartData)) {
        return false;
    }

    for (const [itemId, sizeMap] of Object.entries(cartData)) {
        if (!objectIdStringRegex.test(itemId) || !isPlainObject(sizeMap)) {
            return false;
        }

        for (const [size, quantity] of Object.entries(sizeMap)) {
            if (typeof size !== 'string' || size.trim().length === 0 || size.length > 10) {
                return false;
            }

            if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) {
                return false;
            }
        }
    }

    return true;
};

const isValidWishlist = (wishlist) =>
    Array.isArray(wishlist) && wishlist.every((itemId) => objectIdStringRegex.test(String(itemId || '')));

const referralCodeRegex = /^[A-Z0-9]{6,12}$/;
const hasLocalPassword = (value) => String(value || '').length >= 8;

const userSchema = new mongoose.Schema({

    name: {type:String, required:true, trim:true, minlength:2, maxlength:60},
    email: {type:String, required:true, unique:true, lowercase:true, trim:true},
    phone: {type:String, default:'', trim:true, maxlength:20},
    password: {
        type:String,
        default:'',
        maxlength:128,
        validate: {
            validator(value) {
                return hasLocalPassword(value) || Boolean(String(this.googleId || '').trim());
            },
            message: 'Password must be at least 8 characters when Google sign-in is not linked'
        }
    },
    authProvider: {
        type: String,
        enum: ['local', 'google', 'hybrid'],
        default: 'local'
    },
    avatarUrl: { type: String, default: '', trim: true, maxlength: 500 },
    googleId: { type: String, trim: true, unique: true, sparse: true, maxlength: 255 },
    googleEmailVerified: { type: Boolean, default: false },
    googlePicture: { type: String, default: '', trim: true, maxlength: 500 },
    googleLinkedAt: { type: Date, default: null },
    googleLastLoginAt: { type: Date, default: null },
    wishlist: {
        type: [String],
        default: [],
        validate: {
            validator: isValidWishlist,
            message: 'Invalid wishlist data structure'
        }
    },
    referralCode: {
        type: String,
        trim: true,
        uppercase: true,
        unique: true,
        sparse: true,
        validate: {
            validator: (value) => !value || referralCodeRegex.test(String(value || '')),
            message: 'Invalid referral code format'
        }
    },
    referredBy: {
        type: String,
        default: '',
        validate: {
            validator: (value) => !value || objectIdStringRegex.test(String(value || '')),
            message: 'Invalid referrer id format'
        }
    },
    successfulReferralCount: { type: Number, default: 0, min: 0 },
    referralRewardUnlocked: { type: Boolean, default: false },
    loyaltyPoints: { type: Number, default: 0, min: 0 },
    reservedLoyaltyPoints: { type: Number, default: 0, min: 0 },
    lifetimeLoyaltyPoints: { type: Number, default: 0, min: 0 },
    marketingPreferences: {
        emailSubscribed: { type: Boolean, default: true },
        promotionalCampaigns: { type: Boolean, default: true },
        loyaltyUpdates: { type: Boolean, default: true },
        reviewReminders: { type: Boolean, default: true }
    },
    fitProfile: {
        heightCm: { type: Number, min: 50, max: 260, default: null },
        weightKg: { type: Number, min: 20, max: 350, default: null },
        preferredFit: { type: String, enum: ['slim', 'regular', 'relaxed'], default: 'regular' },
        bodyFeatures: {
            shoulderRatio: { type: Number, min: 0, default: null },
            hipRatio: { type: Number, min: 0, default: null },
            torsoRatio: { type: Number, min: 0, default: null },
            scanQuality: { type: Number, min: 0, max: 1, default: null }
        },
        lastScanAt: { type: Date, default: null }
    },
    adminNotes: { type: String, default: '', trim: true, maxlength: 1000 },
    cartData: {
        type: Object,
        default: {},
        validate: {
            validator: isValidCartData,
            message: 'Invalid cart data structure'
        }
    }
},{minimize: false, strict: true, timestamps: true})

userSchema.index({ loyaltyPoints: -1 });
userSchema.index({ successfulReferralCount: -1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ lifetimeLoyaltyPoints: -1 });

const userModel = mongoose.models.user || mongoose.model("user",userSchema);

export default userModel;
