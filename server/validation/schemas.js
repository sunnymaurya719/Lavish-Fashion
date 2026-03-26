import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id format');

const positiveIntSchema = z.number().int().min(1);
const nonNegativeIntSchema = z.union([z.string(), z.number()]).pipe(z.coerce.number().int().min(0));
const nonNegativeNumberSchema = z.union([z.string(), z.number()]).pipe(z.coerce.number().min(0));
const productStatusSchema = z.enum(['active', 'draft', 'archived']);
const couponDiscountTypeSchema = z.enum(['percentage', 'flat', 'free_shipping']);
const reviewStatusValueSchema = z.enum(['pending', 'published', 'rejected']);
const marketingCampaignTypeSchema = z.enum(['broadcast', 'automation']);
const marketingAudienceSchema = z.enum(['all_users', 'subscribed_users', 'loyalty_members', 'recent_customers']);
const marketingAutomationTriggerSchema = z.enum([
    'manual',
    'user_registered',
    'order_delivered',
    'review_published',
    'points_milestone'
]);
const marketingCampaignStatusValueSchema = z.enum(['draft', 'scheduled', 'active', 'paused', 'sent']);

const booleanLikeSchema = z
    .union([z.boolean(), z.string()])
    .transform((value) => value === true || value === 'true');

const optionalNumberSchema = z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }

        const parsedNumber = Number(value);
        return Number.isFinite(parsedNumber) ? parsedNumber : Number.NaN;
    });

const optionalPositiveIntSchema = optionalNumberSchema.refine(
    (value) => value === null || (Number.isInteger(value) && value >= 1),
    'Field must be a positive whole number'
);

const optionalNonNegativeNumberSchema = optionalNumberSchema.refine(
    (value) => value === null || value >= 0,
    'Field must be a non-negative number'
);

const optionalDateInputSchema = z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
        const trimmedValue = String(value || '').trim();
        return trimmedValue ? trimmedValue : null;
    })
    .refine((value) => value === null || !Number.isNaN(new Date(value).getTime()), 'Invalid date value');

const optionalPhoneSchema = z
    .string()
    .trim()
    .max(20)
    .regex(/^[0-9+\-\s()]*$/, 'Invalid phone number')
    .optional();

const optionalReferralCodeSchema = z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => String(value || '').trim().toUpperCase())
    .refine((value) => value === '' || /^[A-Z0-9]{6,12}$/.test(value), 'Invalid referral code')
    .transform((value) => value || undefined);

const jsonStringArraySchema = z.string().refine((value) => {
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string');
    } catch {
        return false;
    }
}, 'Field must be a JSON array of strings');

const orderItemSchema = z.object({
    _id: objectIdSchema,
    quantity: positiveIntSchema,
    size: z.string().trim().min(1).max(10)
});

const addressSchema = z.object({
    firstName: z.string().trim().min(1).max(50),
    lastName: z.string().trim().min(1).max(50),
    street: z.string().trim().min(1).max(120),
    city: z.string().trim().min(1).max(60),
    state: z.string().trim().min(1).max(60),
    pincode: z.string().trim().min(3).max(12),
    country: z.string().trim().min(1).max(60),
    phone: z.string().trim().min(6).max(20)
});

const marketingPreferencesSchema = z.object({
    emailSubscribed: booleanLikeSchema.optional(),
    promotionalCampaigns: booleanLikeSchema.optional(),
    loyaltyUpdates: booleanLikeSchema.optional(),
    reviewReminders: booleanLikeSchema.optional()
});

const statusValues = ['Order Placed', 'Packing', 'Shipped', 'Out for delivery', 'Delivered'];

const userLoginSchema = z.object({
    email: z.string().trim().email(),
    password: z.string().min(8).max(128)
});

const userRegisterSchema = z.object({
    name: z.string().trim().min(2).max(60),
    email: z.string().trim().email(),
    password: z.string().min(8).max(128),
    referralCode: optionalReferralCodeSchema
});

const userProfileUpdateSchema = z.object({
    name: z.string().trim().min(2).max(60),
    phone: optionalPhoneSchema,
    marketingPreferences: marketingPreferencesSchema.optional()
});

