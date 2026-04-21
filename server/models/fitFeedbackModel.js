import mongoose from 'mongoose';

const objectIdStringRegex = /^[a-f\d]{24}$/i;

const fitFeedbackSchema = new mongoose.Schema(
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
        selectedSize: { type: String, required: true, trim: true, maxlength: 10 },
        recommendedSize: { type: String, required: true, trim: true, maxlength: 10 },
        feedback: { type: String, enum: ['too_small', 'perfect', 'too_large'], required: true },
        source: { type: String, enum: ['manual', 'camera', 'hybrid'], default: 'manual' },
        confidence: { type: Number, min: 0, max: 1, default: null },
        modelVersion: { type: String, trim: true, maxlength: 60, default: 'rule-engine-v1' },
        // Engine that actually produced the original recommendation. Captured
        // so the calibration trainer and analytics quality metrics can exclude
        // heuristic-driven feedback (rule_engine, heuristic_fallback, ...).
        predictionSource: { type: String, trim: true, maxlength: 40, default: null }
    },
    { timestamps: true, strict: true }
);

fitFeedbackSchema.index({ userId: 1, productId: 1, orderId: 1 }, { unique: true });
fitFeedbackSchema.index({ productId: 1, selectedSize: 1, feedback: 1 });
fitFeedbackSchema.index({ createdAt: -1 });

const fitFeedbackModel = mongoose.models.fit_feedback || mongoose.model('fit_feedback', fitFeedbackSchema);

export default fitFeedbackModel;
