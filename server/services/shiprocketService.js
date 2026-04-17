import crypto from 'crypto';
import axios from 'axios';
import orderModel from '../models/orderModel.js';
import userModel from '../models/userModel.js';
import logger from '../config/logger.js';
import {
    getShiprocketConfig,
    getValidToken,
    invalidateToken,
    isShiprocketConfigured,
    isShiprocketEnabled
} from '../config/shiprocket.js';

const SHIPROCKET_SYNC_STATUS = {
    notRequired: 'not_required',
    pending: 'pending',
    synced: 'synced',
    pendingRetry: 'pending_retry',
    failed: 'failed'
};

const normalizeText = (value) => String(value || '').trim();
const normalizeDigits = (value) => normalizeText(value).replace(/[^\d]/g, '');
const normalizeNumber = (value) => {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
};
const roundCurrency = (value) => Number(Number(value || 0).toFixed(2));
const truncateText = (value, maxLength = 500) => normalizeText(value).slice(0, maxLength);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isAxios401Error = (error) => Number(error?.response?.status) === 401;
const isAmbiguousShiprocketCreateFailure = (error) => {
    const statusCode = Number(error?.statusCode || error?.response?.status || 0);

    if (error?.response) {
        return statusCode === 422 || statusCode === 429 || statusCode >= 500;
    }

    if (statusCode === 422 || statusCode === 429 || statusCode >= 500) {
        return true;
    }

    return Boolean(error?.code === 'ECONNABORTED' || (!error?.response && error?.request));
};

