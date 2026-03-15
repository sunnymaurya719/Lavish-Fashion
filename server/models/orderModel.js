import mongoose from 'mongoose';

const objectIdStringRegex = /^[a-f\d]{24}$/i;

const orderItemSchema = new mongoose.Schema(
    {
        _id: {
            type: String,
            required: true,
            validate: {
                validator: (value) => objectIdStringRegex.test(String(value || '')),
                message: 'Invalid product id format in order item'
            }
        },
        name: { type: String, required: true, trim: true, minlength: 1, maxlength: 150 },
        price: { type: Number, required: true, min: 0 },
        image: { type: [String], default: [] },
        size: { type: String, default: '', trim: true, maxlength: 10 },
        quantity: { type: Number, required: true, min: 1, max: 99 }
    },
    { _id: false, strict: true }
);

const orderAddressSchema = new mongoose.Schema(
    {
        firstName: { type: String, required: true, trim: true, minlength: 1, maxlength: 50 },
        lastName: { type: String, required: true, trim: true, minlength: 1, maxlength: 50 },
        street: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
        city: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
        state: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
        pincode: { type: String, required: true, trim: true, minlength: 3, maxlength: 12 },
        country: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
        phone: { type: String, required: true, trim: true, minlength: 6, maxlength: 20 }
    },
    { _id: false, strict: true }
);

const orderSchema = new mongoose.Schema({

    userId :{
        type:String,
        required:true,
        validate: {
            validator: (value) => objectIdStringRegex.test(String(value || '')),
            message: 'Invalid user id format'
        }
    },
    items : {
        type:[orderItemSchema],
        required:true,
        validate: {
            validator: (value) => Array.isArray(value) && value.length > 0,
            message: 'Order must include at least one item'
        }
    },
    amount : {type:Number,required:true,min:0},
    address : {type:orderAddressSchema, required:true},
    status : {type:String, required:true,default:'Order Placed'},
    paymentMethod : {type:String, required:true, enum: ['COD', 'Stripe', 'Razorpay']},
    payment : {type:Boolean,required:true , default:false},
    paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'cancelled'], default: 'pending' },
    paymentVerifiedAt: { type: Number, default: null },
    stripeSessionId: { type: String, default: null, index: true },
    stripePaymentIntentId: { type: String, default: null },
    razorpayOrderId: { type: String, default: null, index: true },
    razorpayPaymentId: { type: String, default: null },
    gatewayEventId: { type: String, default: null },
    date : {type:Number , required : true}

})

const orderModel = mongoose.models.order || mongoose.model('order',orderSchema)

export default orderModel;