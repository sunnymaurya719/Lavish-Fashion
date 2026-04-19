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
const VALID_SHIPROCKET_SYNC_STATUSES = new Set(Object.values(SHIPROCKET_SYNC_STATUS));
const SHIPROCKET_PRICING_FORMULA_VERSION = 2;

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
const normalizeShiprocketSyncStatusValue = (value) => {
    const normalizedValue = normalizeText(value).toLowerCase();
    return VALID_SHIPROCKET_SYNC_STATUSES.has(normalizedValue) ? normalizedValue : '';
};
const resolveEffectiveShiprocketSyncStatus = (order = {}) => {
    const explicitSyncStatus = normalizeShiprocketSyncStatusValue(order?.shiprocket?.syncStatus);

    if (explicitSyncStatus) {
        return explicitSyncStatus;
    }

    if (
        normalizeNumber(order?.shiprocket?.shipmentId) ||
        normalizeNumber(order?.shiprocket?.orderId) ||
        normalizeText(order?.shiprocket?.awbCode) ||
        normalizeNumber(order?.shiprocket?.syncedAt)
    ) {
        return SHIPROCKET_SYNC_STATUS.synced;
    }

    if (normalizeText(order?.shiprocket?.referenceOrderId)) {
        return normalizeText(order?.shiprocket?.lastError)
            ? SHIPROCKET_SYNC_STATUS.pendingRetry
            : SHIPROCKET_SYNC_STATUS.pending;
    }

    return SHIPROCKET_SYNC_STATUS.notRequired;
};
const calculateOrderItemsSubtotal = (items = []) =>
    roundCurrency(
        Array.isArray(items)
            ? items.reduce(
                (sum, item) =>
                    sum + Math.max(0, Number(item?.price || 0)) * Math.max(0, Number(item?.quantity || 0)),
                0
            )
            : 0
    );