const formatShiprocketOrderDate = (value) => {
    const date = value ? new Date(value) : new Date();

    if (Number.isNaN(date.getTime())) {
        return new Date().toISOString().slice(0, 19).replace('T', ' ');
    }

    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const normalizeShiprocketError = (error, fallbackMessage = 'Shiprocket request failed') => {
    const upstreamStatusCode = Number(error?.response?.status || 0);
    const upstreamPayload = error?.response?.data;
    const upstreamMessage = normalizeText(
        upstreamPayload?.message ||
            upstreamPayload?.error ||
            upstreamPayload?.detail ||
            upstreamPayload?.status ||
            error?.message
    );
    const normalizedError = new Error(upstreamMessage || fallbackMessage);

    normalizedError.name = 'ShiprocketRequestError';
    normalizedError.statusCode = upstreamStatusCode >= 400 && upstreamStatusCode < 500 ? 502 : 502;
    normalizedError.upstreamStatusCode = upstreamStatusCode || null;
    normalizedError.upstreamPayload = upstreamPayload || null;
    normalizedError.code = error?.code || '';
    normalizedError.request = error?.request || null;

    return normalizedError;
};

const buildShiprocketPayloadError = (payload = {}, fallbackMessage = 'Shiprocket request failed') => {
    const upstreamStatusCode = Number(payload?.status_code ?? payload?.data?.status_code ?? 0) || 502;
    const upstreamMessage = normalizeText(
        payload?.message ||
            payload?.error ||
            payload?.detail ||
            payload?.status ||
            fallbackMessage
    );
    const normalizedError = new Error(upstreamMessage || fallbackMessage);

    normalizedError.name = 'ShiprocketPayloadError';
    normalizedError.statusCode = 502;
    normalizedError.upstreamStatusCode = upstreamStatusCode;
    normalizedError.upstreamPayload = payload || null;

    return normalizedError;
};

const extractPickupLocationOptions = (payload = {}) => {
    const pickupLocations = [];
    const candidates = Array.isArray(payload?.data?.data) ? payload.data.data : [];

    for (const item of candidates) {
        const pickupLocation = normalizeText(item?.pickup_location);
        if (pickupLocation) {
            pickupLocations.push(pickupLocation);
        }
    }

    return pickupLocations;
};

const isLogicalShiprocketCreateFailure = (payload = {}) => {
    const bodyStatusCode = Number(payload?.status_code ?? payload?.data?.status_code ?? 0);
    const message = normalizeText(payload?.message).toLowerCase();

    if (bodyStatusCode >= 400) {
        return true;
    }

    return Boolean(
        message.includes('wrong pickup location') ||
            message.includes('please choose one location') ||
            message.includes('please add billing/shipping address first')
    );
};

const buildShiprocketLogger = ({ log, action, orderId = '' } = {}) => {
    if (log?.child) {
        return log.child({
            integration: 'shiprocket',
            action,
            orderId: String(orderId || '')
        });
    }

    return logger.child({
        integration: 'shiprocket',
        action,
        orderId: String(orderId || '')
    });
};

const createShiprocketClient = () => {
    const config = getShiprocketConfig();

    return axios.create({
        baseURL: config.baseUrl,
        timeout: config.timeoutMs,
        headers: {
            'Content-Type': 'application/json'
        }
    });
};

const requestWithAuth = async (requestConfig, { retryOn401 = true, log } = {}) => {
    const client = createShiprocketClient();

    try {
        const token = await getValidToken();
        return await client.request({
            ...requestConfig,
            headers: {
                ...(requestConfig.headers || {}),
                Authorization: `Bearer ${token}`
            }
        });
    } catch (error) {
        if (retryOn401 && isAxios401Error(error)) {
            log?.warn(
                {
                    action: 'retry_after_401',
                    requestUrl: requestConfig?.url || ''
                },
                'Shiprocket request received 401, refreshing token and retrying once'
            );

            invalidateToken();
            const refreshedToken = await getValidToken();

            try {
                return await client.request({
                    ...requestConfig,
                    headers: {
                        ...(requestConfig.headers || {}),
                        Authorization: `Bearer ${refreshedToken}`
                    }
                });
            } catch (retryError) {
                throw normalizeShiprocketError(retryError);
            }
        }

        throw normalizeShiprocketError(error);
    }
};

const normalizeShiprocketCreateResponse = (payload = {}) => ({
    referenceOrderId: normalizeText(payload?.channel_order_id ?? payload?.customer_order_id),
    shiprocketOrderId: normalizeNumber(payload?.order_id ?? payload?.data?.order_id),
    shipmentId: normalizeNumber(payload?.shipment_id ?? payload?.data?.shipment_id),
    awbCode: normalizeText(payload?.awb_code ?? payload?.data?.awb_code),
    courierCompanyId: normalizeNumber(payload?.courier_company_id ?? payload?.data?.courier_company_id),
    courierName: normalizeText(payload?.courier_name ?? payload?.data?.courier_name),
    status: normalizeText(payload?.status ?? payload?.data?.status),
    statusCode: normalizeNumber(payload?.status_code ?? payload?.data?.status_code),
    pickupLocationOptions: extractPickupLocationOptions(payload),
    raw: payload
});

const extractOrderListItems = (payload = {}) => {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (Array.isArray(payload?.data)) {
        return payload.data;
    }

    if (Array.isArray(payload?.data?.data)) {
        return payload.data.data;
    }

    if (Array.isArray(payload?.orders)) {
        return payload.orders;
    }

    return [];
};

const normalizeShiprocketOrderResponse = (payload = {}) => {
    const shipment = Array.isArray(payload?.shipments) ? payload.shipments[0] : payload?.shipment || payload?.data?.shipment;

    return {
        shiprocketOrderId: normalizeNumber(payload?.id ?? payload?.order_id ?? payload?.data?.id),
        shipmentId: normalizeNumber(shipment?.id ?? payload?.shipment_id ?? payload?.data?.shipment_id),
        awbCode: normalizeText(
            shipment?.awb ??
                shipment?.awb_code ??
                payload?.awb_code ??
                payload?.data?.awb_code
        ),
        courierCompanyId: normalizeNumber(shipment?.courier_id ?? payload?.courier_company_id),
        courierName: normalizeText(shipment?.courier ?? shipment?.courier_name ?? payload?.courier_name),
        status: normalizeText(
            shipment?.status ??
                payload?.status ??
                payload?.current_status ??
                payload?.data?.status
        ),
        statusCode: normalizeNumber(
            payload?.status_code ??
                payload?.current_status_id ??
                payload?.data?.status_code
        ),
        raw: payload
    };
};

const normalizeShiprocketTrackingResponse = (payload = {}) => {
    const trackingData = payload?.tracking_data || {};
    const activities = Array.isArray(trackingData?.shipment_track_activities)
        ? trackingData.shipment_track_activities
        : [];
    const latestActivity = activities[0] || {};

    return {
        currentStatus: normalizeText(
            latestActivity?.activity ??
                trackingData?.shipment_status ??
                trackingData?.current_status ??
                trackingData?.error
        ),
        currentStatusCode: normalizeNumber(
            trackingData?.current_status_id ??
                trackingData?.shipment_status_code ??
                trackingData?.status_code
        ),
        trackUrl: normalizeText(trackingData?.track_url),
        activities,
        raw: payload
    };
};

const resolveFallbackSku = (item = {}) => {
    const baseProductId = normalizeText(item?._id || item?.productId).slice(-8).toUpperCase();
    const sizeSuffix = normalizeText(item?.size).replace(/\s+/g, '').toUpperCase();
    return truncateText(`LF-${baseProductId}${sizeSuffix ? `-${sizeSuffix}` : ''}`, 40);
};

const pickFirstPresent = (...values) => {
    for (const value of values) {
        const normalizedValue = normalizeText(value);
        if (normalizedValue) {
            return normalizedValue;
        }
    }

    return '';
};

const splitName = (fullName = '') => {
    const normalizedName = normalizeText(fullName);
    if (!normalizedName) {
        return { firstName: '', lastName: '' };
    }

    const parts = normalizedName.split(/\s+/).filter(Boolean);
    return {
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' ')
    };
};

