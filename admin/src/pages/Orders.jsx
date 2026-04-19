import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';
import { createAdminOrderRealtimeClient } from '../services/realtimeClient';
import { mergeOrderSnapshot, upsertOrderById } from '../utils/orderMerge';

const orderStatusOptions = ['Order Placed', 'Packing', 'Shipped', 'Out for delivery', 'Delivered', 'Cancelled'];
const ORDER_API_BASE = `${BACKEND_URL}/api/order`;
const ORDER_API_BASE_CANDIDATES = Array.from(new Set([ORDER_API_BASE, `${BACKEND_URL}/api/orders`]));
const VALID_SHIPROCKET_SYNC_STATUSES = new Set(['not_required', 'pending', 'synced', 'pending_retry', 'failed']);
const SHIPROCKET_PRICING_FORMULA_VERSION = 2;
const LIVE_VERIFICATION_ISSUE_CODES = new Set([
  'shiprocket_live_verification_failed',
  'shiprocket_live_pricing_unavailable',
  'shiprocket_live_mismatch',
]);

const roundCurrencyValue = (value) => Number(Number(value || 0).toFixed(2));
const normalizeNumericValue = (value) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
};
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isRouteNotFoundError = (error) =>
  Number(error?.response?.status || 0) === 404 && /route not found/i.test(String(error?.response?.data?.message || ''));
const pickFirstFiniteCurrencyValue = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === '') {
      continue;
    }

    const parsedValue = Number(value);
    if (Number.isFinite(parsedValue)) {
      return roundCurrencyValue(parsedValue);
    }
  }

  return null;
};

const requestOrderApiWithFallback = async (method, path, { data, token } = {}) => {
  let lastRouteNotFoundError = null;

  for (const baseUrl of ORDER_API_BASE_CANDIDATES) {
    try {
      return await axios({
        method,
        url: `${baseUrl}${path}`,
        data,
        headers: token ? { token } : undefined,
      });
    } catch (error) {
      if (isRouteNotFoundError(error)) {
        lastRouteNotFoundError = error;
        continue;
      }

      throw error;
    }
  }

  if (lastRouteNotFoundError) {
    throw lastRouteNotFoundError;
  }

  throw new Error(`Request failed for ${method.toUpperCase()} ${path}`);
};

const normalizeAuditPricingSnapshot = (snapshot) => {
  if (!isPlainObject(snapshot) || Object.keys(snapshot).length === 0) {
    return null;
  }

  const normalizedFormulaVersion = Number(snapshot?.formulaVersion);
  const normalizedCapturedAt =
    snapshot?.capturedAt === null || snapshot?.capturedAt === undefined || snapshot?.capturedAt === ''
      ? null
      : normalizeNumericValue(snapshot?.capturedAt);
  const normalizedDerivedFinalAmount = Number(snapshot?.derivedFinalAmount);

  return {
    formulaVersion:
      Number.isFinite(normalizedFormulaVersion) && normalizedFormulaVersion > 0
        ? Math.floor(normalizedFormulaVersion)
        : SHIPROCKET_PRICING_FORMULA_VERSION,
    source: String(snapshot?.source || '').trim(),
    capturedAt: normalizedCapturedAt,
    itemsSubtotal: roundCurrencyValue(Math.max(0, Number(snapshot?.itemsSubtotal || 0))),
    localSubtotal: roundCurrencyValue(Math.max(0, Number(snapshot?.localSubtotal || 0))),
    totalDiscount: roundCurrencyValue(Math.max(0, Number(snapshot?.totalDiscount || 0))),
    shippingCharges: roundCurrencyValue(Math.max(0, Number(snapshot?.shippingCharges || 0))),
    subTotal: roundCurrencyValue(Math.max(0, Number(snapshot?.subTotal || 0))),
    localAmount: roundCurrencyValue(Math.max(0, Number(snapshot?.localAmount || 0))),
    derivedFinalAmount: roundCurrencyValue(
      Math.max(
        0,
        Number.isFinite(normalizedDerivedFinalAmount)
          ? normalizedDerivedFinalAmount
          : Number(snapshot?.subTotal || 0) + Number(snapshot?.shippingCharges || 0)
      )
    ),
  };
};

const buildExpectedShiprocketPricingSnapshot = (order = {}) => {
  const itemsSubtotal = Array.isArray(order?.items)
    ? roundCurrencyValue(
        order.items.reduce(
          (sum, item) => sum + Math.max(0, Number(item?.price || 0)) * Math.max(0, Number(item?.quantity || 0)),
          0
        )
      )
    : 0;
  const storedSubtotalBeforeDiscount = roundCurrencyValue(Math.max(0, Number(order?.subtotal || 0)));
  const totalDiscount = roundCurrencyValue(Math.max(0, Number(order?.discountAmount || 0)));
  const shippingCharges = roundCurrencyValue(Math.max(0, Number(order?.deliveryFee || 0)));
  const finalAmountValue = Number(order?.amount);
  const hasFinalAmount = Number.isFinite(finalAmountValue);
  const finalAmount = hasFinalAmount ? roundCurrencyValue(finalAmountValue) : null;
  const fallbackSubtotalBeforeDiscount = storedSubtotalBeforeDiscount > 0 ? storedSubtotalBeforeDiscount : itemsSubtotal;
  const subTotal =
    finalAmount !== null
      ? roundCurrencyValue(Math.max(0, finalAmount - shippingCharges))
      : roundCurrencyValue(Math.max(0, fallbackSubtotalBeforeDiscount - totalDiscount));

  return normalizeAuditPricingSnapshot({
    formulaVersion: SHIPROCKET_PRICING_FORMULA_VERSION,
    source: 'client_shiprocket_fallback_expected',
    capturedAt: null,
    itemsSubtotal,
    localSubtotal: storedSubtotalBeforeDiscount,
    totalDiscount,
    shippingCharges,
    subTotal,
    localAmount: finalAmount !== null ? finalAmount : roundCurrencyValue(subTotal + shippingCharges),
    derivedFinalAmount: roundCurrencyValue(subTotal + shippingCharges),
  });
};

