import crypto from 'crypto';
import Razorpay from 'razorpay';

let razorpayClient = null;

const trim = (value) => String(value || '').trim();

const isRazorpayConfigured = () =>
    Boolean(trim(process.env.RAZORPAY_KEY_ID) && trim(process.env.RAZORPAY_KEY_SECRET));

const isRazorpayWebhookConfigured = () => Boolean(trim(process.env.RAZORPAY_WEBHOOK_SECRET));

const getRazorpayClient = () => {
    if (!isRazorpayConfigured()) {
        return null;
    }

    if (!razorpayClient) {
        razorpayClient = new Razorpay({
            key_id: trim(process.env.RAZORPAY_KEY_ID),
            key_secret: trim(process.env.RAZORPAY_KEY_SECRET)
        });
    }

    return razorpayClient;
};

const resetRazorpayClientForTests = () => {
    razorpayClient = null;
};

const secureCompare = (a, b) => {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');

    if (left.length === 0 || left.length !== right.length) {
        return false;
    }

    return crypto.timingSafeEqual(left, right);
};

const toPaiseAmount = (rupeeAmount) => {
    const numericAmount = Number(rupeeAmount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        throw new Error('Razorpay amount must be a positive number');
    }

    return Math.round(numericAmount * 100);
};

const sanitizeNotes = (notes = {}) => {
    if (!notes || typeof notes !== 'object') {
        return {};
    }

    const sanitized = {};

    for (const [key, value] of Object.entries(notes)) {
        if (value === null || value === undefined) {
            continue;
        }

        const stringKey = String(key).slice(0, 256);
        const stringValue = String(value).slice(0, 512);

        if (stringKey && stringValue) {
            sanitized[stringKey] = stringValue;
        }
    }

    return sanitized;
};

const createCheckoutOrder = async ({ amountInRupees, receipt, notes = {} }) => {
    const client = getRazorpayClient();

    if (!client) {
        const error = new Error('Razorpay is not configured on server');
        error.statusCode = 503;
        throw error;
    }

    const order = await client.orders.create({
        amount: toPaiseAmount(amountInRupees),
        currency: 'INR',
        receipt: String(receipt || '').slice(0, 40),
        payment_capture: 1,
        partial_payment: false,
        notes: sanitizeNotes(notes)
    });

    return order;
};

const verifyCheckoutSignature = ({ orderId, paymentId, signature }) => {
    const keySecret = trim(process.env.RAZORPAY_KEY_SECRET);

    if (!keySecret) {
        return false;
    }

    if (!orderId || !paymentId || !signature) {
        return false;
    }

    const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

    return secureCompare(expectedSignature, signature);
};

const verifyWebhookSignature = ({ rawBody, signature }) => {
    const webhookSecret = trim(process.env.RAZORPAY_WEBHOOK_SECRET);

    if (!webhookSecret || !signature) {
        return false;
    }

    if (!rawBody || (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string')) {
        return false;
    }

    const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

    return secureCompare(expectedSignature, signature);
};

const fetchPayment = async (paymentId) => {
    const client = getRazorpayClient();

    if (!client) {
        const error = new Error('Razorpay is not configured on server');
        error.statusCode = 503;
        throw error;
    }

    return client.payments.fetch(String(paymentId));
};

const createRefund = async ({ paymentId, amountInRupees, notes = {}, speed = 'normal', idempotencyKey, receipt }) => {
    const client = getRazorpayClient();

    if (!client) {
        const error = new Error('Razorpay is not configured on server');
        error.statusCode = 503;
        throw error;
    }

    if (!paymentId) {
        const error = new Error('Razorpay payment id is required for refund');
        error.statusCode = 400;
        throw error;
    }

    // razorpay-node v2.9.x does not accept per-request headers as an options
    // argument (its 3rd parameter is a Node-style callback). To still surface
    // our internal idempotency key to Razorpay's dashboard / reconciliation
    // pipeline we record it inside `notes`, alongside the caller-provided
    // notes. Replay protection is enforced server-side via idempotencyService.
    const mergedNotes = sanitizeNotes({
        ...notes,
        ...(idempotencyKey ? { idempotency_key: String(idempotencyKey).slice(0, 64) } : {})
    });

    const refundPayload = {
        speed: speed === 'optimum' ? 'optimum' : 'normal',
        notes: mergedNotes
    };

    if (amountInRupees !== undefined && amountInRupees !== null) {
        refundPayload.amount = toPaiseAmount(amountInRupees);
    }

    if (receipt) {
        refundPayload.receipt = String(receipt).slice(0, 40);
    }

    return client.payments.refund(String(paymentId), refundPayload);
};

const fetchRefund = async ({ paymentId, refundId }) => {
    const client = getRazorpayClient();

    if (!client) {
        const error = new Error('Razorpay is not configured on server');
        error.statusCode = 503;
        throw error;
    }

    if (paymentId && typeof client.payments?.fetchRefund === 'function') {
        return client.payments.fetchRefund(String(paymentId), String(refundId));
    }

    return client.refunds.fetch(String(refundId));
};

/**
 * Fetch the merchant's current Razorpay balance. Used by the balance
 * monitor job. Returns { balanceInPaise, currency, raw } or null when
 * Razorpay is unconfigured. Throws when the SDK call fails.
 *
 * Note: razorpay-node does not currently expose a typed `balance` API
 * surface in v2.9.x. We hit the REST endpoint via the underlying API
 * client which IS exposed via `client.api`. If that path disappears
 * in a future SDK we will need to switch to a direct axios call.
 */
const fetchBalance = async () => {
    const client = getRazorpayClient();
    if (!client) return null;

    // The SDK's internal `api` client supports arbitrary GETs and signs
    // them with the configured key pair. The endpoint is documented at
    // https://razorpay.com/docs/api/balance/
    if (typeof client?.api?.get !== 'function') {
        const error = new Error('Razorpay SDK does not expose balance API');
        error.statusCode = 501;
        throw error;
    }

    const raw = await client.api.get({ url: '/balance' });
    const balanceInPaise = Number(raw?.balance ?? 0);

    if (!Number.isFinite(balanceInPaise) || !Number.isInteger(balanceInPaise)) {
        const error = new Error('Razorpay balance response was not an integer');
        error.statusCode = 502;
        error.raw = raw;
        throw error;
    }

    return {
        balanceInPaise,
        currency: String(raw?.currency || 'INR'),
        raw
    };
};

export {
    createCheckoutOrder,
    createRefund,
    fetchBalance,
    fetchPayment,
    fetchRefund,
    getRazorpayClient,
    isRazorpayConfigured,
    isRazorpayWebhookConfigured,
    resetRazorpayClientForTests,
    sanitizeNotes,
    secureCompare,
    toPaiseAmount,
    verifyCheckoutSignature,
    verifyWebhookSignature
};