const buildShiprocketAddressContext = ({ order, user }) => {
    const orderAddress = isObject(order?.address) ? order.address : {};
    const userNameParts = splitName(user?.name);
    const orderNameParts = splitName(orderAddress?.name);
    const firstName = pickFirstPresent(orderAddress?.firstName, orderNameParts.firstName, userNameParts.firstName);
    const lastName = pickFirstPresent(orderAddress?.lastName, orderNameParts.lastName, userNameParts.lastName);
    const addressLine1 = pickFirstPresent(
        orderAddress?.street,
        orderAddress?.address,
        orderAddress?.addressLine1,
        orderAddress?.line1
    );
    const addressLine2 = pickFirstPresent(
        orderAddress?.address2,
        orderAddress?.addressLine2,
        orderAddress?.line2,
        orderAddress?.landmark
    );
    const city = pickFirstPresent(orderAddress?.city, orderAddress?.town);
    const state = pickFirstPresent(orderAddress?.state, orderAddress?.province);
    const pincode = pickFirstPresent(orderAddress?.pincode, orderAddress?.postalCode, orderAddress?.zipCode);
    const country = pickFirstPresent(orderAddress?.country, 'India');
    const billingPhone = normalizeDigits(
        pickFirstPresent(orderAddress?.phone, orderAddress?.mobile, orderAddress?.contactPhone, user?.phone)
    );
    const customerEmail = pickFirstPresent(order?.customerEmail, user?.email);

    return {
        firstName,
        lastName,
        addressLine1,
        addressLine2,
        city,
        state,
        pincode,
        country,
        billingPhone,
        customerEmail
    };
};

