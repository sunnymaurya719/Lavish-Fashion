import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id format');

const positiveIntSchema = z.number().int().min(1);

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

const statusValues = ['Order Placed', 'Packing', 'Shipped', 'Out for delivery', 'Delivered'];

const userLoginSchema = z.object({
    email: z.string().trim().email(),
    password: z.string().min(8).max(128)
});

const userRegisterSchema = z.object({
    name: z.string().trim().min(2).max(60),
    email: z.string().trim().email(),
    password: z.string().min(8).max(128)
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
    sizes: z.string().refine((value) => {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) && parsed.length > 0 && parsed.every((size) => typeof size === 'string' && size.trim().length > 0);
        } catch {
            return false;
        }
    }, 'sizes must be a JSON array of size strings')
});

const productRemoveSchema = z.object({
    id: objectIdSchema
});

const orderCreateSchema = z.object({
    items: z.array(orderItemSchema).min(1),
    address: addressSchema,
    amount: z.union([z.string(), z.number()]).pipe(z.coerce.number().positive()).optional()
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
    cartAddSchema,
    cartRemoveSchema,
    cartUpdateSchema,
    orderCreateSchema,
    orderStatusSchema,
    productAddSchema,
    productRemoveSchema,
    razorpayVerifySchema,
    razorpayWebhookEventSchema,
    stripeVerifySchema,
    stripeWebhookEventSchema,
    userLoginSchema,
    userRegisterSchema
};