const marketingPreferencesUpdateSchema = marketingPreferencesSchema.refine(
    (value) => Object.keys(value).length > 0,
    'At least one marketing preference must be provided'
);

const wishlistToggleSchema = z.object({
    itemId: objectIdSchema
});

const adminLoginSchema = z.object({
    email: z.string().trim().email(),
    password: z.string().min(8).max(128)
});

const cartAddSchema = z.object({
    itemId: objectIdSchema,
    size: z.string().trim().min(1).max(10)
});

const cartRemoveSchema = z.object({
    itemId: objectIdSchema,
    size: z.string().trim().min(1).max(10)
});

const cartUpdateSchema = z.object({
    itemId: objectIdSchema,
    size: z.string().trim().min(1).max(10),
    quantity: z.number().int().min(0).max(99)
});

const productAddSchema = z.object({
    name: z.string().trim().min(2).max(150),
    description: z.string().trim().min(10).max(5000),
    price: z.union([z.string(), z.number()]).pipe(z.coerce.number().positive()),
    category: z.string().trim().min(2).max(50),
    subCategory: z.string().trim().min(2).max(50),
    sku: z.string().trim().max(40).optional(),
    stock: nonNegativeIntSchema.optional(),
    lowStockThreshold: nonNegativeIntSchema.optional(),
    status: productStatusSchema.optional(),
    isFeatured: z
        .union([z.boolean(), z.string()])
        .transform((value) => value === true || value === 'true')
        .optional(),
    sizes: jsonStringArraySchema.refine((value) => {
        const parsed = JSON.parse(value);
        return parsed.length > 0 && parsed.every((size) => typeof size === 'string' && size.trim().length > 0);
    }, 'sizes must be a JSON array of size strings')
});

const productUpdateSchema = productAddSchema.extend({
    id: objectIdSchema,
    existingImages: jsonStringArraySchema.optional()
});

const productRemoveSchema = z.object({
    id: objectIdSchema
});

const productSingleSchema = z.object({
    id: objectIdSchema
});

const productInventoryUpdateSchema = z.object({
    id: objectIdSchema,
    stock: nonNegativeIntSchema,
    lowStockThreshold: nonNegativeIntSchema,
    status: productStatusSchema
});

const orderCreateSchema = z.object({
    items: z.array(orderItemSchema).min(1),
    address: addressSchema,
    amount: z.union([z.string(), z.number()]).pipe(z.coerce.number().positive()).optional(),
    checkoutSource: z.enum(['cart', 'buy_now']).optional(),
    couponCode: z.string().trim().max(30).optional(),
    pointsToRedeem: nonNegativeIntSchema.optional()
});

const orderPricingPreviewSchema = z.object({
    items: z.array(orderItemSchema).min(1),
    couponCode: z.string().trim().max(30).optional(),
    pointsToRedeem: nonNegativeIntSchema.optional()
});

const couponValidateSchema = z.object({
    couponCode: z.string().trim().min(3).max(30),
    items: z.array(orderItemSchema).min(1)
});

const couponBaseSchema = z.object({
    code: z.string().trim().min(3).max(30),
    description: z.string().trim().max(200).optional(),
    discountType: couponDiscountTypeSchema,
    discountValue: nonNegativeNumberSchema,
    minOrderAmount: nonNegativeNumberSchema.optional(),
    maxDiscountAmount: optionalNonNegativeNumberSchema.optional(),
    usageLimit: optionalPositiveIntSchema.optional(),
    perUserLimit: optionalPositiveIntSchema.optional(),
    startsAt: optionalDateInputSchema.optional(),
    endsAt: optionalDateInputSchema.optional(),
    isActive: booleanLikeSchema.optional()
});

const couponCreateSchema = couponBaseSchema;

const couponUpdateSchema = couponBaseSchema.extend({
    couponId: objectIdSchema
});

const couponStatusSchema = z.object({
    couponId: objectIdSchema,
    isActive: booleanLikeSchema
});

const adminCustomerDetailSchema = z.object({
    customerId: objectIdSchema
});

const adminCustomerNotesSchema = z.object({
    customerId: objectIdSchema,
    adminNotes: z.string().trim().max(1000)
});