const resolveShiprocketPricingContext = (order = {}) => {
    const shippingCharges = roundCurrency(order?.deliveryFee);
    const totalDiscount = roundCurrency(order?.discountAmount);
    const finalAmountValue = Number(order?.amount);
    const hasFinalAmount = Number.isFinite(finalAmountValue);
    const finalAmount = hasFinalAmount ? roundCurrency(finalAmountValue) : null;
    const storedSubtotalBeforeDiscount = roundCurrency(order?.subtotal);
    const derivedItemsSubtotal = calculateOrderItemsSubtotal(order?.items);
    const fallbackSubtotalBeforeDiscount =
        storedSubtotalBeforeDiscount > 0 ? storedSubtotalBeforeDiscount : derivedItemsSubtotal;
    const subtotalAfterDiscountFromBreakdown = roundCurrency(
        Math.max(0, fallbackSubtotalBeforeDiscount - totalDiscount)
    );
    const subTotal =
        finalAmount !== null
            ? roundCurrency(Math.max(0, finalAmount - shippingCharges))
            : subtotalAfterDiscountFromBreakdown;
    const expectedFinalAmountFromBreakdown = roundCurrency(subtotalAfterDiscountFromBreakdown + shippingCharges);

    return {
        subTotal,
        shippingCharges,
        totalDiscount,
        finalAmount,
        storedSubtotalBeforeDiscount,
        derivedItemsSubtotal,
        subtotalAfterDiscountFromBreakdown,
        breakdownAmountDelta:
            finalAmount === null ? null : roundCurrency(finalAmount - expectedFinalAmountFromBreakdown)
    };
};
const normalizeShiprocketPricingSnapshot = (snapshot) => {
    if (!isObject(snapshot) || Object.keys(snapshot).length === 0) {
        return null;
    }

    const normalizedFormulaVersion = Number(snapshot?.formulaVersion);
    const normalizedCapturedAt =
        snapshot?.capturedAt === null || snapshot?.capturedAt === undefined || snapshot?.capturedAt === ''
            ? null
            : normalizeNumber(snapshot?.capturedAt);
    const normalizedDerivedFinalAmount = Number(snapshot?.derivedFinalAmount);

    return {
        formulaVersion:
            Number.isFinite(normalizedFormulaVersion) && normalizedFormulaVersion > 0
                ? Math.floor(normalizedFormulaVersion)
                : SHIPROCKET_PRICING_FORMULA_VERSION,
        source: normalizeText(snapshot?.source),
        capturedAt: normalizedCapturedAt,
        itemsSubtotal: roundCurrency(Math.max(0, Number(snapshot?.itemsSubtotal || 0))),
        localSubtotal: roundCurrency(Math.max(0, Number(snapshot?.localSubtotal || 0))),
        totalDiscount: roundCurrency(Math.max(0, Number(snapshot?.totalDiscount || 0))),
        shippingCharges: roundCurrency(Math.max(0, Number(snapshot?.shippingCharges || 0))),
        subTotal: roundCurrency(Math.max(0, Number(snapshot?.subTotal || 0))),
        localAmount: roundCurrency(Math.max(0, Number(snapshot?.localAmount || 0))),
        derivedFinalAmount: roundCurrency(
            Math.max(
                0,
                Number.isFinite(normalizedDerivedFinalAmount)
                    ? normalizedDerivedFinalAmount
                    :
                    Number(snapshot?.subTotal || 0) + Number(snapshot?.shippingCharges || 0)
            )
        )
    };
};
const buildShiprocketPricingSnapshot = (order = {}, options = {}) => {
    const pricing = resolveShiprocketPricingContext(order);
    const capturedAt = normalizeNumber(options?.capturedAt);

    return normalizeShiprocketPricingSnapshot({
        formulaVersion: SHIPROCKET_PRICING_FORMULA_VERSION,
        source: normalizeText(options?.source || 'shiprocket_payload_v2'),
        capturedAt,
        itemsSubtotal: pricing.derivedItemsSubtotal,
        localSubtotal: pricing.storedSubtotalBeforeDiscount,
        totalDiscount: pricing.totalDiscount,
        shippingCharges: pricing.shippingCharges,
        subTotal: pricing.subTotal,
        localAmount:
            pricing.finalAmount !== null
                ? pricing.finalAmount
                : roundCurrency(pricing.subTotal + pricing.shippingCharges),
        derivedFinalAmount: roundCurrency(pricing.subTotal + pricing.shippingCharges)
    });
};
const pickFirstFiniteCurrency = (...values) => {
    for (const value of values) {
        if (value === null || value === undefined || value === '') {
            continue;
        }

        const parsedValue = Number(value);
        if (Number.isFinite(parsedValue)) {
            return roundCurrency(parsedValue);
        }
    }

    return null;
};
const calculateShiprocketProductSubtotal = (products = []) =>
    roundCurrency(
        Array.isArray(products)
            ? products.reduce((sum, product) => {
                const quantity = Math.max(0, Number(product?.quantity || product?.units || 0));
                const explicitLineTotal = pickFirstFiniteCurrency(product?.net_total, product?.total);
                const unitPrice = pickFirstFiniteCurrency(
                    product?.selling_price,
                    product?.price,
                    product?.cost,
                    quantity > 0 ? Number(product?.net_total || 0) / quantity : null
                );

                if (explicitLineTotal !== null) {
                    return sum + explicitLineTotal;
                }

                if (unitPrice !== null && quantity > 0) {
                    return sum + unitPrice * quantity;
                }

                return sum;
            }, 0)
            : 0
    );
const calculateShiprocketProductDiscount = (products = []) =>
    roundCurrency(
        Array.isArray(products)
            ? products.reduce((sum, product) => {
                const quantity = Math.max(0, Number(product?.quantity || product?.units || 0));
                const explicitDiscount = pickFirstFiniteCurrency(
                    product?.discount_including_tax,
                    product?.discount
                );

                if (explicitDiscount !== null) {
                    return sum + explicitDiscount * Math.max(1, quantity);
                }

                return sum;
            }, 0)
            : 0
    );
