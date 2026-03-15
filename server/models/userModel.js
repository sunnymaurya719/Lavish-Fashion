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

const userSchema = new mongoose.Schema({

    name: {type:String, required:true, trim:true, minlength:2, maxlength:60},
    email: {type:String, required:true, unique:true, lowercase:true, trim:true},
    password: {type:String, required:true, minlength:8, maxlength:128},
    cartData: {
        type: Object,
        default: {},
        validate: {
            validator: isValidCartData,
            message: 'Invalid cart data structure'
        }
    }
},{minimize: false, strict: true})

const userModel = mongoose.models.user || mongoose.model("user",userSchema);

export default userModel;