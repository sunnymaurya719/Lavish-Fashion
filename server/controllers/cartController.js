import userModel from "../models/userModel.js";


// add products to user cart

const addToCart = async (req, res) => {
    try {
        const { userId, itemId, size } = req.body;
        const userData = await userModel.findById(userId);
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
        res.json({ success: true, message: "Added to cart" });
    }
    catch (error) {
        console.log(error);
        res.json({ success:false,message : error.message});
    }

}

//update user cart 

const updateCart = async (req,res) => {
    try{
        const {userId,itemId,size,quantity} = req.body;
        const userData = await userModel.findById(userId);
        let cartData = await userData.cartData;
        cartData[itemId][size] = quantity;

        await userModel.findByIdAndUpdate(userId,{cartData});
        res.json({success:true,message:"Cart Updated Successfully"});

    }
    catch(error){
        console.log(error);
        res.json({ success:false,message :error.message});
    }
}

// remove products from user cart
const removeFromCart = async (req,res) => {
    try{
        const {userId,itemId,size}  = req.body;
        const userData = await userModel.findById(userId);
        let cartData = await userData.cartData;
        let item = cartData[itemId][size];
        await userModel.findByIdAndDelete(userId,{item});
        res.json({success:true,message:"Item Removed from Cart Successfully"});
    }
    catch(error){
        console.log(error);
        res.json({success:false,message : error.message});
    }

}

// get user cart details
const getUserCart = async (req,res) => {
    try{
        const {userId} =req.body;
        const userData = await userModel.findById(userId);

        let cartData = await userData.cartData;
        res.json({success:true,cartData});
    }
    catch(error){
        console.log(error);
        res.json({success:false,message:error.message});
    }
}


export { addToCart, updateCart, removeFromCart, getUserCart }