const extractShiprocketOrderRoot = (payload = {}) => {
    if (isObject(payload?.data)) {
        return payload.data;
    }

    return isObject(payload) ? payload : {};
};
const compareShiprocketPricingSnapshots = (baselineSnapshot, comparisonSnapshot) => {
    const baseline = normalizeShiprocketPricingSnapshot(baselineSnapshot);
    const comparison = normalizeShiprocketPricingSnapshot(comparisonSnapshot);

    if (!baseline || !comparison) {
        return null;
    }

    const deltas = {
        subTotalDelta: roundCurrency(comparison.subTotal - baseline.subTotal),
        shippingChargesDelta: roundCurrency(comparison.shippingCharges - baseline.shippingCharges),
        totalDiscountDelta: roundCurrency(comparison.totalDiscount - baseline.totalDiscount),
        derivedFinalAmountDelta: roundCurrency(comparison.derivedFinalAmount - baseline.derivedFinalAmount)
    };

    return {
        ...deltas,
        hasDifference: Object.values(deltas).some((delta) => Math.abs(Number(delta || 0)) > 0.01)
    };
};
const extractShiprocketOrderPricingSnapshot = (payload = {}, options = {}) => {
    const orderRoot = extractShiprocketOrderRoot(payload);

    if (!isObject(orderRoot) || Object.keys(orderRoot).length === 0) {
        return null;
    }

    const products = Array.isArray(orderRoot?.products) ? orderRoot.products : [];
    const itemsSubtotal = calculateShiprocketProductSubtotal(products);
    const productDiscount = calculateShiprocketProductDiscount(products);
    const shippingCharges = pickFirstFiniteCurrency(
        orderRoot?.others?.shipping_charges,
        orderRoot?.shipping_charges,
        orderRoot?.shipments?.cost
    );
    const giftwrapCharges = pickFirstFiniteCurrency(orderRoot?.giftwrap_charges);
    const transactionCharges = pickFirstFiniteCurrency(
        orderRoot?.transaction_charges,
        orderRoot?.others?.transaction_charges
    );
    const totalDiscount = pickFirstFiniteCurrency(
        orderRoot?.total_discount,
        orderRoot?.other_discounts,
        orderRoot?.discount,
        productDiscount
    );
    const derivedFinalAmount = pickFirstFiniteCurrency(
        orderRoot?.net_total,
        orderRoot?.total,
        orderRoot?.total_inr
    );
    const explicitSubTotal = pickFirstFiniteCurrency(orderRoot?.sub_total);
    const normalizedShippingCharges = shippingCharges ?? 0;
    const normalizedGiftwrapCharges = giftwrapCharges ?? 0;
    const normalizedTransactionCharges = transactionCharges ?? 0;
    const normalizedDerivedFinalAmount =
        derivedFinalAmount ??
        roundCurrency(
            Math.max(
                0,
                itemsSubtotal - Number(totalDiscount || 0) + normalizedShippingCharges + normalizedGiftwrapCharges + normalizedTransactionCharges
            )
        );
    const normalizedSubTotal =
        explicitSubTotal ??
        roundCurrency(
            Math.max(
                0,
                normalizedDerivedFinalAmount - normalizedShippingCharges - normalizedGiftwrapCharges - normalizedTransactionCharges
            )
        );

    return normalizeShiprocketPricingSnapshot({
        formulaVersion: SHIPROCKET_PRICING_FORMULA_VERSION,
        source: normalizeText(options?.source || 'shiprocket_live_order_details'),
        capturedAt: options?.capturedAt ?? Date.now(),
        itemsSubtotal,
        localSubtotal: itemsSubtotal,
        totalDiscount: totalDiscount ?? 0,
        shippingCharges: normalizedShippingCharges,
        subTotal: normalizedSubTotal,
        localAmount: normalizedDerivedFinalAmount,
        derivedFinalAmount: normalizedDerivedFinalAmount
    });
};
const buildShiprocketLivePricingVerification = (order = {}, shiprocketOrder = {}, options = {}) => {
    const checkedAt = normalizeNumber(options?.checkedAt) || Date.now();
    const expectedShiprocket = buildShiprocketPricingSnapshot(order, {
        source: 'computed_current',
        capturedAt: null
    });
    const liveShiprocketSnapshot =
        normalizeShiprocketPricingSnapshot(options?.liveShiprocketSnapshot) ||
        normalizeShiprocketPricingSnapshot(shiprocketOrder?.pricingSnapshot) ||
        extractShiprocketOrderPricingSnapshot(shiprocketOrder?.raw || shiprocketOrder, {
            source: 'shiprocket_live_order_details',
            capturedAt: checkedAt
        });
    const snapshotDelta = compareShiprocketPricingSnapshots(expectedShiprocket, liveShiprocketSnapshot);
    const issues = [];
    const addIssue = (code, severity, message) => {
        issues.push({
            code,
            severity,
            message: normalizeText(message)
        });
    };

    if (!liveShiprocketSnapshot) {
        addIssue(
            'shiprocket_live_pricing_unavailable',
            'warning',
            'Live Shiprocket order details did not expose enough pricing information to verify this order.'
        );
    }

    if (snapshotDelta?.hasDifference) {
        addIssue(
            'shiprocket_live_mismatch',
            'error',
            'Live Shiprocket order details differ from the current expected payload for this order.'
        );
    }

    const hasMismatch = issues.some((issue) => issue.severity === 'error');
    const hasWarning = issues.some((issue) => issue.severity === 'warning');

    return {
        checkedAt,
        status: hasMismatch ? 'mismatch' : hasWarning ? 'warning' : 'clear',
        hasMismatch,
        hasWarning,
        issueCount: issues.length,
        issueCodes: issues.map((issue) => issue.code),
        expectedShiprocket,
        liveShiprocketSnapshot: liveShiprocketSnapshot
            ? {
                ...liveShiprocketSnapshot,
                ...(snapshotDelta || {})
            }
            : null,
        issues,
        shiprocketOrder: {
            shiprocketOrderId: shiprocketOrder?.shiprocketOrderId ?? null,
            shipmentId: shiprocketOrder?.shipmentId ?? null,
            status: normalizeText(shiprocketOrder?.status),
            statusCode: shiprocketOrder?.statusCode ?? null
        }
    };
};
const isShiprocketOrderTrackedRemotely = (order = {}) =>
    Boolean(
        order?.shiprocket?.shipmentId ||
            order?.shiprocket?.orderId ||
            resolveEffectiveShiprocketSyncStatus(order) === SHIPROCKET_SYNC_STATUS.synced
    );