const stripeVerifySchema = z.object({
    orderId: objectIdSchema,
    success: z.enum(['true', 'false']).optional(),
    session_id: z.string().trim().min(1).optional()
});

const razorpayVerifySchema = z.object({
    razorpay_order_id: z.string().trim().min(1),
    razorpay_payment_id: z.string().trim().min(1),
    razorpay_signature: z.string().trim().min(1)
});

const orderStatusSchema = z.object({
    orderId: objectIdSchema,
    status: z.enum(statusValues)
});

const reviewProductParamsSchema = z.object({
    productId: objectIdSchema
});

const reviewEligibilitySchema = z.object({
    productId: objectIdSchema
});

const reviewCreateSchema = z.object({
    productId: objectIdSchema,
    rating: z.union([z.string(), z.number()]).pipe(z.coerce.number().int().min(1).max(5)),
    title: z.string().trim().min(3).max(120),
    comment: z.string().trim().min(20).max(1500)
});

const reviewStatusSchema = z.object({
    reviewId: objectIdSchema,
    status: reviewStatusValueSchema,
    adminReply: z.string().trim().max(500).optional()
});

const marketingCampaignBaseSchema = z.object({
    name: z.string().trim().min(3).max(120),
    campaignType: marketingCampaignTypeSchema,
    audience: marketingAudienceSchema,
    automationTrigger: marketingAutomationTriggerSchema,
    subject: z.string().trim().min(3).max(180),
    previewText: z.string().trim().max(220).optional(),
    body: z.string().trim().min(20).max(5000),
    status: marketingCampaignStatusValueSchema.optional(),
    sendAt: optionalDateInputSchema
});

const marketingCampaignCreateSchema = marketingCampaignBaseSchema;

const marketingCampaignUpdateSchema = marketingCampaignBaseSchema.extend({
    campaignId: objectIdSchema
});

const marketingCampaignStatusSchema = z.object({
    campaignId: objectIdSchema,
    status: marketingCampaignStatusValueSchema
});

const marketingCampaignDispatchSchema = z.object({
    campaignId: objectIdSchema
});

const stripeWebhookEventSchema = z.object({
    id: z.string().trim().min(1),
    type: z.string().trim().min(1),
    data: z.object({
        object: z.object({
            id: z.string().trim().min(1),
            client_reference_id: z.string().trim().optional().nullable(),
            payment_intent: z.union([z.string().trim().min(1), z.null()]).optional(),
            metadata: z
                .object({
                    orderId: z.string().trim().optional(),
                    userId: z.string().trim().optional()
                })
                .optional()
        })
    })
});

const razorpayWebhookEventSchema = z.object({
    event: z.string().trim().min(1),
    payload: z
        .object({
            payment: z
                .object({
                    entity: z
                        .object({
                            id: z.string().trim().optional(),
                            order_id: z.string().trim().optional(),
                            status: z.string().trim().optional()
                        })
                        .optional()
                })
                .optional()
        })
        .optional()
});

export {
    adminLoginSchema,
    adminCustomerDetailSchema,
    adminCustomerNotesSchema,
    cartAddSchema,
    cartRemoveSchema,
    cartUpdateSchema,
    couponCreateSchema,
    couponStatusSchema,
    couponUpdateSchema,
    couponValidateSchema,
    orderCreateSchema,
    orderPricingPreviewSchema,
    orderStatusSchema,
    marketingCampaignCreateSchema,
    marketingCampaignDispatchSchema,
    marketingCampaignStatusSchema,
    marketingCampaignUpdateSchema,
    marketingPreferencesUpdateSchema,
    productAddSchema,
    productRemoveSchema,
    productInventoryUpdateSchema,
    productSingleSchema,
    productUpdateSchema,
    reviewCreateSchema,
    reviewEligibilitySchema,
    reviewProductParamsSchema,
    reviewStatusSchema,
    razorpayVerifySchema,
    razorpayWebhookEventSchema,
    stripeVerifySchema,
    stripeWebhookEventSchema,
    userLoginSchema,
    userProfileUpdateSchema,
    userRegisterSchema,
    wishlistToggleSchema
};
