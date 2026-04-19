import crypto from 'crypto';
import Ably from 'ably';
import logger from '../config/logger.js';
import { decorateOrderWithShiprocketPricingAudit } from './shiprocketService.js';

const REALTIME_CHANNEL_ADMIN_ORDERS = 'admin.orders';
const REALTIME_EVENT_ORDER_UPSERT = 'order.upsert';
const DEFAULT_TOKEN_TTL_MS = 10 * 60 * 1000;

let ablyRestClient;

const normalizeString = (value) => String(value || '').trim();

const getRealtimeProvider = () => normalizeString(process.env.REALTIME_PROVIDER || 'ably').toLowerCase();
const getAblyApiKey = () => normalizeString(process.env.ABLY_API_KEY);

const isRealtimeEnabled = () => {
    const envValue = normalizeString(process.env.REALTIME_ENABLED).toLowerCase();

    if (envValue === 'true') {
        return true;
    }

    if (envValue === 'false') {
        return false;
    }

    return Boolean(getAblyApiKey());
};

const isRealtimeConfigured = () =>
    isRealtimeEnabled() && getRealtimeProvider() === 'ably' && Boolean(getAblyApiKey());

const getAblyRestClient = () => {
    if (!isRealtimeConfigured()) {
        return null;
    }

    if (!ablyRestClient) {
        ablyRestClient = new Ably.Rest({ key: getAblyApiKey() });
    }

    return ablyRestClient;
};

const toPlainObject = (value) => {
    if (!value) {
        return null;
    }

    if (typeof value.toObject === 'function') {
        return value.toObject();
    }

    return { ...value };
};

const normalizeOrderForRealtime = (order) => {
    const normalizedOrder = toPlainObject(order);

    if (!normalizedOrder) {
        return null;
    }

    normalizedOrder._id = String(normalizedOrder._id || '');
    normalizedOrder.userId = String(normalizedOrder.userId || '');
    normalizedOrder.date = Number(normalizedOrder.date || Date.now());

    if (Array.isArray(normalizedOrder.items)) {
        normalizedOrder.items = normalizedOrder.items.map((item) => ({
            ...item,
            _id: String(item?._id || ''),
            quantity: Number(item?.quantity || 0),
            price: Number(item?.price || 0),
            image: Array.isArray(item?.image)
                ? item.image
                : typeof item?.image === 'string' && item.image
                    ? [item.image]
                    : []
        }));
    } else {
        normalizedOrder.items = [];
    }

    return decorateOrderWithShiprocketPricingAudit(normalizedOrder);
};

const createOrderUpsertEvent = ({ order, source = 'unknown' }) => {
    const normalizedOrder = normalizeOrderForRealtime(order);

    if (!normalizedOrder || !normalizedOrder._id) {
        return null;
    }

    return {
        version: 1,
        type: REALTIME_EVENT_ORDER_UPSERT,
        eventId: `${normalizedOrder._id}_${Date.now()}_${crypto.randomUUID()}`,
        occurredAt: new Date().toISOString(),
        source,
        order: normalizedOrder
    };
};

const publishAdminOrderUpsert = async ({ order, source }) => {
    const eventPayload = createOrderUpsertEvent({ order, source });

    if (!eventPayload) {
        return { published: false, reason: 'invalid_payload' };
    }

    const ablyClient = getAblyRestClient();

    if (!ablyClient) {
        return { published: false, reason: 'disabled_or_unconfigured' };
    }

    try {
        const channel = ablyClient.channels.get(REALTIME_CHANNEL_ADMIN_ORDERS);
        await channel.publish(REALTIME_EVENT_ORDER_UPSERT, eventPayload);

        logger.info(
            {
                event: 'realtime.publish.success',
                channel: REALTIME_CHANNEL_ADMIN_ORDERS,
                eventName: REALTIME_EVENT_ORDER_UPSERT,
                eventId: eventPayload.eventId,
                orderId: eventPayload.order._id,
                source
            },
            'Published admin order update event'
        );

        return { published: true, eventId: eventPayload.eventId };
    } catch (error) {
        logger.warn(
            {
                event: 'realtime.publish.failure',
                channel: REALTIME_CHANNEL_ADMIN_ORDERS,
                eventName: REALTIME_EVENT_ORDER_UPSERT,
                eventId: eventPayload.eventId,
                orderId: eventPayload.order._id,
                source,
                err: error
            },
            'Failed to publish admin order update event'
        );

        return { published: false, reason: 'publish_failure' };
    }
};

const createAdminRealtimeTokenRequest = async ({ adminEmail }) => {
    const ablyClient = getAblyRestClient();

    if (!ablyClient) {
        throw new Error('Realtime is disabled or not configured');
    }

    const capability = JSON.stringify({
        [REALTIME_CHANNEL_ADMIN_ORDERS]: ['subscribe']
    });

    const ttl = Number(process.env.REALTIME_TOKEN_TTL_MS || DEFAULT_TOKEN_TTL_MS);

    return ablyClient.auth.createTokenRequest({
        clientId: `admin:${String(adminEmail || 'unknown').toLowerCase()}`,
        capability,
        ttl: Number.isFinite(ttl) ? ttl : DEFAULT_TOKEN_TTL_MS
    });
};

export {
    REALTIME_CHANNEL_ADMIN_ORDERS,
    REALTIME_EVENT_ORDER_UPSERT,
    createAdminRealtimeTokenRequest,
    isRealtimeConfigured,
    isRealtimeEnabled,
    publishAdminOrderUpsert
};
