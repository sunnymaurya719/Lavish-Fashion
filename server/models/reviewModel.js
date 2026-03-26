import mongoose from 'mongoose';

const objectIdStringRegex = /^[a-f\d]{24}$/i;

const reviewSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            validate: {
                validator: (value) => objectIdStringRegex.test(String(value || '')),
                message: 'Invalid user id format'
            }
        },
        productId: {
            type: String,
            required: true,
            validate: {
                validator: (value) => objectIdStringRegex.test(String(value || '')),
                message: 'Invalid product id format'
            }
        },
        orderId: {
            type: String,
            required: true,
            validate: {
                validator: (value) => objectIdStringRegex.test(String(value || '')),
                message: 'Invalid order id format'
            }
        },
        reviewerName: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
        rating: { type: Number, required: true, min: 1, max: 5 },
        title: { type: String, required: true, trim: true, minlength: 3, maxlength: 120 },
        comment: { type: String, required: true, trim: true, minlength: 20, maxlength: 1500 },
        media: {
            type: [
                new mongoose.Schema(
                    {
                        url: { type: String, required: true, trim: true, maxlength: 500 },
                        assetId: { type: String, default: '', trim: true, maxlength: 180 }
                    },
                    { _id: false, strict: true }
                )
            ],
            default: []
        },
        status: { type: String, enum: ['pending', 'published', 'rejected'], default: 'pending' },
        adminReply: { type: String, default: '', trim: true, maxlength: 500 },
        rewardPointsGranted: { type: Number, default: 0, min: 0 },
        isVerifiedPurchase: { type: Boolean, default: true }
    },
    { timestamps: true, strict: true }
);

reviewSchema.index({ productId: 1, userId: 1 }, { unique: true });

const reviewModel = mongoose.models.review || mongoose.model('review', reviewSchema);

export default reviewModel;
