import validator from "validator";
import bcrypt from "bcrypt"
import userModel from "../models/userModel.js";
import productModel from "../models/productModel.js";
import jwt from "jsonwebtoken"
import {
    determineLoyaltyTier,
    ensureUserReferralCode,
    generateUniqueReferralCode,
    getUserAvailableLoyaltyPoints
} from '../services/loyaltyService.js';
import { getUserMarketingPreferences, queueAutomationEmail } from '../services/marketingAutomationService.js';
import {
    GoogleAuthConfigurationError,
    GoogleTokenVerificationError,
    isGoogleEmailAuthoritative,
    verifyGoogleIdToken
} from '../services/googleAuthService.js';
import { adminLogin as _adminLoginImpl } from './adminUserController.js';

const referralCodeRegex = /^[A-Z0-9]{6,12}$/;
const hasLocalPassword = (value) => String(value || '').length >= 8;

const resolveAuthProvider = ({ password = '', googleId = '' } = {}) => {
    const hasPassword = hasLocalPassword(password);
    const hasGoogle = Boolean(String(googleId || '').trim());

    if (hasPassword && hasGoogle) {
        return 'hybrid';
    }

    if (hasGoogle) {
        return 'google';
    }

    return 'local';
};

const createToken = (id) =>{
    return jwt.sign({id},process.env.JWT_SECRET, { expiresIn: '7d' })
}

const buildUserProfile = (user) => ({
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    avatarUrl: user.avatarUrl || '',
    authProvider: resolveAuthProvider(user),
    googleLinked: Boolean(String(user.googleId || '').trim()),
    wishlistCount: Array.isArray(user.wishlist) ? user.wishlist.length : 0,
    referralCode: user.referralCode || '',
    successfulReferralCount: Number(user.successfulReferralCount || 0),
    loyaltyPoints: Number(user.loyaltyPoints || 0),
    reservedLoyaltyPoints: Number(user.reservedLoyaltyPoints || 0),
    availableLoyaltyPoints: getUserAvailableLoyaltyPoints(user),
    lifetimeLoyaltyPoints: Number(user.lifetimeLoyaltyPoints || 0),
    loyaltyTier: determineLoyaltyTier(user.lifetimeLoyaltyPoints || user.loyaltyPoints || 0).currentTier,
    marketingPreferences: getUserMarketingPreferences(user),
    fitProfile: {
        heightCm: user.fitProfile?.heightCm ?? null,
        weightKg: user.fitProfile?.weightKg ?? null,
        preferredFit: user.fitProfile?.preferredFit || 'regular'
    },
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null
});

const resolveReferralCodeInput = async ({ referralCodeInput = '', email = '' }) => {
    if (!referralCodeInput) {
        return '';
    }

    if (!referralCodeRegex.test(referralCodeInput)) {
        throw new Error('Referral code is invalid');
    }

    const referrer = await userModel.findOne({ referralCode: referralCodeInput }).select('_id email').lean();

    if (!referrer) {
        throw new Error('Referral code is invalid');
    }

    if (String(referrer.email || '').toLowerCase() === String(email || '').toLowerCase()) {
        throw new Error('You cannot use your own referral code');
    }

    return String(referrer._id);
};


//Route for user login
const loginUser = async (req,res) =>{
    
    try {
        
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }

        //checking user exist or not
        const user = await userModel.findOne({email});
        if(!user){
            return res.status(404).json({success:false, message:"User doesn't exist"});
        }

        if (!hasLocalPassword(user.password)) {
            return res.status(400).json({
                success: false,
                message: 'This account uses Google sign-in. Please continue with Google.'
            });
        }

        //comparing password
        const isPasswordCorrect = await bcrypt.compare(password,user.password);
        if(isPasswordCorrect){
            const token = createToken(user._id);
            res.status(200).json({success:true,token});
        }
        else{
            res.status(401).json({success:false,message:"Invalid credentials"});
        }

    }
    catch(error){
        req.log?.error({ err: error }, 'Error in user login');
        res.status(500).json({success:false,message:'Unable to login'})
    }

}