const buildShiprocketPricingAudit = (order = {}) => {
    const pricing = resolveShiprocketPricingContext(order);
    const expectedLocalAmount = roundCurrency(pricing.subtotalAfterDiscountFromBreakdown + pricing.shippingCharges);
    const expectedShiprocket = buildShiprocketPricingSnapshot(order, {
        source: 'computed_current',
        capturedAt: null
    });
    const storedShiprocketSnapshot = normalizeShiprocketPricingSnapshot(order?.shiprocket?.pricingSnapshot);
    const liveShiprocketSnapshot = normalizeShiprocketPricingSnapshot(order?.shiprocket?.livePricingSnapshot);
    const liveVerificationStatus = normalizeText(order?.shiprocket?.livePricingVerificationStatus) || 'not_verified';
    const liveVerificationError = normalizeText(order?.shiprocket?.livePricingVerificationError);
    const liveVerificationCheckedAt = normalizeNumber(order?.shiprocket?.livePricingVerifiedAt);
    const issues = [];
    const addIssue = (code, severity, message) => {
        issues.push({
            code,
            severity,
            message: normalizeText(message)
        });
    };

    if (pricing.finalAmount !== null && Math.abs(Number(pricing.breakdownAmountDelta || 0)) > 0.01) {
        addIssue(
            'local_breakdown_mismatch',
            'error',
            'Local order amount does not match subtotal + delivery fee - discount.'
        );
    }

    if (
        pricing.storedSubtotalBeforeDiscount > 0 &&
        pricing.derivedItemsSubtotal > 0 &&
        Math.abs(pricing.storedSubtotalBeforeDiscount - pricing.derivedItemsSubtotal) > 0.01
    ) {
        addIssue(
            'subtotal_item_snapshot_mismatch',
            'warning',
            'Stored subtotal differs from the summed order item snapshot.'
        );
    }

    if (isShiprocketOrderTrackedRemotely(order) && !storedShiprocketSnapshot) {
        addIssue(
            'missing_shiprocket_pricing_snapshot',
            'warning',
            'This Shiprocket-synced order has no persisted pricing snapshot, so the remote amount cannot be auto-verified.'
        );
    }

    const snapshotDelta = compareShiprocketPricingSnapshots(expectedShiprocket, storedShiprocketSnapshot);
    const liveSnapshotDelta = compareShiprocketPricingSnapshots(expectedShiprocket, liveShiprocketSnapshot);

    if (snapshotDelta?.hasDifference) {
        addIssue(
            'shiprocket_snapshot_mismatch',
            'error',
            'The last Shiprocket pricing snapshot does not match the current expected payload for this order.'
        );
    }

    if (liveVerificationStatus === 'failed' && liveVerificationError) {
        addIssue(
            'shiprocket_live_verification_failed',
            'warning',
            `Live Shiprocket verification failed: ${liveVerificationError}`
        );
    }

    if (liveSnapshotDelta?.hasDifference) {
        addIssue(
            'shiprocket_live_mismatch',
            'error',
            'Live Shiprocket order details currently differ from the expected payload for this order.'
        );
    }

    const hasMismatch = issues.some((issue) => issue.severity === 'error');
    const hasWarning = issues.some((issue) => issue.severity === 'warning');

    return {
        status: hasMismatch ? 'mismatch' : hasWarning ? 'warning' : 'clear',
        hasMismatch,
        hasWarning,
        issueCount: issues.length,
        issueCodes: issues.map((issue) => issue.code),
        syncStatus: resolveEffectiveShiprocketSyncStatus(order),
        remoteVerificationAvailable: Boolean(storedShiprocketSnapshot),
        remoteOrderTracked: isShiprocketOrderTrackedRemotely(order),
        referenceAssigned: Boolean(normalizeText(order?.shiprocket?.referenceOrderId)),
        local: {
            amount: pricing.finalAmount,
            expectedAmount: expectedLocalAmount,
            amountDelta: pricing.finalAmount === null ? null : roundCurrency(pricing.finalAmount - expectedLocalAmount),
            storedSubtotal: pricing.storedSubtotalBeforeDiscount,
            itemsSubtotal: pricing.derivedItemsSubtotal,
            shippingCharges: pricing.shippingCharges,
            discountAmount: pricing.totalDiscount
        },
        expectedShiprocket,
        storedShiprocketSnapshot: storedShiprocketSnapshot
            ? {
                ...storedShiprocketSnapshot,
                ...(snapshotDelta || {})
            }
            : null,
        liveVerification: {
            status: liveVerificationStatus,
            available: Boolean(liveShiprocketSnapshot),
            verifiedAt: liveVerificationCheckedAt,
            error: liveVerificationError,
            snapshot: liveShiprocketSnapshot
                ? {
                    ...liveShiprocketSnapshot,
                    ...(liveSnapshotDelta || {})
                }
                : null
        },
        issues
    };
};
const decorateOrderWithShiprocketPricingAudit = (order) => {
    if (!order) {
        return null;
    }

    const plainOrder =
        typeof order?.toObject === 'function'
            ? order.toObject()
            : isObject(order)
                ? { ...order }
                : null;

    if (!plainOrder) {
        return null;
    }

    return {
        ...plainOrder,
        shiprocketPricingAudit: buildShiprocketPricingAudit(plainOrder)
    };
};
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
    const upstreamHeaders = isObject(error?.response?.headers) ? error.response.headers : null;
    const upstreamMessage = normalizeText(
        upstreamPayload?.message ||
            upstreamPayload?.error ||
            upstreamPayload?.detail ||
            upstreamPayload?.status ||
            error?.message
    );
    const normalizedError = new Error(upstreamMessage || fallbackMessage);
    const retryAfterHeaderValue =
        upstreamHeaders?.['retry-after'] ??
        upstreamHeaders?.['Retry-After'] ??
        upstreamPayload?.retry_after ??
        upstreamPayload?.data?.retry_after;
    const parsedRetryAfterNumber = Number(retryAfterHeaderValue);
    const parsedRetryAfterDateMs =
        typeof retryAfterHeaderValue === 'string' && retryAfterHeaderValue
            ? new Date(retryAfterHeaderValue).getTime()
            : Number.NaN;
    const retryAfterMs = Number.isFinite(parsedRetryAfterNumber) && parsedRetryAfterNumber > 0
        ? parsedRetryAfterNumber * 1000
        : Number.isFinite(parsedRetryAfterDateMs)
          ? Math.max(0, parsedRetryAfterDateMs - Date.now())
          : 0;
    const normalizedMessage = upstreamMessage.toLowerCase();
    const isThrottleError =
        upstreamStatusCode === 429 ||
        ((upstreamStatusCode === 503 || upstreamStatusCode === 502) &&
            (normalizedMessage.includes('rate limit') ||
                normalizedMessage.includes('too many request') ||
                normalizedMessage.includes('too many requests') ||
                normalizedMessage.includes('throttle')));

    normalizedError.name = 'ShiprocketRequestError';
    normalizedError.statusCode = upstreamStatusCode >= 400 && upstreamStatusCode < 500 ? 502 : 502;
    normalizedError.upstreamStatusCode = upstreamStatusCode || null;
    normalizedError.upstreamPayload = upstreamPayload || null;
    normalizedError.upstreamHeaders = upstreamHeaders;
    normalizedError.code = error?.code || '';
    normalizedError.request = error?.request || null;
    normalizedError.retryAfterMs = retryAfterMs;
    normalizedError.isThrottleError = isThrottleError;

    return normalizedError;
};