const calculateShiprocketProductsSubtotal = (products = []) =>
  roundCurrencyValue(
    Array.isArray(products)
      ? products.reduce((sum, product) => {
          const quantity = Math.max(0, Number(product?.quantity || product?.units || 0));
          const explicitLineTotal = pickFirstFiniteCurrencyValue(product?.net_total, product?.total);
          const unitPrice = pickFirstFiniteCurrencyValue(
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

const calculateShiprocketProductsDiscount = (products = []) =>
  roundCurrencyValue(
    Array.isArray(products)
      ? products.reduce((sum, product) => {
          const quantity = Math.max(0, Number(product?.quantity || product?.units || 0));
          const explicitDiscount = pickFirstFiniteCurrencyValue(product?.discount_including_tax, product?.discount);

          if (explicitDiscount !== null) {
            return sum + explicitDiscount * Math.max(1, quantity);
          }

          return sum;
        }, 0)
      : 0
  );

const extractShiprocketOrderRoot = (payload = {}) => {
  if (isPlainObject(payload?.data)) {
    return payload.data;
  }

  return isPlainObject(payload) ? payload : {};
};

const extractShiprocketLivePricingSnapshot = (payload = {}, checkedAt = Date.now()) => {
  const orderRoot = extractShiprocketOrderRoot(payload);

  if (!isPlainObject(orderRoot) || Object.keys(orderRoot).length === 0) {
    return null;
  }

  const products = Array.isArray(orderRoot?.products) ? orderRoot.products : [];
  const itemsSubtotal = calculateShiprocketProductsSubtotal(products);
  const productDiscount = calculateShiprocketProductsDiscount(products);
  const shippingCharges = pickFirstFiniteCurrencyValue(
    orderRoot?.others?.shipping_charges,
    orderRoot?.shipping_charges,
    orderRoot?.shipments?.cost
  );
  const giftwrapCharges = pickFirstFiniteCurrencyValue(orderRoot?.giftwrap_charges);
  const transactionCharges = pickFirstFiniteCurrencyValue(
    orderRoot?.transaction_charges,
    orderRoot?.others?.transaction_charges
  );
  const totalDiscount = pickFirstFiniteCurrencyValue(
    orderRoot?.total_discount,
    orderRoot?.other_discounts,
    orderRoot?.discount,
    productDiscount
  );
  const derivedFinalAmount = pickFirstFiniteCurrencyValue(orderRoot?.net_total, orderRoot?.total, orderRoot?.total_inr);
  const explicitSubTotal = pickFirstFiniteCurrencyValue(orderRoot?.sub_total);
  const normalizedShippingCharges = shippingCharges ?? 0;
  const normalizedGiftwrapCharges = giftwrapCharges ?? 0;
  const normalizedTransactionCharges = transactionCharges ?? 0;
  const normalizedDerivedFinalAmount =
    derivedFinalAmount ??
    roundCurrencyValue(
      Math.max(
        0,
        itemsSubtotal -
          Number(totalDiscount || 0) +
          normalizedShippingCharges +
          normalizedGiftwrapCharges +
          normalizedTransactionCharges
      )
    );
  const normalizedSubTotal =
    explicitSubTotal ??
    roundCurrencyValue(
      Math.max(
        0,
        normalizedDerivedFinalAmount - normalizedShippingCharges - normalizedGiftwrapCharges - normalizedTransactionCharges
      )
    );

  return normalizeAuditPricingSnapshot({
    formulaVersion: SHIPROCKET_PRICING_FORMULA_VERSION,
    source: 'shiprocket_live_order_details_fallback',
    capturedAt: checkedAt,
    itemsSubtotal,
    localSubtotal: itemsSubtotal,
    totalDiscount: totalDiscount ?? 0,
    shippingCharges: normalizedShippingCharges,
    subTotal: normalizedSubTotal,
    localAmount: normalizedDerivedFinalAmount,
    derivedFinalAmount: normalizedDerivedFinalAmount,
  });
};

const compareAuditPricingSnapshots = (baselineSnapshot, comparisonSnapshot) => {
  const baseline = normalizeAuditPricingSnapshot(baselineSnapshot);
  const comparison = normalizeAuditPricingSnapshot(comparisonSnapshot);

  if (!baseline || !comparison) {
    return null;
  }

  const deltas = {
    subTotalDelta: roundCurrencyValue(comparison.subTotal - baseline.subTotal),
    shippingChargesDelta: roundCurrencyValue(comparison.shippingCharges - baseline.shippingCharges),
    totalDiscountDelta: roundCurrencyValue(comparison.totalDiscount - baseline.totalDiscount),
    derivedFinalAmountDelta: roundCurrencyValue(comparison.derivedFinalAmount - baseline.derivedFinalAmount),
  };

  return {
    ...deltas,
    hasDifference: Object.values(deltas).some((delta) => Math.abs(Number(delta || 0)) > 0.01),
  };
};

const buildClientSideShiprocketLiveVerification = (order = {}, shiprocketOrder = {}) => {
  const checkedAt = Date.now();
  const expectedShiprocket = buildExpectedShiprocketPricingSnapshot(order);
  const liveShiprocketSnapshot =
    normalizeAuditPricingSnapshot(shiprocketOrder?.pricingSnapshot) ||
    extractShiprocketLivePricingSnapshot(shiprocketOrder?.raw || shiprocketOrder, checkedAt);
  const snapshotDelta = compareAuditPricingSnapshots(expectedShiprocket, liveShiprocketSnapshot);
  const issues = [];

  if (!liveShiprocketSnapshot) {
    issues.push({
      code: 'shiprocket_live_pricing_unavailable',
      severity: 'warning',
      message: 'Live Shiprocket order details did not expose enough pricing information to verify this order.',
    });
  }

  if (snapshotDelta?.hasDifference) {
    issues.push({
      code: 'shiprocket_live_mismatch',
      severity: 'error',
      message: 'Live Shiprocket order details differ from the current expected payload for this order.',
    });
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
          ...(snapshotDelta || {}),
        }
      : null,
    issues,
  };
};

const applyClientSideShiprocketLiveVerification = (order = {}, shiprocketOrder = {}) => {
  const currentAudit = resolveOrderShiprocketAudit(order);
  const verification = buildClientSideShiprocketLiveVerification(order, shiprocketOrder);
  const existingIssues = Array.isArray(currentAudit?.issues)
    ? currentAudit.issues.filter((issue) => !LIVE_VERIFICATION_ISSUE_CODES.has(String(issue?.code || '').trim()))
    : [];
  const mergedIssues = [...existingIssues, ...verification.issues];
  const mergedIssueCodes = mergedIssues.map((issue) => issue.code).filter(Boolean);
  const hasMismatch = mergedIssues.some((issue) => issue.severity === 'error');
  const hasWarning = mergedIssues.some((issue) => issue.severity !== 'error');
  const liveVerificationError =
    verification.liveShiprocketSnapshot || verification.issues.length === 0
      ? ''
      : verification.issues.map((issue) => issue.message).join(' ');

  return {
    ...order,
    shiprocket: {
      ...(order?.shiprocket || {}),
      livePricingSnapshot: verification.liveShiprocketSnapshot,
      livePricingVerifiedAt: verification.checkedAt,
      livePricingVerificationStatus: verification.status,
      livePricingVerificationError: liveVerificationError,
    },
    shiprocketPricingAudit: {
      ...currentAudit,
      status: hasMismatch ? 'mismatch' : hasWarning ? 'warning' : 'clear',
      hasMismatch,
      hasWarning,
      issueCount: mergedIssues.length,
      issueCodes: mergedIssueCodes,
      expectedShiprocket: verification.expectedShiprocket || currentAudit.expectedShiprocket,
      liveVerification: {
        status: verification.status,
        available: Boolean(verification.liveShiprocketSnapshot),
        verifiedAt: verification.checkedAt,
        error: liveVerificationError,
        snapshot: verification.liveShiprocketSnapshot,
      },
      issues: mergedIssues,
    },
  };
};

const getAvailableStatusOptions = (order) => {
  if (order?.status === 'Cancelled') {
    return ['Cancelled'];
  }

  if (order?.status === 'Delivered') {
    return orderStatusOptions.filter((status) => status !== 'Cancelled');
  }

  return orderStatusOptions;
};

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const formatDate = (value) =>
  new Date(value).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const formatDateTime = (value) => {
  if (!value) {
    return 'Not captured';
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Not captured';
  }

  return parsedDate.toLocaleString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getItemImageUrl = (item) => {
  if (Array.isArray(item?.image) && item.image.length > 0) {
    return item.image[0];
  }

  if (typeof item?.image === 'string') {
    return item.image;
  }

  return '';
};

const getPaymentLabel = (order) => {
  if (String(order.paymentStatus || '').trim().toLowerCase() === 'cancelled' || order.status === 'Cancelled') {
    return order.payment ? 'Refund pending' : 'Cancelled';
  }

  if (order.payment) {
    return 'Paid';
  }

  if (order.paymentMethod === 'COD') {
    return 'Pending on delivery';
  }

  return 'Pending';
};

const getStatusClasses = (status) => {
  if (status === 'Cancelled') {
    return 'bg-rose-100 text-rose-800';
  }

  if (status === 'Delivered') {
    return 'bg-emerald-100 text-emerald-800';
  }

  if (status === 'Out for delivery' || status === 'Shipped') {
    return 'bg-sky-100 text-sky-800';
  }

  if (status === 'Packing') {
    return 'bg-amber-100 text-amber-800';
  }

  return 'bg-slate-200 text-slate-700';
};

const formatEnumLabel = (value, fallback = 'Unknown') => {
  const normalizedValue = String(value || '').trim();

  if (!normalizedValue) {
    return fallback;
  }

  return normalizedValue
    .split('_')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
};

const normalizeShiprocketSyncStatusValue = (value) => {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return VALID_SHIPROCKET_SYNC_STATUSES.has(normalizedValue) ? normalizedValue : '';
};

const resolveOrderShiprocketSyncStatus = (order = {}, audit = {}) => {
  const auditSyncStatus = normalizeShiprocketSyncStatusValue(audit?.syncStatus);

  if (auditSyncStatus) {
    return auditSyncStatus;
  }

  const rawSyncStatus = normalizeShiprocketSyncStatusValue(order?.shiprocket?.syncStatus);

  if (rawSyncStatus) {
    return rawSyncStatus;
  }

  if (
    Number(order?.shiprocket?.shipmentId || 0) > 0 ||
    Number(order?.shiprocket?.orderId || 0) > 0 ||
    String(order?.shiprocket?.awbCode || '').trim() ||
    Number(order?.shiprocket?.syncedAt || 0) > 0
  ) {
    return 'synced';
  }

  if (String(order?.shiprocket?.referenceOrderId || '').trim()) {
    return String(order?.shiprocket?.lastError || '').trim() ? 'pending_retry' : 'pending';
  }

  return 'not_required';
};

const buildFallbackShiprocketAudit = (order = {}) => {
  const itemsSubtotal = Array.isArray(order?.items)
    ? order.items.reduce(
        (sum, item) => sum + Math.max(0, Number(item?.price || 0)) * Math.max(0, Number(item?.quantity || 0)),
        0
      )
    : 0;
  const storedSubtotal = Number(order?.subtotal || 0);
  const shippingCharges = Math.max(0, Number(order?.deliveryFee || 0));
  const totalDiscount = Math.max(0, Number(order?.discountAmount || 0));
  const finalAmount = Math.max(0, Number(order?.amount || 0));
  const fallbackSubtotal = storedSubtotal > 0 ? storedSubtotal : itemsSubtotal;
  const derivedSubTotal =
    finalAmount > 0 || shippingCharges > 0 ? Math.max(0, finalAmount - shippingCharges) : Math.max(0, fallbackSubtotal - totalDiscount);
  const syncStatus = resolveOrderShiprocketSyncStatus(order);
  const remoteOrderTracked =
    syncStatus === 'synced' ||
    Number(order?.shiprocket?.shipmentId || 0) > 0 ||
    Number(order?.shiprocket?.orderId || 0) > 0 ||
    Boolean(String(order?.shiprocket?.awbCode || '').trim());
  const storedShiprocketSnapshot = order?.shiprocket?.pricingSnapshot || null;
  const liveShiprocketSnapshot = order?.shiprocket?.livePricingSnapshot || null;
  const liveVerificationStatus = String(order?.shiprocket?.livePricingVerificationStatus || '').trim() || 'not_verified';
  const issueCodes = [];

  if (remoteOrderTracked && !storedShiprocketSnapshot) {
    issueCodes.push('missing_shiprocket_pricing_snapshot');
  }

  if (liveVerificationStatus === 'failed' && String(order?.shiprocket?.livePricingVerificationError || '').trim()) {
    issueCodes.push('shiprocket_live_verification_failed');
  }

  return {
    status: issueCodes.length > 0 ? 'warning' : 'clear',
    hasMismatch: false,
    hasWarning: issueCodes.length > 0,
    issueCount: issueCodes.length,
    issueCodes,
    syncStatus,
    referenceAssigned: Boolean(String(order?.shiprocket?.referenceOrderId || '').trim()),
    remoteOrderTracked,
    expectedShiprocket: {
      subTotal: derivedSubTotal,
      shippingCharges,
      totalDiscount,
      derivedFinalAmount: finalAmount > 0 ? finalAmount : derivedSubTotal + shippingCharges,
    },
    storedShiprocketSnapshot,
    liveVerification: {
      status: liveVerificationStatus,
      available: Boolean(liveShiprocketSnapshot),
      verifiedAt: order?.shiprocket?.livePricingVerifiedAt || null,
      error: order?.shiprocket?.livePricingVerificationError || '',
      snapshot: liveShiprocketSnapshot,
    },
    local: {
      amount: finalAmount,
      expectedAmount: Math.max(0, fallbackSubtotal - totalDiscount + shippingCharges),
      amountDelta: finalAmount - Math.max(0, fallbackSubtotal - totalDiscount + shippingCharges),
      storedSubtotal,
      itemsSubtotal,
      shippingCharges,
      discountAmount: totalDiscount,
    },
    issues: issueCodes.map((code) => ({
      code,
      severity: 'warning',
      message:
        code === 'missing_shiprocket_pricing_snapshot'
          ? 'This Shiprocket-linked order has no persisted pricing snapshot, so the remote amount cannot be auto-verified.'
          : 'Live Shiprocket verification failed for this order.',
    })),
  };
};

const resolveOrderShiprocketAudit = (order = {}) => {
  const incomingAudit = order?.shiprocketPricingAudit;

  if (incomingAudit && typeof incomingAudit === 'object') {
    return {
      ...buildFallbackShiprocketAudit(order),
      ...incomingAudit,
      syncStatus: resolveOrderShiprocketSyncStatus(order, incomingAudit),
      referenceAssigned:
        typeof incomingAudit.referenceAssigned === 'boolean'
          ? incomingAudit.referenceAssigned
          : Boolean(String(order?.shiprocket?.referenceOrderId || '').trim()),
      remoteOrderTracked:
        typeof incomingAudit.remoteOrderTracked === 'boolean'
          ? incomingAudit.remoteOrderTracked
          : Boolean(
              Number(order?.shiprocket?.shipmentId || 0) > 0 ||
                Number(order?.shiprocket?.orderId || 0) > 0 ||
                String(order?.shiprocket?.awbCode || '').trim()
            ),
    };
  }

  return buildFallbackShiprocketAudit(order);
};

const getShiprocketAuditBadge = (audit = {}) => {
  if (audit?.status === 'mismatch') {
    return {
      label: 'Shiprocket mismatch',
      className: 'bg-rose-100 text-rose-800',
    };
  }

  if (audit?.status === 'warning') {
    return {
      label: 'Needs review',
      className: 'bg-amber-100 text-amber-800',
    };
  }

  if (audit?.syncStatus === 'synced') {
    return {
      label: 'Shiprocket verified',
      className: 'bg-emerald-100 text-emerald-800',
    };
  }

  if (audit?.syncStatus === 'pending_retry') {
    return {
      label: 'Sync retry',
      className: 'bg-amber-100 text-amber-800',
    };
  }

  if (audit?.syncStatus === 'pending') {
    return {
      label: 'Sync pending',
      className: 'bg-sky-100 text-sky-800',
    };
  }

  return {
    label: 'Not synced',
    className: 'bg-slate-100 text-slate-700',
  };
};

const getAuditIssueClasses = (severity) =>
  severity === 'error'
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : 'border-amber-200 bg-amber-50 text-amber-800';

const getShiprocketBulkVerifyJobBadge = (job = {}) => {
  if (job?.status === 'running' && job?.isCancelling) {
    return {
      label: 'Cancelling run',
      className: 'bg-amber-100 text-amber-800',
    };
  }

  if (job?.status === 'running') {
    return {
      label: job?.isStale ? 'Run stalled' : 'Run active',
      className: job?.isStale ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800',
    };
  }

  if (job?.status === 'cancelled') {
    return {
      label: 'Run cancelled',
      className: 'bg-slate-200 text-slate-800',
    };
  }

  if (job?.status === 'failed') {
    return {
      label: 'Run failed',
      className: 'bg-rose-100 text-rose-800',
    };
  }

  if (job?.status === 'completed') {
    return {
      label: 'Run complete',
      className: 'bg-emerald-100 text-emerald-800',
    };
  }

  if (job?.status === 'skipped') {
    return {
      label: 'Run skipped',
      className: 'bg-amber-100 text-amber-800',
    };
  }

  return {
    label: 'Run idle',
    className: 'bg-slate-100 text-slate-700',
  };
};

const realtimeEnabled = String(import.meta.env.VITE_REALTIME_ENABLED || 'true').trim().toLowerCase() !== 'false';

const Orders = ({ token }) => {
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [shiprocketAuditFilter, setShiprocketAuditFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isBackfillingSnapshots, setIsBackfillingSnapshots] = useState(false);
  const [isStartingBulkVerify, setIsStartingBulkVerify] = useState(false);
  const [isCancellingBulkVerify, setIsCancellingBulkVerify] = useState(false);
  const [shiprocketActionByOrderId, setShiprocketActionByOrderId] = useState({});
  const [shiprocketBulkVerifyConfig, setShiprocketBulkVerifyConfig] = useState({
    scope: 'high_risk',
    limit: '25',
    requestsPerMinute: '45',
  });
  const [shiprocketBulkVerifyJob, setShiprocketBulkVerifyJob] = useState(null);
  const [updatingOrderId, setUpdatingOrderId] = useState('');
  const [liveUpdatesStatus, setLiveUpdatesStatus] = useState({ status: 'idle', message: '' });
  const [highlightedOrderId, setHighlightedOrderId] = useState('');
  const processedEventIdsRef = useRef(new Set());
  const highlightTimerRef = useRef(null);
  const previousBulkVerifyStatusRef = useRef('');

  const fetchAllOrders = useCallback(async ({ silent = false } = {}) => {
    if (!token) {
      return;
    }

    if (!silent) {
      setIsLoading(true);
    }

    try {
      const response = await axios.post(`${ORDER_API_BASE}/list`, {}, { headers: { token } });

      if (response.data.success) {
        setOrders(mergeOrderSnapshot(response.data.orders || []));
        return;
      }

      if (!silent) {
        toast.error(response.data.message || 'Failed to fetch orders');
      }
    } catch (error) {
      if (!silent) {
        toast.error(error?.response?.data?.message || error.message);
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [token]);

  const statusHandler = async (event, orderId) => {
    setUpdatingOrderId(orderId);

    try {
      const response = await axios.post(
        `${ORDER_API_BASE}/status`,
        { orderId, status: event.target.value },
        { headers: { token } }
      );

      if (response.data.success) {
        toast.success('Order status updated');
        await fetchAllOrders({ silent: true });
        return;
      }

      toast.error(response.data.message || 'Failed to update order status');
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setUpdatingOrderId('');
    }
  };

  const setShiprocketActionState = useCallback((orderId, action) => {
    setShiprocketActionByOrderId((currentState) => {
      if (!action) {
        const nextState = { ...currentState };
        delete nextState[orderId];
        return nextState;
      }

      return {
        ...currentState,
        [orderId]: action,
      };
    });
  }, []);

  const setShiprocketBulkVerifyConfigField = useCallback((field, value) => {
    setShiprocketBulkVerifyConfig((currentConfig) => ({
      ...currentConfig,
      [field]: value,
    }));
  }, []);

  const fetchShiprocketBulkVerifyJob = useCallback(
    async ({ silent = false } = {}) => {
      if (!token) {
        return;
      }

      try {
        const response = await axios.get(`${ORDER_API_BASE}/shiprocket/live-verification-job`, {
          headers: { token },
        });

        if (response.data.success) {
          setShiprocketBulkVerifyJob(response.data.job || null);
          return;
        }

        if (!silent) {
          toast.error(response.data.message || 'Failed to load Shiprocket live verification status');
        }
      } catch (error) {
        if (!silent) {
          toast.error(
            error?.response?.data?.message || error.message || 'Failed to load Shiprocket live verification status'
          );
        }
      }
    },
    [token]
  );

  const handleShiprocketBackfill = useCallback(async () => {
    if (!token || isBackfillingSnapshots) {
      return;
    }

    setIsBackfillingSnapshots(true);

    try {
      const response = await axios.post(
        `${ORDER_API_BASE}/shiprocket/backfill-pricing-snapshots`,
        { limit: 200 },
        { headers: { token } }
      );

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to backfill Shiprocket pricing snapshots');
        return;
      }

      await fetchAllOrders({ silent: true });

      const updatedCount = Number(response.data.updatedCount || 0);
      const remainingCount = Number(response.data.remainingCount || 0);

      toast.success(
        updatedCount > 0
          ? `Backfilled ${updatedCount} Shiprocket pricing snapshot${updatedCount === 1 ? '' : 's'}${
              remainingCount > 0 ? `, ${remainingCount} still pending` : ''
            }`
          : response.data.message || 'No Shiprocket pricing snapshots needed backfill'
      );
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message || 'Failed to backfill Shiprocket pricing snapshots');
    } finally {
      setIsBackfillingSnapshots(false);
    }
  }, [fetchAllOrders, isBackfillingSnapshots, token]);

  const handleStartShiprocketBulkVerify = useCallback(async () => {
    if (!token || isStartingBulkVerify) {
      return;
    }

    setIsStartingBulkVerify(true);

    try {
      const parsedLimit = Number.parseInt(String(shiprocketBulkVerifyConfig.limit || '').trim(), 10);
      const parsedRequestsPerMinute = Number.parseInt(
        String(shiprocketBulkVerifyConfig.requestsPerMinute || '').trim(),
        10
      );
      const payload = {
        scope: shiprocketBulkVerifyConfig.scope || 'high_risk',
        limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
        requestsPerMinute: Number.isFinite(parsedRequestsPerMinute) ? parsedRequestsPerMinute : undefined,
      };
      const response = await axios.post(`${ORDER_API_BASE}/shiprocket/verify-live-bulk`, payload, {
        headers: { token },
      });

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to start Shiprocket bulk live verification');
        return;
      }

      setShiprocketBulkVerifyJob(response.data.job || null);

      if (response.data.started) {
        toast.success(
          `Bulk live verification started for ${Number(response.data.targetCount || 0)} Shiprocket order${
            Number(response.data.targetCount || 0) === 1 ? '' : 's'
          }`
        );
      } else {
        toast.info(response.data.message || 'Shiprocket bulk live verification is already running');
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message || 'Failed to start Shiprocket bulk live verification');
    } finally {
      setIsStartingBulkVerify(false);
    }
  }, [isStartingBulkVerify, shiprocketBulkVerifyConfig.limit, shiprocketBulkVerifyConfig.requestsPerMinute, shiprocketBulkVerifyConfig.scope, token]);

  const handleCancelShiprocketBulkVerify = useCallback(async () => {
    if (!token || isCancellingBulkVerify || shiprocketBulkVerifyJob?.status !== 'running') {
      return;
    }

    setIsCancellingBulkVerify(true);

    try {
      const response = await axios.post(
        `${ORDER_API_BASE}/shiprocket/verify-live-bulk/cancel`,
        {},
        { headers: { token } }
      );

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to cancel Shiprocket bulk live verification');
        return;
      }

      setShiprocketBulkVerifyJob(response.data.job || null);
      toast.info(response.data.message || 'Shiprocket bulk live verification cancellation requested');
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message || 'Failed to cancel Shiprocket bulk live verification');
    } finally {
      setIsCancellingBulkVerify(false);
    }
  }, [isCancellingBulkVerify, shiprocketBulkVerifyJob?.status, token]);

  const verifyShiprocketPricingLive = useCallback(
    async (orderId) => {
      if (!token || !orderId || shiprocketActionByOrderId[orderId]) {
        return;
      }

      setShiprocketActionState(orderId, 'verify_live');

      try {
        const response = await requestOrderApiWithFallback('post', `/${orderId}/shiprocket/verify-live`, {
          data: {},
          token,
        });

        if (!response.data.success) {
          toast.error(response.data.message || 'Failed to verify live Shiprocket pricing');
          return;
        }

        if (response.data.order?._id) {
          setOrders((currentOrders) => upsertOrderById(currentOrders, response.data.order));
        } else {
          await fetchAllOrders({ silent: true });
        }

        const verificationStatus = response.data.verification?.status;
        const message = response.data.message || 'Live Shiprocket pricing verification completed';

        if (verificationStatus === 'clear') {
          toast.success(message);
        } else if (verificationStatus === 'mismatch') {
          toast.warn(message);
        } else {
          toast.info(message);
        }
      } catch (error) {
        if (isRouteNotFoundError(error)) {
          try {
            const detailsResponse = await requestOrderApiWithFallback('get', `/${orderId}/shiprocket`, {
              token,
            });

            if (!detailsResponse.data.success) {
              toast.error(detailsResponse.data.message || 'Failed to verify live Shiprocket pricing');
              return;
            }

            const baseOrder =
              detailsResponse.data.order || orders.find((currentOrder) => String(currentOrder?._id || '') === String(orderId));

            if (!baseOrder) {
              toast.error('Order data is unavailable for Shiprocket live verification');
              return;
            }

            if (!detailsResponse.data.shiprocketOrder) {
              toast.info(detailsResponse.data.message || 'Shiprocket order details are not available yet for live verification');

              if (detailsResponse.data.order?._id) {
                setOrders((currentOrders) => upsertOrderById(currentOrders, detailsResponse.data.order));
              }

              return;
            }

            const locallyVerifiedOrder = applyClientSideShiprocketLiveVerification(
              detailsResponse.data.order || baseOrder,
              detailsResponse.data.shiprocketOrder
            );

            setOrders((currentOrders) => upsertOrderById(currentOrders, locallyVerifiedOrder));

            const fallbackStatus = locallyVerifiedOrder?.shiprocketPricingAudit?.liveVerification?.status;
            if (fallbackStatus === 'clear') {
              toast.success('Live Shiprocket pricing matched using the fallback verification path.');
            } else if (fallbackStatus === 'mismatch') {
              toast.warn('Live Shiprocket pricing needs review. Fallback verification used Shiprocket order details directly.');
            } else {
              toast.info('Live Shiprocket pricing could not be fully verified. Fallback verification used Shiprocket order details directly.');
            }
          } catch (fallbackError) {
            toast.error(
              fallbackError?.response?.data?.message ||
                fallbackError.message ||
                'The deployed backend is missing the Shiprocket live verification route'
            );
          }

          return;
        }

        toast.error(error?.response?.data?.message || error.message || 'Failed to verify live Shiprocket pricing');
      } finally {
        setShiprocketActionState(orderId, '');
      }
    },
    [fetchAllOrders, orders, setShiprocketActionState, shiprocketActionByOrderId, token]
  );

  useEffect(() => {
    fetchAllOrders();
    fetchShiprocketBulkVerifyJob({ silent: true });
  }, [fetchAllOrders, fetchShiprocketBulkVerifyJob]);

  useEffect(() => {
    if (!token || !realtimeEnabled) {
      setLiveUpdatesStatus({ status: 'disabled', message: 'Live updates disabled' });
      return undefined;
    }

    const disconnect = createAdminOrderRealtimeClient({
      token,
      onConnectionStatusChange: ({ status, message }) => {
        setLiveUpdatesStatus({ status, message });
      },
      onOrderUpsert: (eventPayload, message) => {
        const eventId = String(eventPayload?.eventId || message?.id || '');

        if (eventId) {
          if (processedEventIdsRef.current.has(eventId)) {
            return;
          }

          processedEventIdsRef.current.add(eventId);

          if (processedEventIdsRef.current.size > 500) {
            const iterator = processedEventIdsRef.current.values();
            const oldest = iterator.next().value;
            if (oldest) {
              processedEventIdsRef.current.delete(oldest);
            }
          }
        }

        const nextOrder = eventPayload?.order;
        if (!nextOrder?._id) {
          return;
        }

        setOrders((currentOrders) => upsertOrderById(currentOrders, nextOrder));

        const incomingOrderId = String(nextOrder._id);
        setHighlightedOrderId(incomingOrderId);

        if (highlightTimerRef.current) {
          clearTimeout(highlightTimerRef.current);
        }

        highlightTimerRef.current = setTimeout(() => {
          setHighlightedOrderId('');
          highlightTimerRef.current = null;
        }, 1500);
      },
    });

    return () => {
      disconnect?.();

      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, [token]);

  useEffect(() => {
    if (!token) {
      return undefined;
    }

    const intervalId = setInterval(() => {
      fetchAllOrders({ silent: true });
    }, 45000);

    return () => clearInterval(intervalId);
  }, [fetchAllOrders, token]);

  useEffect(() => {
    if (!token || shiprocketBulkVerifyJob?.status !== 'running') {
      return undefined;
    }

    const intervalId = setInterval(() => {
      fetchShiprocketBulkVerifyJob({ silent: true });

      if (!realtimeEnabled) {
        fetchAllOrders({ silent: true });
      }
    }, 4000);

    return () => clearInterval(intervalId);
  }, [fetchAllOrders, fetchShiprocketBulkVerifyJob, shiprocketBulkVerifyJob?.status, token]);

  useEffect(() => {
    const previousStatus = previousBulkVerifyStatusRef.current;
    const nextStatus = shiprocketBulkVerifyJob?.status || '';

    if (previousStatus === 'running' && nextStatus && nextStatus !== 'running') {
      fetchAllOrders({ silent: true });
    }

    previousBulkVerifyStatusRef.current = nextStatus;
  }, [fetchAllOrders, shiprocketBulkVerifyJob?.status]);

  const visibleOrders = useMemo(() => {
    return orders.filter((order) => {
      const customerName = `${order.address?.firstName || ''} ${order.address?.lastName || ''}`.trim();
      const audit = resolveOrderShiprocketAudit(order);
      const haystack = `${customerName} ${order._id} ${order.paymentMethod} ${
        order.shiprocket?.referenceOrderId || ''
      } ${(audit.issueCodes || []).join(' ')}`.toLowerCase();
      const matchesSearch = haystack.includes(search.toLowerCase().trim());

      if (!matchesSearch) {
        return false;
      }

      if (statusFilter !== 'all' && order.status !== statusFilter) {
        return false;
      }

      if (shiprocketAuditFilter === 'alerts' && !audit.hasMismatch && !audit.hasWarning) {
        return false;
      }

      if (shiprocketAuditFilter === 'mismatch' && !audit.hasMismatch) {
        return false;
      }

      if (shiprocketAuditFilter === 'warning' && audit.status !== 'warning') {
        return false;
      }

      if (shiprocketAuditFilter === 'clear' && audit.status !== 'clear') {
        return false;
      }

      return true;
    });
  }, [orders, search, shiprocketAuditFilter, statusFilter]);

  const shiprocketAuditCounts = useMemo(() => {
    const mismatchCount = orders.filter((order) => resolveOrderShiprocketAudit(order)?.status === 'mismatch').length;
    const warningCount = orders.filter((order) => resolveOrderShiprocketAudit(order)?.status === 'warning').length;
    const clearCount = orders.filter((order) => resolveOrderShiprocketAudit(order)?.status === 'clear').length;
    const missingSnapshotCount = orders.filter((order) =>
      Array.isArray(resolveOrderShiprocketAudit(order)?.issueCodes) &&
      resolveOrderShiprocketAudit(order).issueCodes.includes('missing_shiprocket_pricing_snapshot')
    ).length;

    return {
      mismatchCount,
      missingSnapshotCount,
      warningCount,
      clearCount,
      alertCount: mismatchCount + warningCount,
    };
  }, [orders]);

  const shiprocketBulkVerifyBadge = useMemo(
    () => getShiprocketBulkVerifyJobBadge(shiprocketBulkVerifyJob || {}),
    [shiprocketBulkVerifyJob]
  );

  const summaryCards = useMemo(() => {
    return [
      {
        label: 'Total orders',
        value: orders.length,
        tone: 'text-slate-900',
      },
      {
        label: 'In progress',
        value: orders.filter((order) => !['Delivered', 'Cancelled'].includes(order.status)).length,
        tone: 'text-amber-700',
      },
      {
        label: 'Delivered',
        value: orders.filter((order) => order.status === 'Delivered').length,
        tone: 'text-emerald-700',
      },
      {
        label: 'Shiprocket alerts',
        value: shiprocketAuditCounts.alertCount,
        tone: shiprocketAuditCounts.alertCount > 0 ? 'text-rose-700' : 'text-emerald-700',
      },
      {
        label: 'Awaiting payment',
        value: orders.filter((order) => !order.payment).length,
        tone: 'text-rose-700',
      },
    ];
  }, [orders, shiprocketAuditCounts.alertCount]);

  return (
    <div className='flex flex-col gap-6'>
      <section className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
        <div className='flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between'>
          <div>
            <p className='text-lg font-semibold text-slate-900'>Order operations</p>
            <p className='text-sm text-slate-500'>
              Review the order pipeline, verify payment posture, and push fulfillment updates back to the server.
            </p>
          </div>

          <div className='flex flex-col gap-3 sm:flex-row'>
            <button
              type='button'
              onClick={handleShiprocketBackfill}
              disabled={isBackfillingSnapshots || shiprocketAuditCounts.missingSnapshotCount === 0}
              className='rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-60'
            >
              {isBackfillingSnapshots
                ? 'Backfilling snapshots...'
                : shiprocketAuditCounts.missingSnapshotCount > 0
                  ? `Backfill snapshots (${shiprocketAuditCounts.missingSnapshotCount})`
                  : 'Backfill snapshots'}
            </button>

            <button
              type='button'
              onClick={() => {
                fetchAllOrders();
                fetchShiprocketBulkVerifyJob({ silent: true });
              }}
              className='rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700'
            >
              Refresh orders
            </button>
          </div>

          <span
            className={`rounded-2xl border px-4 py-3 text-xs font-medium uppercase tracking-[0.2em] ${
              liveUpdatesStatus.status === 'connected'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : liveUpdatesStatus.status === 'connecting'
                  ? 'border-sky-200 bg-sky-50 text-sky-800'
                  : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
            title={liveUpdatesStatus.message || 'Live updates status'}
          >
            {liveUpdatesStatus.status === 'connected'
              ? 'Live on'
              : liveUpdatesStatus.status === 'connecting'
                ? 'Live syncing'
                : liveUpdatesStatus.status === 'disabled'
                  ? 'Live off'
                  : 'Live disconnected'}
          </span>
        </div>
      </section>

      <section className='grid gap-4 xl:grid-cols-[1.1fr_0.9fr]'>
        <article className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
            <div>
              <p className='text-lg font-semibold text-slate-900'>Bulk live verification</p>
              <p className='text-sm text-slate-500'>
                Verify high-risk Shiprocket orders in the background with a paced requests-per-minute limit.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${shiprocketBulkVerifyBadge.className}`}
            >
              {shiprocketBulkVerifyBadge.label}
            </span>
          </div>

          <div className='mt-5 grid gap-3 md:grid-cols-3'>
            <label className='text-sm text-slate-600'>
              <span className='mb-2 block text-xs uppercase tracking-[0.2em] text-slate-400'>Scope</span>
              <select
                value={shiprocketBulkVerifyConfig.scope}
                onChange={(event) => setShiprocketBulkVerifyConfigField('scope', event.target.value)}
                disabled={shiprocketBulkVerifyJob?.status === 'running'}
                className='w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 disabled:cursor-not-allowed disabled:opacity-60'
              >
                <option value='high_risk'>High-risk alerts</option>
                <option value='not_verified'>Not verified yet</option>
                <option value='all_synced'>All synced orders</option>
              </select>
            </label>

            <label className='text-sm text-slate-600'>
              <span className='mb-2 block text-xs uppercase tracking-[0.2em] text-slate-400'>Batch limit</span>
              <input
                value={shiprocketBulkVerifyConfig.limit}
                onChange={(event) => setShiprocketBulkVerifyConfigField('limit', event.target.value)}
                disabled={shiprocketBulkVerifyJob?.status === 'running'}
                className='w-full rounded-2xl border border-slate-300 px-4 py-3 disabled:cursor-not-allowed disabled:opacity-60'
                type='number'
                min='1'
                max='500'
                inputMode='numeric'
              />
            </label>

            <label className='text-sm text-slate-600'>
              <span className='mb-2 block text-xs uppercase tracking-[0.2em] text-slate-400'>Requests / minute</span>
              <input
                value={shiprocketBulkVerifyConfig.requestsPerMinute}
                onChange={(event) => setShiprocketBulkVerifyConfigField('requestsPerMinute', event.target.value)}
                disabled={shiprocketBulkVerifyJob?.status === 'running'}
                className='w-full rounded-2xl border border-slate-300 px-4 py-3 disabled:cursor-not-allowed disabled:opacity-60'
                type='number'
                min='1'
                max='180'
                inputMode='numeric'
              />
            </label>
          </div>

          <div className='mt-4 flex flex-col gap-3 sm:flex-row'>
            <button
              type='button'
              onClick={handleStartShiprocketBulkVerify}
              disabled={isStartingBulkVerify || shiprocketBulkVerifyJob?.status === 'running'}
              className='rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60'
            >
              {isStartingBulkVerify
                ? 'Starting verification...'
                : shiprocketBulkVerifyJob?.status === 'running'
                  ? 'Verification running...'
                  : 'Start bulk verify'}
            </button>

            <button
              type='button'
              onClick={handleCancelShiprocketBulkVerify}
              disabled={
                isCancellingBulkVerify ||
                shiprocketBulkVerifyJob?.status !== 'running' ||
                shiprocketBulkVerifyJob?.isCancelling
              }
              className='rounded-2xl border border-rose-300 px-4 py-3 text-sm font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-60'
            >
              {isCancellingBulkVerify
                ? 'Requesting cancel...'
                : shiprocketBulkVerifyJob?.isCancelling
                  ? 'Cancellation requested'
                  : 'Cancel run'}
            </button>

            <button
              type='button'
              onClick={() => fetchShiprocketBulkVerifyJob()}
              className='rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700'
            >
              Refresh job status
            </button>
          </div>
        </article>

        <article className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='flex items-start justify-between gap-3'>
            <div>
              <p className='text-lg font-semibold text-slate-900'>Verification progress</p>
              <p className='text-sm text-slate-500'>
                Progress is persisted server-side, so refreshes keep the current run visible.
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${shiprocketBulkVerifyBadge.className}`}
            >
              {shiprocketBulkVerifyBadge.label}
            </span>
          </div>

          <div className='mt-5 space-y-4'>
            <div className='rounded-3xl bg-slate-50 p-4'>
              <div className='flex items-center justify-between gap-3 text-sm'>
                <span className='text-slate-500'>Processed</span>
                <span className='font-medium text-slate-900'>
                  {Number(shiprocketBulkVerifyJob?.progress?.processedCount || 0)} /{' '}
                  {Number(shiprocketBulkVerifyJob?.progress?.totalCount || 0)}
                </span>
              </div>
              <div className='mt-3 h-3 overflow-hidden rounded-full bg-slate-200'>
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    shiprocketBulkVerifyJob?.status === 'failed'
                      ? 'bg-rose-500'
                      : shiprocketBulkVerifyJob?.status === 'completed'
                        ? 'bg-emerald-500'
                        : 'bg-slate-900'
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, Number(shiprocketBulkVerifyJob?.progress?.percentComplete || 0)))}%` }}
                />
              </div>
              <p className='mt-2 text-xs uppercase tracking-[0.18em] text-slate-400'>
                {Number(shiprocketBulkVerifyJob?.progress?.percentComplete || 0)}% complete
              </p>
            </div>

            <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
              <div className='rounded-2xl bg-emerald-50 px-4 py-3'>
                <p className='text-xs uppercase tracking-[0.2em] text-emerald-700'>Clear</p>
                <p className='mt-2 text-2xl font-semibold text-emerald-900'>
                  {Number(shiprocketBulkVerifyJob?.progress?.clearCount || 0)}
                </p>
              </div>
              <div className='rounded-2xl bg-amber-50 px-4 py-3'>
                <p className='text-xs uppercase tracking-[0.2em] text-amber-700'>Warning</p>
                <p className='mt-2 text-2xl font-semibold text-amber-900'>
                  {Number(shiprocketBulkVerifyJob?.progress?.warningCount || 0)}
                </p>
              </div>
              <div className='rounded-2xl bg-rose-50 px-4 py-3'>
                <p className='text-xs uppercase tracking-[0.2em] text-rose-700'>Mismatch</p>
                <p className='mt-2 text-2xl font-semibold text-rose-900'>
                  {Number(shiprocketBulkVerifyJob?.progress?.mismatchCount || 0)}
                </p>
              </div>
              <div className='rounded-2xl bg-slate-100 px-4 py-3'>
                <p className='text-xs uppercase tracking-[0.2em] text-slate-600'>Failed</p>
                <p className='mt-2 text-2xl font-semibold text-slate-900'>
                  {Number(shiprocketBulkVerifyJob?.progress?.failedCount || 0)}
                </p>
              </div>
              <div className='rounded-2xl bg-sky-50 px-4 py-3 sm:col-span-2 xl:col-span-4'>
                <p className='text-xs uppercase tracking-[0.2em] text-sky-700'>Retry scheduled</p>
                <p className='mt-2 text-2xl font-semibold text-sky-900'>
                  {Number(shiprocketBulkVerifyJob?.progress?.retryScheduledCount || 0)}
                </p>
                <p className='mt-1 text-sm text-sky-800'>
                  Last wait {Math.round(Number(shiprocketBulkVerifyJob?.progress?.lastRetryDelayMs || 0) / 1000)}s
                </p>
              </div>
            </div>

            <div className='grid gap-3 md:grid-cols-2'>
              <div className='rounded-2xl border border-slate-200 px-4 py-4 text-sm text-slate-600'>
                <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Run context</p>
                <p className='mt-2 font-medium text-slate-900'>
                  {formatEnumLabel(shiprocketBulkVerifyJob?.config?.scope, 'High risk')}
                </p>
                <p className='mt-1'>Started {formatDateTime(shiprocketBulkVerifyJob?.startedAt)}</p>
                <p className='mt-1'>Finished {formatDateTime(shiprocketBulkVerifyJob?.finishedAt)}</p>
                <p className='mt-1'>
                  Pacing {Number(shiprocketBulkVerifyJob?.config?.requestsPerMinute || 0)} request
                  {Number(shiprocketBulkVerifyJob?.config?.requestsPerMinute || 0) === 1 ? '' : 's'} / minute
                </p>
                {shiprocketBulkVerifyJob?.cancelRequestedAt ? (
                  <p className='mt-1 text-amber-700'>
                    Cancel requested {formatDateTime(shiprocketBulkVerifyJob.cancelRequestedAt)}
                  </p>
                ) : null}
              </div>

              <div className='rounded-2xl border border-slate-200 px-4 py-4 text-sm text-slate-600'>
                <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Current order</p>
                <p className='mt-2 font-medium text-slate-900'>
                  {shiprocketBulkVerifyJob?.progress?.currentReferenceOrderId ||
                    shiprocketBulkVerifyJob?.progress?.currentOrderId ||
                    'No active order'}
                </p>
                <p className='mt-1'>
                  Last processed {shiprocketBulkVerifyJob?.progress?.lastProcessedOrderId || 'Not processed yet'}
                </p>
                <p className='mt-1'>Requested by {shiprocketBulkVerifyJob?.requestedBy || 'Admin'}</p>
                {shiprocketBulkVerifyJob?.cancelRequestedBy ? (
                  <p className='mt-1 text-amber-700'>Cancelling by {shiprocketBulkVerifyJob.cancelRequestedBy}</p>
                ) : null}
                {shiprocketBulkVerifyJob?.error ? (
                  <p className='mt-2 text-rose-600'>{shiprocketBulkVerifyJob.error}</p>
                ) : null}
                {shiprocketBulkVerifyJob?.isStale ? (
                  <p className='mt-2 text-amber-600'>The active run looks stale. Refresh status or start a fresh run.</p>
                ) : null}
                {shiprocketBulkVerifyJob?.progress?.statusNote ? (
                  <p className='mt-2 text-sky-700'>{shiprocketBulkVerifyJob.progress.statusNote}</p>
                ) : null}
              </div>
            </div>

            {Array.isArray(shiprocketBulkVerifyJob?.progress?.recentFailures) &&
            shiprocketBulkVerifyJob.progress.recentFailures.length > 0 ? (
              <div className='rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-800'>
                <p className='text-xs uppercase tracking-[0.2em] text-rose-600'>Recent failures</p>
                <div className='mt-3 space-y-2'>
                  {shiprocketBulkVerifyJob.progress.recentFailures.map((failure) => (
                    <div key={`${failure.orderId}-${failure.referenceOrderId}`} className='rounded-2xl bg-white px-3 py-3'>
                      <p className='font-medium text-slate-900'>{failure.referenceOrderId || failure.orderId}</p>
                      <p className='mt-1 text-sm text-rose-700'>{failure.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className='rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500'>
                Failed live-verification attempts will appear here while the job is running.
              </div>
            )}
          </div>
        </article>
      </section>

      <section className='grid gap-4 md:grid-cols-2 xl:grid-cols-5'>
        {summaryCards.map((card) => (
          <article key={card.label} className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
            <p className='text-sm text-slate-500'>{card.label}</p>
            <p className={`mt-3 text-3xl font-semibold ${card.tone}`}>{card.value}</p>
          </article>
        ))}
      </section>

      <section className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
        <div className='grid gap-3 xl:grid-cols-[1.4fr_0.8fr_0.9fr]'>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className='rounded-2xl border border-slate-300 px-4 py-3'
            type='text'
            placeholder='Search by customer name, order id, Shiprocket ref, or issue code'
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className='rounded-2xl border border-slate-300 bg-white px-4 py-3'
          >
            <option value='all'>All statuses</option>
            {orderStatusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <select
            value={shiprocketAuditFilter}
            onChange={(event) => setShiprocketAuditFilter(event.target.value)}
            className='rounded-2xl border border-slate-300 bg-white px-4 py-3'
          >
            <option value='all'>All Shiprocket states</option>
            <option value='alerts'>Shiprocket alerts</option>
            <option value='mismatch'>Only mismatches</option>
            <option value='warning'>Needs review</option>
            <option value='clear'>Verified / clear</option>
          </select>
        </div>
      </section>

      <section className='space-y-4'>
        {isLoading ? (
          <div className='ui-loading-state'>Loading orders...</div>
        ) : visibleOrders.length === 0 ? (
          <div className='rounded-[32px] border border-slate-200 bg-white px-6 py-10 text-sm text-slate-500 shadow-sm'>
            No orders matched the current filters.
          </div>
        ) : (
          visibleOrders.map((order) => {
            const customerName = `${order.address?.firstName || ''} ${order.address?.lastName || ''}`.trim();
            const shiprocketAudit = resolveOrderShiprocketAudit(order);
            const shiprocketAuditBadge = getShiprocketAuditBadge(shiprocketAudit);
            const expectedShiprocket = shiprocketAudit.expectedShiprocket || {};
            const storedShiprocketSnapshot = shiprocketAudit.storedShiprocketSnapshot || null;
            const liveVerification = shiprocketAudit.liveVerification || {};
            const liveShiprocketSnapshot = liveVerification.snapshot || null;
            const activeShiprocketAction = shiprocketActionByOrderId[order._id] || '';
            const canVerifyLive = Boolean(order.shiprocket?.orderId);

            return (
              <article
                key={order._id}
                className={`rounded-[32px] border bg-white p-5 shadow-sm transition-all duration-500 ${
                  highlightedOrderId === String(order._id)
                    ? 'border-sky-300 shadow-[0_0_0_3px_rgba(125,211,252,0.35)]'
                    : 'border-slate-200'
                }`}
              >
                <div className='flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between'>
                  <div>
                    <div className='flex flex-wrap items-center gap-2'>
                      <h2 className='text-lg font-semibold text-slate-900'>#{order._id.slice(-8).toUpperCase()}</h2>
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${getStatusClasses(
                          order.status
                        )}`}
                      >
                        {order.status}
                      </span>
                      <span className='rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-700'>
                        {order.paymentMethod}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${shiprocketAuditBadge.className}`}
                      >
                        {shiprocketAuditBadge.label}
                      </span>
                    </div>
                    <p className='mt-2 text-sm text-slate-500'>{customerName || 'Customer order'}</p>
                    <p className='mt-1 text-sm text-slate-500'>{formatDate(order.date)}</p>
                  </div>

                  <div className='flex flex-col gap-3 sm:flex-row sm:items-center'>
                    <div className='rounded-2xl bg-slate-50 px-4 py-3'>
                      <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Amount</p>
                      <p className='mt-1 text-lg font-semibold text-slate-900'>{formatCurrency(order.amount)}</p>
                    </div>

                    <select
                      onChange={(event) => statusHandler(event, order._id)}
                      value={order.status}
                      disabled={updatingOrderId === order._id}
                      className='rounded-2xl border border-slate-300 bg-white px-4 py-3 font-medium text-slate-700 disabled:opacity-60'
                    >
                      {getAvailableStatusOptions(order).map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className='mt-5 grid gap-4 xl:grid-cols-2 2xl:grid-cols-[1.2fr_1.1fr_0.9fr_1.1fr]'>
                  <div className='rounded-3xl bg-slate-50 p-4'>
                    <p className='text-sm font-medium text-slate-900'>Ordered items</p>
                    <div className='mt-3 space-y-2 text-sm text-slate-600'>
                      {order.items.map((item, index) => (
                        <div
                          key={`${order._id}-${index}`}
                          className='flex items-center justify-between gap-3 rounded-2xl bg-white px-3 py-3'
                        >
                          <div className='flex min-w-0 items-center gap-3'>
                            {getItemImageUrl(item) ? (
                              <img
                                src={getItemImageUrl(item)}
                                alt={item.name}
                                className='h-14 w-12 rounded-xl border border-slate-200 object-cover'
                              />
                            ) : (
                              <div className='flex h-14 w-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-[11px] uppercase tracking-[0.15em] text-slate-500'>
                                No image
                              </div>
                            )}
                            <div className='min-w-0'>
                              <p className='truncate font-medium text-slate-900'>{item.name}</p>
                              <p className='text-xs text-slate-500'>Size {item.size || '-'}</p>
                            </div>
                          </div>
                          <div className='text-right'>
                            <p className='font-medium text-slate-900'>x{item.quantity}</p>
                            <p className='text-xs text-slate-500'>{formatCurrency(item.price)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className='rounded-3xl bg-slate-50 p-4'>
                    <p className='text-sm font-medium text-slate-900'>Delivery details</p>
                    <div className='mt-3 space-y-2 text-sm leading-6 text-slate-600'>
                      <p className='font-medium text-slate-900'>{customerName}</p>
                      <p>{order.address?.street}</p>
                      <p>
                        {order.address?.city}, {order.address?.state}, {order.address?.country}
                      </p>
                      <p>{order.address?.pincode}</p>
                      <p>{order.address?.phone}</p>
                    </div>
                  </div>

                  <div className='rounded-3xl bg-slate-50 p-4'>
                    <p className='text-sm font-medium text-slate-900'>Payment snapshot</p>
                    <div className='mt-3 space-y-3 text-sm text-slate-600'>
                      <div className='rounded-2xl bg-white px-3 py-3'>
                        <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Payment</p>
                        <p className='mt-1 font-medium text-slate-900'>{getPaymentLabel(order)}</p>
                      </div>
                      <div className='rounded-2xl bg-white px-3 py-3'>
                        <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Method</p>
                        <p className='mt-1 font-medium text-slate-900'>{order.paymentMethod}</p>
                      </div>
                      <div className='rounded-2xl bg-white px-3 py-3'>
                        <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Line items</p>
                        <p className='mt-1 font-medium text-slate-900'>{order.items.length}</p>
                      </div>
                    </div>
                  </div>

                  <div className='rounded-3xl bg-slate-50 p-4'>
                    <div className='flex items-start justify-between gap-3'>
                      <div>
                        <p className='text-sm font-medium text-slate-900'>Shiprocket audit</p>
                        <p className='mt-1 text-xs uppercase tracking-[0.18em] text-slate-500'>
                          {formatEnumLabel(shiprocketAudit.syncStatus || order.shiprocket?.syncStatus, 'Not synced')}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${shiprocketAuditBadge.className}`}
                      >
                        {shiprocketAuditBadge.label}
                      </span>
                    </div>

                    <div className='mt-3 space-y-3 text-sm text-slate-600'>
                      <div className='rounded-2xl bg-white px-3 py-3'>
                        <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Reference</p>
                        <p className='mt-1 font-medium text-slate-900'>
                          {order.shiprocket?.referenceOrderId || 'Not assigned'}
                        </p>
                        {order.shiprocket?.referenceOrderId ? (
                          <p className='mt-2 text-xs text-slate-500'>
                            {shiprocketAudit.remoteOrderTracked
                              ? 'Shiprocket has a remote order linked to this reference.'
                              : 'This reference is reserved locally. Shiprocket sync has not finished yet.'}
                          </p>
                        ) : null}
                        <div className='mt-3 flex flex-wrap gap-2'>
                          <button
                            type='button'
                            onClick={() => verifyShiprocketPricingLive(order._id)}
                            disabled={!canVerifyLive || Boolean(activeShiprocketAction)}
                            className='rounded-full border border-slate-300 px-4 py-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-700 disabled:cursor-not-allowed disabled:opacity-60'
                          >
                            {activeShiprocketAction === 'verify_live' ? 'Verifying live...' : 'Verify live'}
                          </button>
                        </div>
                        {!canVerifyLive ? (
                          <p className='mt-2 text-xs text-slate-500'>
                            Sync this order to Shiprocket before running live verification.
                          </p>
                        ) : null}
                      </div>

                      <div className='rounded-2xl bg-white px-3 py-3'>
                        <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Expected payload</p>
                        <div className='mt-2 space-y-1.5'>
                          <div className='flex items-center justify-between'>
                            <span>Sub total</span>
                            <span>{formatCurrency(expectedShiprocket.subTotal)}</span>
                          </div>
                          <div className='flex items-center justify-between'>
                            <span>Shipping</span>
                            <span>{formatCurrency(expectedShiprocket.shippingCharges)}</span>
                          </div>
                          <div className='flex items-center justify-between'>
                            <span>Discount</span>
                            <span>-{formatCurrency(expectedShiprocket.totalDiscount)}</span>
                          </div>
                          <div className='flex items-center justify-between border-t border-slate-200 pt-2 font-medium text-slate-900'>
                            <span>Payload total</span>
                            <span>{formatCurrency(expectedShiprocket.derivedFinalAmount)}</span>
                          </div>
                        </div>
                      </div>

                      {storedShiprocketSnapshot ? (
                        <div className='rounded-2xl bg-white px-3 py-3'>
                          <div className='flex items-start justify-between gap-3'>
                            <div>
                              <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Last synced snapshot</p>
                              <p className='mt-1 text-xs text-slate-500'>
                                Captured {formatDateTime(storedShiprocketSnapshot.capturedAt)}
                              </p>
                            </div>
                            <span className='rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-700'>
                              v{storedShiprocketSnapshot.formulaVersion || 2}
                            </span>
                          </div>
                          <div className='mt-2 space-y-1.5'>
                            <div className='flex items-center justify-between'>
                              <span>Sub total</span>
                              <span>{formatCurrency(storedShiprocketSnapshot.subTotal)}</span>
                            </div>
                            <div className='flex items-center justify-between'>
                              <span>Shipping</span>
                              <span>{formatCurrency(storedShiprocketSnapshot.shippingCharges)}</span>
                            </div>
                            <div className='flex items-center justify-between'>
                              <span>Discount</span>
                              <span>-{formatCurrency(storedShiprocketSnapshot.totalDiscount)}</span>
                            </div>
                            <div className='flex items-center justify-between border-t border-slate-200 pt-2 font-medium text-slate-900'>
                              <span>Snapshot total</span>
                              <span>{formatCurrency(storedShiprocketSnapshot.derivedFinalAmount)}</span>
                            </div>
                          </div>
                          <p
                            className={`mt-3 text-xs ${
                              Math.abs(Number(storedShiprocketSnapshot.derivedFinalAmountDelta || 0)) > 0.01
                                ? 'text-rose-600'
                                : 'text-emerald-600'
                            }`}
                          >
                            {Math.abs(Number(storedShiprocketSnapshot.derivedFinalAmountDelta || 0)) > 0.01
                              ? `Snapshot delta ${formatCurrency(storedShiprocketSnapshot.derivedFinalAmountDelta)}`
                              : 'Snapshot matches the current expected Shiprocket total.'}
                          </p>
                        </div>
                      ) : (
                        <div className='rounded-2xl border border-dashed border-slate-300 bg-white px-3 py-3 text-sm text-slate-500'>
                          No Shiprocket pricing snapshot is stored yet for this order.
                        </div>
                      )}

                      <div className='rounded-2xl bg-white px-3 py-3'>
                        <div className='flex items-start justify-between gap-3'>
                          <div>
                            <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Live Shiprocket check</p>
                            <p className='mt-1 text-xs text-slate-500'>
                              {liveVerification.verifiedAt
                                ? `Verified ${formatDateTime(liveVerification.verifiedAt)}`
                                : 'Not verified yet'}
                            </p>
                          </div>
                          <span className='rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-700'>
                            {formatEnumLabel(liveVerification.status, 'Not verified')}
                          </span>
                        </div>

                        {liveShiprocketSnapshot ? (
                          <div className='mt-2 space-y-1.5'>
                            <div className='flex items-center justify-between'>
                              <span>Sub total</span>
                              <span>{formatCurrency(liveShiprocketSnapshot.subTotal)}</span>
                            </div>
                            <div className='flex items-center justify-between'>
                              <span>Shipping</span>
                              <span>{formatCurrency(liveShiprocketSnapshot.shippingCharges)}</span>
                            </div>
                            <div className='flex items-center justify-between'>
                              <span>Discount</span>
                              <span>-{formatCurrency(liveShiprocketSnapshot.totalDiscount)}</span>
                            </div>
                            <div className='flex items-center justify-between border-t border-slate-200 pt-2 font-medium text-slate-900'>
                              <span>Live total</span>
                              <span>{formatCurrency(liveShiprocketSnapshot.derivedFinalAmount)}</span>
                            </div>
                            <p
                              className={`text-xs ${
                                Math.abs(Number(liveShiprocketSnapshot.derivedFinalAmountDelta || 0)) > 0.01
                                  ? 'text-rose-600'
                                  : 'text-emerald-600'
                              }`}
                            >
                              {Math.abs(Number(liveShiprocketSnapshot.derivedFinalAmountDelta || 0)) > 0.01
                                ? `Live delta ${formatCurrency(liveShiprocketSnapshot.derivedFinalAmountDelta)}`
                                : 'Live Shiprocket pricing matches the expected payload.'}
                            </p>
                          </div>
                        ) : (
                          <p className='mt-2 text-sm text-slate-500'>
                            {liveVerification.error || 'Run live verification for the current Shiprocket order details.'}
                          </p>
                        )}
                      </div>

                      <div className='rounded-2xl bg-white px-3 py-3'>
                        <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Local order check</p>
                        <div className='mt-2 space-y-1.5'>
                          <div className='flex items-center justify-between'>
                            <span>Items subtotal</span>
                            <span>{formatCurrency(shiprocketAudit.local?.itemsSubtotal)}</span>
                          </div>
                          <div className='flex items-center justify-between'>
                            <span>Stored subtotal</span>
                            <span>{formatCurrency(shiprocketAudit.local?.storedSubtotal)}</span>
                          </div>
                          <div className='flex items-center justify-between'>
                            <span>Order amount</span>
                            <span>{formatCurrency(shiprocketAudit.local?.amount)}</span>
                          </div>
                        </div>
                      </div>

                      {shiprocketAudit.issues?.length > 0 ? (
                        <div className='space-y-2'>
                          {shiprocketAudit.issues.map((issue) => (
                            <div
                              key={`${order._id}-${issue.code}`}
                              className={`rounded-2xl border px-3 py-3 text-sm ${getAuditIssueClasses(issue.severity)}`}
                            >
                              <p className='text-[10px] uppercase tracking-[0.18em]'>
                                {issue.severity === 'error' ? 'Mismatch' : 'Review'}
                              </p>
                              <p className='mt-1 font-medium'>{issue.message}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className='rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800'>
                          Shiprocket pricing is aligned with the current order breakdown.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
};

export default Orders;
