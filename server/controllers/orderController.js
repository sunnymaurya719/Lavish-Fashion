import orderModel from '../models/orderModel.js';
import userModel from '../models/userModel.js';
import productModel from '../models/productModel.js';
import { razorpayWebhookEventSchema, stripeWebhookEventSchema } from '../validation/schemas.js';
import { beginIdempotentRequest, completeIdempotentRequest } from '../services/idempotencyService.js';
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

const markOrderAsPaid = async ({ order, gatewayEventId, paymentFields }) => {
    if (!order || order.payment) {
        return order;
    }

    const updatedOrder = await orderModel.findByIdAndUpdate(
        order._id,
        {
            payment: true,
            paymentStatus: 'paid',
            paymentVerifiedAt: Date.now(),
            gatewayEventId: gatewayEventId || order.gatewayEventId,
            ...paymentFields
        },
        { new: true }
    );

    await userModel.findByIdAndUpdate(order.userId, { cartData: {} });
    return updatedOrder;
};

const markOrderAsFailed = async ({ order, gatewayEventId, paymentFields }) => {
    if (!order || order.payment) {
        return order;
    }

    return orderModel.findByIdAndUpdate(
        order._id,
        {
            paymentStatus: 'failed',
            gatewayEventId: gatewayEventId || order.gatewayEventId,
            ...paymentFields
        },
        { new: true }
    );
};

const isValidObjectId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

const secureCompare = (a, b) => {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');

    if (left.length !== right.length) {
        return false;
    }

    return crypto.timingSafeEqual(left, right);
};

const resolveStripeOrder = async (session) => {
    const orderId = String(session?.client_reference_id || session?.metadata?.orderId || '');

    if (!isValidObjectId(orderId)) {
        return null;
    }

    const order = await orderModel.findById(orderId);
    if (!order) {
        return null;
    }

    const metadataOrderId = String(session?.metadata?.orderId || '');
    const clientReferenceId = String(session?.client_reference_id || '');
    const metadataUserId = String(session?.metadata?.userId || '');

    if (metadataOrderId && metadataOrderId !== String(order._id)) {
        return null;
    }

    if (clientReferenceId && clientReferenceId !== String(order._id)) {
        return null;
    }

    if (metadataUserId && metadataUserId !== String(order.userId)) {
        return null;
    }

    return order;
};

const getIdempotencyKey = (req) => String(req.headers['idempotency-key'] || '').trim();

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
    let idempotencyRecordId;

    try {
        const userId = req.userId;
        const { items, address } = req.body;
        const idempotencyKey = getIdempotencyKey(req);

        if (!idempotencyKey) {
            return res.status(400).json({ success: false, message: 'Missing idempotency key header' });
        }

        const idempotencyResult = await beginIdempotentRequest({
            userId,
            scope: 'order:create:stripe',
            key: idempotencyKey,
            payload: req.body
        });

        if (idempotencyResult.action === 'replay' || idempotencyResult.action === 'conflict' || idempotencyResult.action === 'in_progress') {
            return res.status(idempotencyResult.statusCode).json(idempotencyResult.body);
        }

        idempotencyRecordId = idempotencyResult.recordId;

        const { normalizedItems, amount } = await calculateOrderDetails(items);
        const clientBaseUrl = String(process.env.CLIENT_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');

        if (!clientBaseUrl) {
            const responseBody = { success: false, message: 'Client URL is not configured' };
            await completeIdempotentRequest({
                recordId: idempotencyRecordId,
                statusCode: 500,
                body: responseBody
            });

            return res.status(500).json(responseBody);
        }

        const orderData = {
            userId,
            items: normalizedItems,
            amount,
            address,
            paymentMethod: "Stripe",
            payment: false,
            paymentStatus: 'pending',
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
            success_url: `${clientBaseUrl}/verify?orderId=${newOrder._id}&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${clientBaseUrl}/verify?success=false&orderId=${newOrder._id}`,
            line_items,
            mode: 'payment',
            client_reference_id: String(newOrder._id),
            metadata: {
                orderId: String(newOrder._id),
                userId: String(userId)
            }
        })

        await orderModel.findByIdAndUpdate(newOrder._id, {
            stripeSessionId: session.id
        });

        const responseBody = { success: true, session };

        await completeIdempotentRequest({
            recordId: idempotencyRecordId,
            statusCode: 200,
            body: responseBody
        });

        res.status(200).json(responseBody)
        
    }
    catch (error) {
        req.log?.error({ err: error }, 'Failed to create Stripe order');

        const responseBody = { success: false, message: 'Unable to create Stripe session' };
        await completeIdempotentRequest({
            recordId: idempotencyRecordId,
            statusCode: 500,
            body: responseBody
        });

        res.status(500).json(responseBody)
    }
}