const mapLocalOrderToShiprocketPayload = (order, user) => {
    const config = getShiprocketConfig();
    const referenceOrderId = normalizeText(order?.shiprocket?.referenceOrderId || order?.publicOrderCode);
    const addressContext = buildShiprocketAddressContext({ order, user });
    const parcel = order?.shiprocket?.parcel || {};
    const orderItems = Array.isArray(order?.items)
        ? order.items.map((item) => ({
            name: normalizeText(item?.name),
            sku: normalizeText(item?.sku) || resolveFallbackSku(item),
            units: Math.max(1, Number(item?.quantity || 1)),
            selling_price: roundCurrency(item?.price),
            discount: normalizeText(item?.discount || ''),
            tax: normalizeText(item?.tax || ''),
            hsn: normalizeText(item?.hsn || '')
        }))
        : [];

    if (!referenceOrderId) {
        const error = new Error('Order is missing a Shiprocket reference order id');
        error.statusCode = 500;
        throw error;
    }

    const requiredFields = {
        billing_customer_name: addressContext.firstName,
        billing_last_name: addressContext.lastName,
        billing_address: addressContext.addressLine1,
        billing_city: addressContext.city,
        billing_pincode: addressContext.pincode,
        billing_state: addressContext.state,
        billing_country: addressContext.country,
        billing_email: addressContext.customerEmail,
        billing_phone: addressContext.billingPhone
    };
    const missingFields = Object.entries(requiredFields)
        .filter(([, value]) => !normalizeText(value))
        .map(([fieldName]) => fieldName);

    if (missingFields.length > 0 || orderItems.length === 0) {
        const suffix = [
            missingFields.length > 0 ? `missing fields: ${missingFields.join(', ')}` : '',
            orderItems.length === 0 ? 'order_items are empty' : ''
        ]
            .filter(Boolean)
            .join('; ');
        const error = new Error(
            `Order is missing required Shiprocket fulfillment fields${suffix ? ` (${suffix})` : ''}`
        );
        error.statusCode = 400;
        throw error;
    }

    return {
        order_id: referenceOrderId,
        order_date: formatShiprocketOrderDate(order?.createdAt || order?.date),
        pickup_location: config.pickupLocation,
        billing_customer_name: addressContext.firstName,
        billing_last_name: addressContext.lastName,
        billing_address: addressContext.addressLine1,
        billing_address_2: addressContext.addressLine2,
        billing_city: addressContext.city,
        billing_pincode: addressContext.pincode,
        billing_state: addressContext.state,
        billing_country: addressContext.country,
        billing_email: addressContext.customerEmail,
        billing_phone: addressContext.billingPhone,
        shipping_customer_name: addressContext.firstName,
        shipping_last_name: addressContext.lastName,
        shipping_address: addressContext.addressLine1,
        shipping_address_2: addressContext.addressLine2,
        shipping_city: addressContext.city,
        shipping_pincode: addressContext.pincode,
        shipping_state: addressContext.state,
        shipping_country: addressContext.country,
        shipping_email: addressContext.customerEmail,
        shipping_phone: addressContext.billingPhone,
        shipping_is_billing: true,
        order_items: orderItems,
        payment_method: order?.paymentMethod === 'COD' ? 'COD' : 'Prepaid',
        shipping_charges: roundCurrency(order?.deliveryFee),
        giftwrap_charges: 0,
        transaction_charges: 0,
        total_discount: roundCurrency(order?.discountAmount),
        sub_total: roundCurrency(order?.amount),
        length: Number(parcel?.lengthCm || config.defaultDimensions.lengthCm),
        breadth: Number(parcel?.breadthCm || config.defaultDimensions.breadthCm),
        height: Number(parcel?.heightCm || config.defaultDimensions.heightCm),
        weight: Number(parcel?.weightKg || config.defaultDimensions.weightKg)
    };
};

const buildOrderPayloadSummary = (orderData = {}) => ({
    pickupLocation: normalizeText(orderData?.pickup_location),
    hasBillingCustomerName: Boolean(normalizeText(orderData?.billing_customer_name)),
    hasBillingLastName: Boolean(normalizeText(orderData?.billing_last_name)),
    hasBillingAddress: Boolean(normalizeText(orderData?.billing_address)),
    hasBillingCity: Boolean(normalizeText(orderData?.billing_city)),
    hasBillingPincode: Boolean(normalizeText(orderData?.billing_pincode)),
    hasBillingState: Boolean(normalizeText(orderData?.billing_state)),
    hasBillingCountry: Boolean(normalizeText(orderData?.billing_country)),
    hasBillingEmail: Boolean(normalizeText(orderData?.billing_email)),
    hasBillingPhone: Boolean(normalizeText(orderData?.billing_phone)),
    hasShippingAddress: Boolean(normalizeText(orderData?.shipping_address)),
    hasShippingCity: Boolean(normalizeText(orderData?.shipping_city)),
    hasShippingPincode: Boolean(normalizeText(orderData?.shipping_pincode)),
    hasShippingState: Boolean(normalizeText(orderData?.shipping_state)),
    hasShippingCountry: Boolean(normalizeText(orderData?.shipping_country)),
    hasShippingEmail: Boolean(normalizeText(orderData?.shipping_email)),
    hasShippingPhone: Boolean(normalizeText(orderData?.shipping_phone)),
    orderItemsCount: Array.isArray(orderData?.order_items) ? orderData.order_items.length : 0
});

const createOrder = async (orderData, options = {}) => {
    const shiprocketLog = buildShiprocketLogger({
        log: options.log,
        action: 'create_order',
        orderId: orderData?.order_id || ''
    });

    try {
        const response = await requestWithAuth(
            {
                method: 'POST',
                url: '/orders/create/adhoc',
                data: orderData
            },
            { log: shiprocketLog }
        );

        if (isLogicalShiprocketCreateFailure(response.data)) {
            throw buildShiprocketPayloadError(
                response.data,
                'Shiprocket create order returned an application-level error'
            );
        }

        return normalizeShiprocketCreateResponse(response.data);
    } catch (error) {
        shiprocketLog.error(
            {
                errorMessage: error?.message || 'Shiprocket create order failed',
                upstreamStatusCode: error?.upstreamStatusCode || null,
                payloadSummary: buildOrderPayloadSummary(orderData),
                pickupLocationOptions: extractPickupLocationOptions(error?.upstreamPayload)
            },
            'Shiprocket create order request failed'
        );

        throw error;
    }
};