const isShiprocketThrottleError = (error) => Boolean(error?.isThrottleError || Number(error?.upstreamStatusCode || 0) === 429);

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
        pricingSnapshot: extractShiprocketOrderPricingSnapshot(payload, {
            source: 'shiprocket_live_order_details',
            capturedAt: null
        }),
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
    const pricing = resolveShiprocketPricingContext(order);
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
        shipping_charges: pricing.shippingCharges,
        giftwrap_charges: 0,
        transaction_charges: 0,
        total_discount: pricing.totalDiscount,
        sub_total: pricing.subTotal,
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
    orderItemsCount: Array.isArray(orderData?.order_items) ? orderData.order_items.length : 0,
    shippingCharges: roundCurrency(orderData?.shipping_charges),
    totalDiscount: roundCurrency(orderData?.total_discount),
    subTotal: roundCurrency(orderData?.sub_total),
    orderItemsSubtotal: roundCurrency(
        Array.isArray(orderData?.order_items)
            ? orderData.order_items.reduce(
                (sum, item) =>
                    sum +
                    Math.max(0, Number(item?.selling_price || 0)) * Math.max(0, Number(item?.units || 0)),
                0
            )
            : 0
    ),
    derivedFinalAmount: roundCurrency(
        Number(orderData?.sub_total || 0) +
            Number(orderData?.shipping_charges || 0) +
            Number(orderData?.giftwrap_charges || 0) +
            Number(orderData?.transaction_charges || 0)
    )
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
    pricingSnapshot = null,
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
    'shiprocket.pricingSnapshot':
        normalizeShiprocketPricingSnapshot(pricingSnapshot) ||
        normalizeShiprocketPricingSnapshot(existingShiprocket?.pricingSnapshot),
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
        const pricingContext = resolveShiprocketPricingContext(currentOrder);
        const pricingSnapshot = buildShiprocketPricingSnapshot(currentOrder, {
            capturedAt: Date.now(),
            source: 'shiprocket_payload_v2'
        });
        if (Math.abs(Number(pricingContext.breakdownAmountDelta || 0)) > 0.01) {
            shiprocketLog.warn(
                {
                    finalAmount: pricingContext.finalAmount,
                    storedSubtotalBeforeDiscount: pricingContext.storedSubtotalBeforeDiscount,
                    derivedItemsSubtotal: pricingContext.derivedItemsSubtotal,
                    totalDiscount: pricingContext.totalDiscount,
                    shippingCharges: pricingContext.shippingCharges,
                    subtotalAfterDiscountFromBreakdown: pricingContext.subtotalAfterDiscountFromBreakdown,
                    breakdownAmountDelta: pricingContext.breakdownAmountDelta
                },
                'Order pricing fields do not reconcile cleanly; Shiprocket payload will use the final order amount split by charges'
            );
        }

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
            status: SHIPROCKET_SYNC_STATUS.synced,
            pricingSnapshot
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