//verify Stripe
const verifyStripe = async (req, res) => {
    const { orderId, success, session_id } = req.body
    const userId = req.userId;
    
    try {
        if (!isValidObjectId(orderId)) {
            return res.status(400).json({ success: false, message: 'Invalid order id' });
        }

        const order = await orderModel.findById(orderId);
        if (!order || order.userId !== userId) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (order.payment) {
            return res.status(200).json({ success: true, message: 'Payment already confirmed via webhook.' });
        }

        if (success === "false" && !session_id) {
            return res.status(200).json({ success: false, message: 'Payment not completed. Awaiting webhook confirmation.' });
        }

        if (!session_id) {
            return res.status(400).json({ success: false, message: 'Missing Stripe session id' });
        }

        const session = await stripe.checkout.sessions.retrieve(session_id);
        const isLinkedToOrder =
            session.client_reference_id === String(orderId) &&
            session.metadata?.orderId === String(orderId) &&
            session.metadata?.userId === String(userId);

        if (!isLinkedToOrder) {
            return res.status(400).json({ success: false, message: 'Invalid Stripe session' });
        }

        if (session.payment_status !== 'paid') {
            return res.status(402).json({ success: false, message: 'Payment not completed' });
        }

        await orderModel.findByIdAndUpdate(orderId, {
            stripeSessionId: session.id,
            stripePaymentIntentId: session.payment_intent ? String(session.payment_intent) : null
        });

        res.status(200).json({ success: true, message: 'Payment accepted. Awaiting secure webhook confirmation.' });
    }
    catch (error) {
        req.log?.error({ err: error }, 'Failed to verify Stripe payment');
        res.status(500).json({ success: false, message: 'Failed to verify Stripe payment' });
    }
}


//Placing orders using razorpay Method
const placeOrderRazorpay = async (req, res) => {
    let idempotencyRecordId;

    try{
        const userId = req.userId;
        const { items,address} = req.body;
        const idempotencyKey = getIdempotencyKey(req);

        if (!idempotencyKey) {
            return res.status(400).json({ success: false, message: 'Missing idempotency key header' });
        }

        const idempotencyResult = await beginIdempotentRequest({
            userId,
            scope: 'order:create:razorpay',
            key: idempotencyKey,
            payload: req.body
        });

        if (idempotencyResult.action === 'replay' || idempotencyResult.action === 'conflict' || idempotencyResult.action === 'in_progress') {
            return res.status(idempotencyResult.statusCode).json(idempotencyResult.body);
        }

        idempotencyRecordId = idempotencyResult.recordId;

        const { normalizedItems, amount } = await calculateOrderDetails(items);

        const orderData = {
            userId,
            items: normalizedItems,
            address,
            amount,
            paymentMethod:"Razorpay",
            payment:false,
            paymentStatus: 'pending',
            date:Date.now()
        }

        const newOrder = new orderModel(orderData)
        await newOrder.save();

        const options = {
            amount: amount * 100,
            currency:currency.toUpperCase(),
            receipt:newOrder._id.toString()
        }
        const order = await razorpayInstance.orders.create(options);

        await orderModel.findByIdAndUpdate(newOrder._id, {
            razorpayOrderId: order.id
        });

        const responseBody = { success: true, order };

        await completeIdempotentRequest({
            recordId: idempotencyRecordId,
            statusCode: 200,
            body: responseBody
        });

        res.status(200).json(responseBody);
    }catch(error){
        req.log?.error({ err: error }, 'Failed to create Razorpay order');

        const responseBody = { success: false, message: 'Failed to place Razorpay order' };
        await completeIdempotentRequest({
            recordId: idempotencyRecordId,
            statusCode: 500,
            body: responseBody
        });

        res.status(500).json(responseBody);
    }
}

const verifyRazorpay = async(req,res) =>{
    try{
        const userId = req.userId;
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({success:false,message:'Missing Razorpay verification fields'});
        }

        const generatedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');

        if (!secureCompare(generatedSignature, razorpay_signature)) {
            return res.status(400).json({success:false,message:'Invalid Razorpay signature'});
        }

        const localOrder = await orderModel.findOne({ razorpayOrderId: razorpay_order_id });

        if (!localOrder || localOrder.userId !== userId) {
            return res.status(404).json({success:false,message:'Order not found'});
        }

        if (localOrder.payment) {
            return res.status(200).json({success:true,message:'Payment already confirmed via webhook.'});
        }

        await orderModel.findByIdAndUpdate(localOrder._id, {
            razorpayPaymentId: razorpay_payment_id
        });

        res.status(200).json({success:true,message:'Payment accepted. Awaiting secure webhook confirmation.'});
    }catch(error){
        req.log?.error({ err: error }, 'Failed to verify Razorpay payment');
        res.status(500).json({success:false,message:'Failed to verify Razorpay payment'});
    }
}