const getOrder = async (orderId, options = {}) => {
    const shiprocketLog = buildShiprocketLogger({
        log: options.log,
        action: 'get_order',
        orderId
    });

    const response = await requestWithAuth(
        {
            method: 'GET',
            url: `/orders/show/${encodeURIComponent(orderId)}`
        },
        { log: shiprocketLog }
    );

    return normalizeShiprocketOrderResponse(response.data);
};

const findOrdersByReference = async (referenceOrderId, options = {}) => {
    const shiprocketLog = buildShiprocketLogger({
        log: options.log,
        action: 'find_orders_by_reference',
        orderId: referenceOrderId
    });

    const response = await requestWithAuth(
        {
            method: 'GET',
            url: '/orders',
            params: {
                search: referenceOrderId
            }
        },
        { log: shiprocketLog }
    );

    return extractOrderListItems(response.data);
};

const getPickupAddressStatus = async (options = {}) => {
    const shiprocketLog = buildShiprocketLogger({
        log: options.log,
        action: 'pickup_address_status'
    });

    const response = await requestWithAuth(
        {
            method: 'GET',
            url: '/settings/company/pickup'
        },
        { log: shiprocketLog }
    );

    const payloadData = isObject(response?.data?.data) ? response.data.data : {};
    const shippingAddress = isObject(payloadData?.shipping_address) ? payloadData.shipping_address : null;
    const recentAddresses = Array.isArray(payloadData?.recent_addresses) ? payloadData.recent_addresses : [];

    return {
        ready: Boolean(shippingAddress),
        shippingAddress,
        recentAddresses,
        raw: response?.data || null
    };
};

const trackShipment = async (awb, options = {}) => {
    const shiprocketLog = buildShiprocketLogger({
        log: options.log,
        action: 'track_shipment',
        orderId: awb
    });

    const response = await requestWithAuth(
        {
            method: 'GET',
            url: `/courier/track/awb/${encodeURIComponent(awb)}`
        },
        { log: shiprocketLog }
    );

    return normalizeShiprocketTrackingResponse(response.data);
};

const reconcileExistingShiprocketOrder = async (referenceOrderId, options = {}) => {
    const matchingOrders = await findOrdersByReference(referenceOrderId, options);

    const matchedOrder = matchingOrders.find((item) => {
        const candidateReference = normalizeText(
            item?.channel_order_id ||
                item?.order_id ||
                item?.customer_order_id
        );

        return candidateReference === referenceOrderId;
    });

    if (!matchedOrder) {
        return null;
    }

    const shiprocketOrderId = normalizeNumber(matchedOrder?.id || matchedOrder?.order_id);
    if (shiprocketOrderId) {
        try {
            return await getOrder(shiprocketOrderId, options);
        } catch {
            return normalizeShiprocketOrderResponse(matchedOrder);
        }
    }

    return normalizeShiprocketOrderResponse(matchedOrder);
};

const buildShiprocketUpdatePayload = ({
    result,
    existingShiprocket = {},
    status = SHIPROCKET_SYNC_STATUS.synced,
    lastError = ''
}) => ({
    'shiprocket.syncStatus': status,
    'shiprocket.referenceOrderId':
        normalizeText(result?.referenceOrderId) ||
        normalizeText(existingShiprocket?.referenceOrderId),
    'shiprocket.orderId': result?.shiprocketOrderId ?? existingShiprocket?.orderId ?? null,
    'shiprocket.shipmentId': result?.shipmentId ?? existingShiprocket?.shipmentId ?? null,
    'shiprocket.awbCode': normalizeText(result?.awbCode) || normalizeText(existingShiprocket?.awbCode),
    'shiprocket.courierCompanyId': result?.courierCompanyId ?? existingShiprocket?.courierCompanyId ?? null,
    'shiprocket.courierName': normalizeText(result?.courierName) || normalizeText(existingShiprocket?.courierName),
    'shiprocket.status': normalizeText(result?.status) || normalizeText(existingShiprocket?.status),
    'shiprocket.statusCode': result?.statusCode ?? existingShiprocket?.statusCode ?? null,
    'shiprocket.currentStatus':
        normalizeText(result?.currentStatus || result?.status) || normalizeText(existingShiprocket?.currentStatus),
    'shiprocket.currentStatusCode':
        result?.currentStatusCode ?? result?.statusCode ?? existingShiprocket?.currentStatusCode ?? null,
    'shiprocket.trackUrl': normalizeText(result?.trackUrl) || normalizeText(existingShiprocket?.trackUrl),
    'shiprocket.syncedAt': status === SHIPROCKET_SYNC_STATUS.synced ? Date.now() : null,
    'shiprocket.lastTrackedAt':
        result?.currentStatus || result?.trackUrl
            ? Date.now()
            : existingShiprocket?.lastTrackedAt ?? null,
    'shiprocket.lastError': truncateText(lastError)
});

