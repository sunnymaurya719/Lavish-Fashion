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

const referralCodeRegex = /^[A-Z0-9]{6,12}$/;

const createToken = (id) =>{
    return jwt.sign({id},process.env.JWT_SECRET, { expiresIn: '7d' })
}

const createAdminToken = (email) => {
    return jwt.sign(
        { role: 'admin', email },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
    );
}

const buildUserProfile = (user) => ({
    name: user.name,
    email: user.email,
    phone: user.phone || '',
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
            return res.status(409).json({success:false, message:"User already exists"});
        }

        // validating email format and password
        if(!validator.isEmail(email)) {
            return res.status(400).json({success:false, message:"Invalid email"});
        }
        if(password.length < 8){
            return res.status(400).json({success:false, message:"Please enter a strong password"})
        }

        let referredBy = '';
        if (referralCodeInput) {
            if (!referralCodeRegex.test(referralCodeInput)) {
                return res.status(400).json({ success: false, message: 'Referral code is invalid' });
            }

            const referrer = await userModel.findOne({ referralCode: referralCodeInput }).select('_id email').lean();

            if (!referrer) {
                return res.status(400).json({ success: false, message: 'Referral code is invalid' });
            }

            if (String(referrer.email || '').toLowerCase() === email) {
                return res.status(400).json({ success: false, message: 'You cannot use your own referral code' });
            }

            referredBy = String(referrer._id);
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

//Route for admin login
const adminLogin = async (req,res) =>{
    try{
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }

        if(email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD){
            const token  = createAdminToken(email);
            return res.status(200).json({success:true,token});
        }

        return res.status(401).json({success:false,message:"Invalid admin credentials"});
    }
    catch(error){
        req.log?.error({ err: error }, 'Error in admin login');
        res.status(500).json({success:false,message:"Error in admin login"})
    }
}

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

export {adminLogin, getUserProfile, getUserWishlist, loginUser, registerUser, toggleUserWishlist, updateMarketingPreferences, updateUserProfile}
