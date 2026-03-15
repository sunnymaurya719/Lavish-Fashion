import userModel from "../models/userModel.js";


// add products to user cart

const addToCart = async (req, res) => {
    try {
        const userId = req.userId;
        const { itemId, size } = req.body;
        const userData = await userModel.findById(userId);

        if (!userData) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        let cartData = userData.cartData || {};

        if (cartData[itemId]) {
            if (cartData[itemId][size]) {
                cartData[itemId][size] += 1;
            }
            else {
                cartData[itemId][size] = 1;
            }
        }
        else {
            cartData[itemId] = {}
            cartData[itemId][size] = 1;
        }
        await userModel.findByIdAndUpdate(userId, { cartData });
        res.status(200).json({ success: true, message: "Added to cart" });
    }
    catch (error) {
        req.log?.error({ err: error }, 'Failed to add item to cart');
        res.status(500).json({ success:false,message : 'Failed to add item to cart'});
    }

}

//update user cart 

const updateCart = async (req,res) => {
    try{
        const userId = req.userId;
        const {itemId,size,quantity} = req.body;
        const userData = await userModel.findById(userId);

        if (!userData) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        let cartData = await userData.cartData;

        if (!cartData[itemId]) {
            cartData[itemId] = {};
        }

        cartData[itemId][size] = quantity;

        await userModel.findByIdAndUpdate(userId,{cartData});
        res.status(200).json({success:true,message:"Cart Updated Successfully"});

    }
    catch(error){
        req.log?.error({ err: error }, 'Failed to update cart');
        res.status(500).json({ success:false,message :'Failed to update cart'});
    }
}

// remove products from user cart
const removeFromCart = async (req,res) => {
    try{
        const userId = req.userId;
        const {itemId,size}  = req.body;
        const userData = await userModel.findById(userId);

        if (!userData) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        let cartData = userData.cartData || {};

        if (!cartData[itemId] || !cartData[itemId][size]) {
            return res.status(404).json({success:false,message:"Item not found in cart"});
        }

        if (cartData[itemId][size] > 1) {
            cartData[itemId][size] -= 1;
        } else {
            delete cartData[itemId][size];

            if (Object.keys(cartData[itemId]).length === 0) {
                delete cartData[itemId];
            }
        }

        await userModel.findByIdAndUpdate(userId,{cartData});
        res.status(200).json({success:true,message:"Item Removed from Cart Successfully"});
    }
    catch(error){
        req.log?.error({ err: error }, 'Failed to remove item from cart');
        res.status(500).json({success:false,message : 'Failed to remove item from cart'});
    }

}

// get user cart details
const getUserCart = async (req,res) => {
    try{
        const userId = req.userId;
        const userData = await userModel.findById(userId);

        if (!userData) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        let cartData = await userData.cartData;
        res.status(200).json({success:true,cartData});
    }
    catch(error){
        req.log?.error({ err: error }, 'Failed to fetch cart');
        res.status(500).json({success:false,message:'Failed to fetch cart'});
    }
}


export { addToCart, updateCart, removeFromCart, getUserCart }