const syncOrderToShiprocket = async (localOrder, options = {}) => {
    const orderId = normalizeText(localOrder?._id);
    const shiprocketLog = buildShiprocketLogger({
        log: options.log,
        action: 'sync_order',
        orderId
    });

    if (!orderId) {
        const error = new Error('Local order id is required to sync with Shiprocket');
        error.statusCode = 500;
        throw error;
    }

    const force = options.force === true;
    const throwOnFailure = options.throwOnFailure === true;

    const currentOrder = await orderModel.findById(orderId).lean();
    if (!currentOrder) {
        const error = new Error('Order not found for Shiprocket sync');
        error.statusCode = 404;
        throw error;
    }

    if (!isShiprocketEnabled()) {
        await orderModel.findByIdAndUpdate(orderId, {
            $set: {
                'shiprocket.syncStatus': SHIPROCKET_SYNC_STATUS.notRequired,
                'shiprocket.lastError': ''
            }
        });

        return {
            success: true,
            skipped: true,
            reason: 'shiprocket_disabled'
        };
    }

    if (!isShiprocketConfigured()) {
        const configError = new Error('Shiprocket integration is not fully configured');
        configError.statusCode = 503;

        await orderModel.findByIdAndUpdate(orderId, {
            $set: {
                'shiprocket.syncStatus': SHIPROCKET_SYNC_STATUS.pendingRetry,
                'shiprocket.lastError': truncateText(configError.message)
            }
        });

        if (throwOnFailure) {
            throw configError;
        }

        return {
            success: false,
            error: configError.message
        };
    }

    if (!force && currentOrder?.shiprocket?.shipmentId) {
        return {
            success: true,
            skipped: true,
            reason: 'already_synced',
            shiprocket: currentOrder.shiprocket
        };
    }

    const user = currentOrder.customerEmail ? null : await userModel.findById(currentOrder.userId).lean();
    let syncResult = null;

    try {
        const payload = mapLocalOrderToShiprocketPayload(currentOrder, user);
        await orderModel.findByIdAndUpdate(orderId, {
            $set: {
                'shiprocket.syncStatus': SHIPROCKET_SYNC_STATUS.pending,
                'shiprocket.lastError': '',
                customerEmail: normalizeText(currentOrder.customerEmail || user?.email)
            }
        });

        try {
            syncResult = await createOrder(payload, {
                log: shiprocketLog
            });
        } catch (error) {
            if (!isAmbiguousShiprocketCreateFailure(error)) {
                throw error;
            }

            shiprocketLog.warn(
                {
                    referenceOrderId: payload.order_id,
                    errorMessage: error?.message || 'Ambiguous Shiprocket create order failure'
                },
                'Shiprocket create order failed ambiguously, attempting reconciliation by reference order id'
            );

            const reconciledOrder = await reconcileExistingShiprocketOrder(payload.order_id, {
                log: shiprocketLog
            });

            if (!reconciledOrder) {
                throw error;
            }

            syncResult = reconciledOrder;
        }

        if (!syncResult?.shiprocketOrderId && !syncResult?.shipmentId) {
            const reconciledOrder = await reconcileExistingShiprocketOrder(payload.order_id, {
                log: shiprocketLog
            });

            if (reconciledOrder?.shiprocketOrderId || reconciledOrder?.shipmentId) {
                syncResult = reconciledOrder;
            } else {
                const missingIdentifiersError = new Error(
                    'Shiprocket create order did not return order or shipment identifiers'
                );
                missingIdentifiersError.statusCode = 502;
                missingIdentifiersError.upstreamPayload = syncResult?.raw || null;
                throw missingIdentifiersError;
            }
        }

        const updatePayload = buildShiprocketUpdatePayload({
            result: syncResult,
            existingShiprocket: currentOrder.shiprocket || {},
            status: SHIPROCKET_SYNC_STATUS.synced
        });
        const updatedOrder = await orderModel.findByIdAndUpdate(
            orderId,
            {
                $set: {
                    ...updatePayload,
                    'shiprocket.rawCreateResponse': syncResult?.raw || null,
                    customerEmail: normalizeText(currentOrder.customerEmail || user?.email)
                }
            },
            { new: true }
        );

        shiprocketLog.info(
            {
                shipmentId: syncResult?.shipmentId ?? null,
                shiprocketOrderId: syncResult?.shiprocketOrderId ?? null,
                awbCode: syncResult?.awbCode || ''
            },
            'Order synced with Shiprocket successfully'
        );

        return {
            success: true,
            order: updatedOrder,
            shiprocket: updatedOrder?.shiprocket || null
        };
    } catch (error) {
        await orderModel.findByIdAndUpdate(orderId, {
            $set: {
                ...buildShiprocketUpdatePayload({
                    result: {},
                    existingShiprocket: currentOrder.shiprocket || {},
                    status: SHIPROCKET_SYNC_STATUS.pendingRetry,
                    lastError: error?.message || 'Shiprocket sync failed'
                }),
                'shiprocket.rawCreateResponse': currentOrder?.shiprocket?.rawCreateResponse || null
            }
        });

        shiprocketLog.error(
            {
                errorMessage: error?.message || 'Shiprocket sync failed',
                upstreamStatusCode: error?.upstreamStatusCode || null
            },
            'Order sync with Shiprocket failed'
        );

        if (throwOnFailure) {
            throw error;
        }

        return {
            success: false,
            error: error?.message || 'Shiprocket sync failed'
        };
    }
};