const verifyOrderPricingAgainstLiveShiprocket = async (localOrder, options = {}) => {
    const orderId = normalizeText(localOrder?._id);
    const verificationLog = buildShiprocketLogger({
        log: options.log,
        action: 'verify_live_pricing',
        orderId
    });

    if (!orderId) {
        const error = new Error('Local order id is required to verify Shiprocket pricing');
        error.statusCode = 500;
        throw error;
    }

    const currentOrder = await orderModel.findById(orderId).lean();
    if (!currentOrder) {
        const error = new Error('Order not found for Shiprocket pricing verification');
        error.statusCode = 404;
        throw error;
    }

    if (!normalizeNumber(currentOrder?.shiprocket?.orderId)) {
        const error = new Error('Shiprocket order id is not available for live pricing verification');
        error.statusCode = 400;
        throw error;
    }

    const persistResult = options.persist !== false;
    const checkedAt = Date.now();

    try {
        const shiprocketOrder = await getOrder(currentOrder.shiprocket.orderId, {
            log: verificationLog
        });
        const verification = buildShiprocketLivePricingVerification(currentOrder, shiprocketOrder, {
            checkedAt
        });

        let updatedOrder = currentOrder;

        if (persistResult) {
            updatedOrder = await orderModel.findByIdAndUpdate(
                orderId,
                {
                    $set: {
                        'shiprocket.livePricingSnapshot': normalizeShiprocketPricingSnapshot(
                            verification.liveShiprocketSnapshot
                        ),
                        'shiprocket.livePricingVerifiedAt': verification.checkedAt,
                        'shiprocket.livePricingVerificationStatus': verification.status,
                        'shiprocket.livePricingVerificationError': ''
                    }
                },
                { new: true }
            );
        }

        return {
            ...verification,
            order: updatedOrder
        };
    } catch (error) {
        if (persistResult) {
            await orderModel.findByIdAndUpdate(orderId, {
                $set: {
                    'shiprocket.livePricingVerifiedAt': checkedAt,
                    'shiprocket.livePricingVerificationStatus': 'failed',
                    'shiprocket.livePricingVerificationError': truncateText(
                        error?.message || 'Live Shiprocket pricing verification failed'
                    )
                }
            });
        }

        throw error;
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
    const awbCode = normalizeText(payload?.awb_code || payload?.awb || payload?.data?.awb_code);
    const referenceOrderId = normalizeText(
        payload?.channel_order_id ||
            payload?.reference_order_id ||
            payload?.order_number ||
            payload?.data?.channel_order_id
    );
    const currentStatus = normalizeText(payload?.current_status || payload?.data?.current_status);
    const occurredAt = normalizeText(payload?.event_time || payload?.timestamp || payload?.updated_at);

    if (shipmentId && currentStatus && occurredAt) {
        return `shiprocket:${shipmentId}:${currentStatus}:${occurredAt}`;
    }

    if (awbCode && currentStatus && occurredAt) {
        return `shiprocket:${awbCode}:${currentStatus}:${occurredAt}`;
    }

    if (referenceOrderId && currentStatus && occurredAt) {
        return `shiprocket:${referenceOrderId}:${currentStatus}:${occurredAt}`;
    }

    return `shiprocket:${crypto.createHash('sha256').update(fingerprintSource).digest('hex')}`;
};

export {
    SHIPROCKET_SYNC_STATUS,
    buildShiprocketLivePricingVerification,
    buildShiprocketPricingAudit,
    buildShiprocketPricingSnapshot,
    buildShiprocketWebhookEventKey,
    createOrder,
    decorateOrderWithShiprocketPricingAudit,
    extractShiprocketOrderPricingSnapshot,
    findOrdersByReference,
    getOrder,
    getPickupAddressStatus,
    isShiprocketThrottleError,
    mapLocalOrderToShiprocketPayload,
    normalizeShiprocketError,
    normalizeShiprocketSyncStatusValue,
    reconcileExistingShiprocketOrder,
    refreshOrderTracking,
    resolveEffectiveShiprocketSyncStatus,
    requestWithAuth,
    syncOrderToShiprocket,
    trackShipment,
    verifyOrderPricingAgainstLiveShiprocket
};
