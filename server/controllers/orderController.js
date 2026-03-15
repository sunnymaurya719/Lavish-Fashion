import orderModel from '../models/orderModel.js';
import userModel from '../models/userModel.js';
import productModel from '../models/productModel.js';
import Stripe from 'stripe';
import razorpay from 'razorpay';
import crypto from 'crypto';

//global variables
const currency = 'inr';
const deliveryCharge = 10;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const razorpayInstance = new razorpay({
    key_id:process.env.RAZORPAY_KEY_ID,
    key_secret:process.env.RAZORPAY_KEY_SECRET
})

const calculateOrderDetails = async (items) => {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error('No order items provided');
    }

    const productIds = [...new Set(items.map((item) => String(item._id || item.productId || '')).filter(Boolean))];
    const products = await productModel.find({ _id: { $in: productIds } }).lean();
    const productMap = new Map(products.map((product) => [String(product._id), product]));

    const normalizedItems = [];
    let subtotal = 0;

    for (const rawItem of items) {
        const productId = String(rawItem._id || rawItem.productId || '');
        const quantity = Number(rawItem.quantity);

        if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
            throw new Error('Invalid order item payload');
        }

        const product = productMap.get(productId);
        if (!product) {
            throw new Error('One or more products are unavailable');
        }

        const productPrice = Number(product.price);
        subtotal += productPrice * quantity;

        normalizedItems.push({
            _id: String(product._id),
            name: product.name,
            price: productPrice,
            image: product.image,
            size: rawItem.size || '',
            quantity
        });
    }

    return {
        normalizedItems,
        amount: subtotal + deliveryCharge
    };
}

//Placing orders using COD Method
// const placeOrder = async (req, res) => {
//     try {
//         const { userId, items, amount, address } = req.body;
//         const orderData = {
//             userId,
//             items,
//             amount,
//             address,
//             paymentMethod: "COD",
//             payment: false,
//             date: Date.now(),
//         }
//         const newOrder = new orderModel(orderData);
//         await newOrder.save();
//         //empty the cart after placing order
//         await userModel.findByIdAndUpdate(userId, { cartData: {} });
//         res.json({ success: true, message: "Order Places" });
//     }
//     catch (error) {
//         console.log(error);
//         res.json({ success: false, message: error.message })
//     }

// }


//Placing orders using Stripe Method
const placeOrderStripe = async (req, res) => {
    try {
        const { userId, items, address } = req.body;
        const { origin } = req.headers;
        const { normalizedItems, amount } = await calculateOrderDetails(items);

        const orderData = {
            userId,
            items: normalizedItems,
            amount,
            address,
            paymentMethod: "Stripe",
            payment: false,
            date: Date.now(),
        }
        const newOrder = new orderModel(orderData);
        await newOrder.save();

        const line_items = normalizedItems.map((item) => ({
            price_data: {
                currency: currency,
                product_data: {
                    name: `${item.name}${item.size ? ` (${item.size})` : ''}`
                },
                unit_amount: Math.round(Number(item.price) * 100)
            },
            quantity: item.quantity
        }))

        line_items.push({
            price_data: {
                currency: currency,
                product_data: {
                    name: 'Delivery Charges'
                },
                unit_amount: deliveryCharge * 100
            },
            quantity: 1
        })

        const session = await stripe.checkout.sessions.create({
            success_url: `${origin}/verify?orderId=${newOrder._id}&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${origin}/verify?success=false&orderId=${newOrder._id}`,
            line_items,
            mode: 'payment',
            client_reference_id: String(newOrder._id),
            metadata: {
                orderId: String(newOrder._id),
                userId: String(userId)
            }
        })

        res.json({ success: true, session: session })
        
    }
    catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message })
    }
}