const refreshOrderTracking = async (localOrder, options = {}) => {
    const orderId = normalizeText(localOrder?._id);
    const currentOrder = await orderModel.findById(orderId);

    if (!currentOrder) {
        const error = new Error('Order not found for Shiprocket tracking');
        error.statusCode = 404;
        throw error;
    }

    if (!normalizeText(currentOrder?.shiprocket?.awbCode)) {
        const error = new Error('Shiprocket AWB is not available for this order');
        error.statusCode = 400;
        throw error;
    }

    const tracking = await trackShipment(currentOrder.shiprocket.awbCode, options);
    const updatedOrder = await orderModel.findByIdAndUpdate(
        currentOrder._id,
        {
            $set: {
                'shiprocket.currentStatus': normalizeText(tracking.currentStatus),
                'shiprocket.currentStatusCode': tracking.currentStatusCode ?? null,
                'shiprocket.trackUrl': normalizeText(tracking.trackUrl),
                'shiprocket.rawTrackingResponse': tracking.raw || null,
                'shiprocket.lastTrackedAt': Date.now(),
                'shiprocket.lastError': ''
            }
        },
        { new: true }
    );

    return {
        tracking,
        order: updatedOrder
    };
};

const buildShiprocketWebhookEventKey = (payload = {}) => {
    const fingerprintSource = JSON.stringify(payload);
    const eventId = normalizeText(
        payload?.event_id ||
            payload?.id ||
            payload?.webhook_id
    );

    if (eventId) {
        return `shiprocket:${eventId}`;
    }

    const shipmentId = normalizeText(payload?.shipment_id || payload?.data?.shipment_id);
    const currentStatus = normalizeText(payload?.current_status || payload?.data?.current_status);
    const occurredAt = normalizeText(payload?.event_time || payload?.timestamp || payload?.updated_at);

    if (shipmentId && currentStatus && occurredAt) {
        return `shiprocket:${shipmentId}:${currentStatus}:${occurredAt}`;
    }

    return `shiprocket:${crypto.createHash('sha256').update(fingerprintSource).digest('hex')}`;
};

export {
    SHIPROCKET_SYNC_STATUS,
    buildShiprocketWebhookEventKey,
    createOrder,
    findOrdersByReference,
    getOrder,
    getPickupAddressStatus,
    mapLocalOrderToShiprocketPayload,
    normalizeShiprocketError,
    reconcileExistingShiprocketOrder,
    refreshOrderTracking,
    requestWithAuth,
    syncOrderToShiprocket,
    trackShipment
};