const handleStripeWebhook = async (req, res) => {
    const signature = req.headers['stripe-signature'];

    if (!signature) {
        return res.status(400).send('Missing Stripe signature');
    }

    try {
        const event = stripe.webhooks.constructEvent(
            req.body,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET
        );

        const parsedEvent = stripeWebhookEventSchema.safeParse(event);
        if (!parsedEvent.success) {
            return res.status(400).send('Invalid Stripe webhook payload');
        }

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const order = await resolveStripeOrder(session);

            if (order) {
                await markOrderAsPaid({
                    order,
                    gatewayEventId: event.id,
                    paymentFields: {
                        stripeSessionId: session.id,
                        stripePaymentIntentId: session.payment_intent ? String(session.payment_intent) : null
                    }
                });
            }
        }

        if (event.type === 'checkout.session.expired') {
            const session = event.data.object;
            const order = await resolveStripeOrder(session);

            if (order) {
                await markOrderAsFailed({
                    order,
                    gatewayEventId: event.id,
                    paymentFields: { stripeSessionId: session.id }
                });
            }
        }

        return res.status(200).json({ received: true });
    } catch (error) {
        req.log?.error({ err: error }, 'Stripe webhook failed');
        return res.status(400).send(`Webhook Error: ${error.message}`);
    }
};

const handleRazorpayWebhook = async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];

    if (!signature) {
        return res.status(400).send('Missing Razorpay signature');
    }

    try {
        const rawBody = req.body;
        const computedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
            .update(rawBody)
            .digest('hex');

        if (!secureCompare(computedSignature, signature)) {
            return res.status(400).send('Invalid webhook signature');
        }

        const event = JSON.parse(rawBody.toString('utf8'));
        const parsedEvent = razorpayWebhookEventSchema.safeParse(event);
        if (!parsedEvent.success) {
            return res.status(400).send('Invalid Razorpay webhook payload');
        }

        const paymentEntity = event?.payload?.payment?.entity;
        const razorpayOrderId = paymentEntity?.order_id;

        if (!razorpayOrderId) {
            return res.status(200).json({ received: true });
        }

        const order = await orderModel.findOne({ razorpayOrderId });

        if (event.event === 'payment.captured') {
            await markOrderAsPaid({
                order,
                gatewayEventId: event?.payload?.payment?.entity?.id,
                paymentFields: {
                    razorpayOrderId,
                    razorpayPaymentId: paymentEntity?.id || null
                }
            });
        }

        if (event.event === 'payment.failed') {
            await markOrderAsFailed({
                order,
                gatewayEventId: event?.payload?.payment?.entity?.id,
                paymentFields: {
                    razorpayOrderId,
                    razorpayPaymentId: paymentEntity?.id || null
                }
            });
        }

        return res.status(200).json({ received: true });
    } catch (error) {
        req.log?.error({ err: error }, 'Razorpay webhook failed');
        return res.status(500).send('Webhook processing failed');
    }
};


//All Orders data for Admin panel
const allOrders = async (req, res) => {
    try {
        const orders = await orderModel.find({})
        res.status(200).json({ success: true, orders });
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch all orders');
        res.status(500).json({ success: false, message: 'Failed to fetch orders' });
    }
}


//User Order data for Frontend
const userOrders = async (req, res) => {
    try {
        const userId = req.userId;
        const orders = await orderModel.find({ userId });
        res.status(200).json({ success: true, orders });

    }
    catch (error) {
        req.log?.error({ err: error }, 'Failed to fetch user orders');
        res.status(500).json({ success: false, message: 'Failed to fetch user orders' })
    }
}

//update order status by Admin Panel
const updateOrderStatus = async (req, res) => {
    try {
        const { orderId, status } = req.body;
        await orderModel.findByIdAndUpdate(orderId, { status });
        res.status(200).json({ success: true, message: 'Status Updated' })
    } catch (error) {
        req.log?.error({ err: error }, 'Failed to update order status');
        res.status(500).json({ success: false, message: 'Failed to update order status' })
    }
}

export {verifyRazorpay, placeOrderStripe, placeOrderRazorpay, allOrders, userOrders, updateOrderStatus, verifyStripe, handleStripeWebhook, handleRazorpayWebhook }