//verify Stripe
const verifyStripe = async (req, res) => {
    const { orderId, success, session_id, userId } = req.body
    
    try {
        const order = await orderModel.findById(orderId);
        if (!order || order.userId !== userId) {
            return res.json({ success: false, message: 'Order not found' });
        }

        if (success === "false" && !session_id) {
            await orderModel.findByIdAndDelete(orderId);
            return res.json({ success: false, message: 'Payment cancelled' });
        }

        if (!session_id) {
            return res.json({ success: false, message: 'Missing Stripe session id' });
        }

        const session = await stripe.checkout.sessions.retrieve(session_id);
        const isLinkedToOrder =
            session.client_reference_id === String(orderId) &&
            session.metadata?.orderId === String(orderId) &&
            session.metadata?.userId === String(userId);

        if (!isLinkedToOrder) {
            return res.json({ success: false, message: 'Invalid Stripe session' });
        }

        if (session.payment_status !== 'paid') {
            return res.json({ success: false, message: 'Payment not completed' });
        }

        await orderModel.findByIdAndUpdate(orderId,{ payment: true });
        await userModel.findByIdAndUpdate(userId,{ cartData: {} });
        res.json({ success: true });
    }
    catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
}


//Placing orders using razorpay Method
const placeOrderRazorpay = async (req, res) => {
    try{
        const {userId, items,address} = req.body;
        const { normalizedItems, amount } = await calculateOrderDetails(items);

        const orderData = {
            userId,
            items: normalizedItems,
            address,
            amount,
            paymentMethod:"Razorpay",
            payment:false,
            date:Date.now()
        }

        const newOrder = new orderModel(orderData)
        await newOrder.save();

        const options = {
            amount: amount * 100,
            currency:currency.toUpperCase(),
            receipt:newOrder._id.toString()
        }
        await razorpayInstance.orders.create(options, (error,order)=>{
            if(error){
                console.log(error);
                return res.json({success:false,message:error})
            }
            res.json({success:true,order});
        })
    }catch(error){
        console.log(error); 
        res.json({success:false,message:error.message});
    }
}

const verifyRazorpay = async(req,res) =>{
    try{
        const {userId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.json({success:false,message:'Missing Razorpay verification fields'});
        }

        const generatedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');

        if (generatedSignature !== razorpay_signature) {
            return res.json({success:false,message:'Invalid Razorpay signature'});
        }

        const orderInfo = await razorpayInstance.orders.fetch(razorpay_order_id);
        const localOrder = await orderModel.findById(orderInfo.receipt);

        if (!localOrder || localOrder.userId !== userId) {
            return res.json({success:false,message:'Order not found'});
        }

        const paymentInfo = await razorpayInstance.payments.fetch(razorpay_payment_id);
        const isPaymentLinked = paymentInfo.order_id === razorpay_order_id;
        const isPaid = paymentInfo.status === 'captured' || paymentInfo.status === 'authorized';

        if(orderInfo.status === 'paid' && isPaymentLinked && isPaid){
            await orderModel.findByIdAndUpdate(orderInfo.receipt,{payment:true});
            await userModel.findByIdAndUpdate(userId,{cartData:{}});
            res.json({success:true,message:"Payment Successful"});
        }else{
            res.json({success:false,message:'Payment failed'});
        }
    }catch(error){
        console.log(error);
        res.json({success:false,message:error.message});
    }
}


//All Orders data for Admin panel
const allOrders = async (req, res) => {
    try {
        const orders = await orderModel.find({})
        res.json({ success: true, orders });
    } catch (error) {
        console.log(error);
        res.json({ succes: false, message: error.message });
    }
}


//User Order data for Frontend
const userOrders = async (req, res) => {
    try {
        const { userId } = req.body;
        const orders = await orderModel.find({ userId });
        res.json({ success: true, orders });

    }
    catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message })
    }
}

//update order status by Admin Panel
const updateOrderStatus = async (req, res) => {
    try {
        const { orderId, status } = req.body;
        await orderModel.findByIdAndUpdate(orderId, { status });
        res.json({ success: true, message: 'Status Updated' })
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message })
    }
}

export {verifyRazorpay, placeOrderStripe, placeOrderRazorpay, allOrders, userOrders, updateOrderStatus, verifyStripe }