//Route for user registration
const registerUser = async (req,res) =>{
    try {
        const name = String(req.body.name || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');
        const referralCodeInput = String(req.body.referralCode || '').trim().toUpperCase();

        if (!name || !email || !password) {
            return res.status(400).json({success:false, message:'Name, email and password are required'});
        }

        //checking user already exist or not
        const existingUser = await userModel.findOne({email});
        if(existingUser){
            return res.status(409).json({
                success:false,
                message: hasLocalPassword(existingUser.password)
                    ? 'User already exists'
                    : 'This account already exists with Google. Please continue with Google.'
            });
        }

        // validating email format and password
        if(!validator.isEmail(email)) {
            return res.status(400).json({success:false, message:"Invalid email"});
        }
        if(password.length < 8){
            return res.status(400).json({success:false, message:"Please enter a strong password"})
        }

        let referredBy = '';
        try {
            referredBy = await resolveReferralCodeInput({ referralCodeInput, email });
        } catch (referralError) {
            return res.status(400).json({ success: false, message: referralError.message || 'Referral code is invalid' });
        }

        //hashing user password
        const hashedPassword = await bcrypt.hash(password,10);

        let user = null;
        let referralCode = '';

        // Retry on rare referral code uniqueness conflicts.
        for (let attempt = 0; attempt < 3; attempt += 1) {
            referralCode = await generateUniqueReferralCode(name);

            try {
                const newUser = new userModel({
                    name,
                    email,
                    password:hashedPassword,
                    authProvider: 'local',
                    referredBy,
                    referralCode
                });

                user = await newUser.save();
                break;
            } catch (saveError) {
                const isReferralCodeConflict =
                    saveError?.code === 11000 &&
                    (saveError?.keyPattern?.referralCode || String(saveError?.message || '').includes('referralCode'));

                if (!isReferralCodeConflict || attempt === 2) {
                    throw saveError;
                }
            }
        }

        await queueAutomationEmail({
            userId: user,
            automationKey: 'welcome_signup',
            context: {
                referralCode
            }
        });
        
        const token = createToken(user._id);

        res.status(201).json({success:true,token});

    }
    catch(error){
        req.log?.error({ err: error }, 'Error in user registration');
        res.status(500).json({success:false,message:'Unable to register user'});
    }
    

}

const googleAuthUser = async (req, res) => {
    try {
        const credential = String(req.body.credential || '').trim();
        const referralCodeInput = String(req.body.referralCode || '').trim().toUpperCase();

        if (!credential) {
            return res.status(400).json({ success: false, message: 'Google credential is required' });
        }

        const googlePayload = await verifyGoogleIdToken(credential);
        const googleId = String(googlePayload.sub || '').trim();
        const email = String(googlePayload.email || '').trim().toLowerCase();
        const name = String(googlePayload.name || '').trim() || email.split('@')[0] || 'Google User';
        const avatarUrl = String(googlePayload.picture || '').trim();
        const emailVerified =
            googlePayload.email_verified === true || String(googlePayload.email_verified || '').trim().toLowerCase() === 'true';

        if (!googleId || !email || !validator.isEmail(email)) {
            return res.status(400).json({ success: false, message: 'Google account details are incomplete' });
        }

        if (!emailVerified) {
            return res.status(400).json({ success: false, message: 'Your Google email must be verified to continue' });
        }

        const now = new Date();
        let user = await userModel.findOne({ googleId });
        let isNewUser = false;

        if (!user) {
            user = await userModel.findOne({ email });
        }

        if (user) {
            const existingGoogleId = String(user.googleId || '').trim();

            if (existingGoogleId && existingGoogleId !== googleId) {
                return res.status(409).json({
                    success: false,
                    message: 'This email is already linked to another Google account'
                });
            }

            if (!existingGoogleId && !isGoogleEmailAuthoritative(googlePayload)) {
                return res.status(409).json({
                    success: false,
                    message: 'This email already has an account. Please sign in with email and password first.'
                });
            }

            const updatedUser = await userModel.findByIdAndUpdate(
                user._id,
                {
                    ...(user.name ? {} : { name }),
                    googleId,
                    googleEmailVerified: true,
                    googlePicture: avatarUrl,
                    googleLinkedAt: user.googleLinkedAt || now,
                    googleLastLoginAt: now,
                    avatarUrl: avatarUrl || user.avatarUrl || '',
                    authProvider: resolveAuthProvider({
                        password: user.password,
                        googleId
                    })
                },
                { new: true, runValidators: true }
            );

            const token = createToken(updatedUser._id);

            return res.status(200).json({
                success: true,
                token,
                isNewUser: false,
                provider: 'google'
            });
        }

        let referredBy = '';
        try {
            referredBy = await resolveReferralCodeInput({ referralCodeInput, email });
        } catch (referralError) {
            return res.status(400).json({ success: false, message: referralError.message || 'Referral code is invalid' });
        }

        let newUser = null;
        let referralCode = '';

        for (let attempt = 0; attempt < 3; attempt += 1) {
            referralCode = await generateUniqueReferralCode(name);

            try {
                const nextUser = new userModel({
                    name,
                    email,
                    password: '',
                    authProvider: 'google',
                    avatarUrl,
                    googleId,
                    googleEmailVerified: true,
                    googlePicture: avatarUrl,
                    googleLinkedAt: now,
                    googleLastLoginAt: now,
                    referredBy,
                    referralCode
                });

                newUser = await nextUser.save();
                break;
            } catch (saveError) {
                const isReferralCodeConflict =
                    saveError?.code === 11000 &&
                    (saveError?.keyPattern?.referralCode || String(saveError?.message || '').includes('referralCode'));

                if (!isReferralCodeConflict || attempt === 2) {
                    throw saveError;
                }
            }
        }

        await queueAutomationEmail({
            userId: newUser,
            automationKey: 'welcome_signup',
            context: {
                referralCode
            }
        });

        isNewUser = true;
        const token = createToken(newUser._id);

        return res.status(201).json({
            success: true,
            token,
            isNewUser,
            provider: 'google'
        });
    } catch (error) {
        if (error instanceof GoogleAuthConfigurationError) {
            return res.status(503).json({
                success: false,
                message: 'Google sign-in is not configured right now'
            });
        }

        if (error instanceof GoogleTokenVerificationError) {
            return res.status(401).json({
                success: false,
                message: error.message || 'Unable to verify Google credential'
            });
        }

        req.log?.error({ err: error }, 'Error in Google user authentication');
        return res.status(500).json({ success: false, message: 'Unable to continue with Google' });
    }
}

//Route for admin login
//
// Implementation lives in adminUserController.js so that env-based and
// DB-backed admins share the same code path. We re-export it here so
// existing routes that import { adminLogin } from this controller continue
// to work without changes.
const adminLogin = _adminLoginImpl;

const getUserProfile = async (req, res) => {
    try {
        const user = await userModel.findById(req.userId);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const referralCode = await ensureUserReferralCode(user);

        return res.status(200).json({
            success: true,
            profile: buildUserProfile({
                ...user.toObject(),
                referralCode
            })
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Error while fetching user profile');
        return res.status(500).json({ success: false, message: 'Unable to fetch profile' });
    }
};

const updateUserProfile = async (req, res) => {
    try {
        const { name, phone, marketingPreferences, fitProfile } = req.body;
        const existingUser = await userModel.findById(req.userId);

        if (!existingUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const updatedUser = await userModel.findByIdAndUpdate(
            req.userId,
            {
                name,
                phone: String(phone || '').trim(),
                ...(fitProfile
                    ? {
                        fitProfile: {
                            ...(existingUser.fitProfile || {}),
                            ...(fitProfile.heightCm !== undefined ? { heightCm: Number(fitProfile.heightCm) } : {}),
                            ...(fitProfile.weightKg !== undefined ? { weightKg: Number(fitProfile.weightKg) } : {}),
                            ...(fitProfile.preferredFit ? { preferredFit: fitProfile.preferredFit } : {})
                        }
                    }
                    : {}),
                ...(marketingPreferences
                    ? {
                        marketingPreferences: getUserMarketingPreferences({
                            marketingPreferences: {
                                ...getUserMarketingPreferences(existingUser),
                                ...marketingPreferences
                            }
                        })
                    }
                    : {})
            },
            { new: true, runValidators: true }
        );

        const referralCode = await ensureUserReferralCode(updatedUser);

        return res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            profile: buildUserProfile({
                ...updatedUser.toObject(),
                referralCode
            })
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Error while updating user profile');
        return res.status(500).json({ success: false, message: 'Unable to update profile' });
    }
};

const updateMarketingPreferences = async (req, res) => {
    try {
        const existingUser = await userModel.findById(req.userId);

        if (!existingUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const marketingPreferences = getUserMarketingPreferences({
            marketingPreferences: {
                ...getUserMarketingPreferences(existingUser),
                ...req.body
            }
        });

        const updatedUser = await userModel.findByIdAndUpdate(
            req.userId,
            { marketingPreferences },
            { new: true, runValidators: true }
        );

        return res.status(200).json({
            success: true,
            message: 'Marketing preferences updated successfully',
            marketingPreferences: getUserMarketingPreferences(updatedUser)
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Error while updating marketing preferences');
        return res.status(500).json({ success: false, message: 'Unable to update marketing preferences' });
    }
};

const getUserWishlist = async (req, res) => {
    try {
        const user = await userModel.findById(req.userId).lean();

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        return res.status(200).json({
            success: true,
            wishlist: Array.isArray(user.wishlist) ? user.wishlist : []
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Error while fetching wishlist');
        return res.status(500).json({ success: false, message: 'Unable to fetch wishlist' });
    }
};

const toggleUserWishlist = async (req, res) => {
    try {
        const { itemId } = req.body;
        const product = await productModel.findById(itemId).select('_id');

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const user = await userModel.findById(req.userId);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const wishlist = Array.isArray(user.wishlist) ? user.wishlist.map((item) => String(item)) : [];
        const hasProduct = wishlist.includes(itemId);
        const updatedWishlist = hasProduct
            ? wishlist.filter((wishlistItemId) => wishlistItemId !== itemId)
            : [...wishlist, itemId];

        const updatedUser = await userModel.findByIdAndUpdate(
            req.userId,
            { wishlist: updatedWishlist },
            { new: true, runValidators: true }
        );

        return res.status(200).json({
            success: true,
            message: hasProduct ? 'Removed from wishlist' : 'Added to wishlist',
            wishlist: updatedUser.wishlist
        });
    } catch (error) {
        req.log?.error({ err: error }, 'Error while updating wishlist');
        return res.status(500).json({ success: false, message: 'Unable to update wishlist' });
    }
};

export {
    adminLogin,
    getUserProfile,
    getUserWishlist,
    googleAuthUser,
    loginUser,
    registerUser,
    toggleUserWishlist,
    updateMarketingPreferences,
    updateUserProfile
}
