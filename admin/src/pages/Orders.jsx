import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';
import { createAdminOrderRealtimeClient } from '../services/realtimeClient';
import { mergeOrderSnapshot, upsertOrderById } from '../utils/orderMerge';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { usePersistedState } from '../hooks';

// Free-form, agent-selectable cancellation reasons. Captured locally for the
// audit toast — the backend payload remains unchanged so the existing API
// contract is preserved (ADMIN_UI_OPTIMIZATION_PLAN §7).
const ORDER_CANCEL_REASONS = [
  'Customer requested cancellation',
  'Out of stock',
  'Payment failed / chargeback',
  'Address unreachable',
  'Suspected fraud',
  'Pricing or item error',
  'Other'
];

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
          : Number(snapshot?.subTotal || 0) -
            Number(snapshot?.totalDiscount || 0) +
            Number(snapshot?.shippingCharges || 0)
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
  // Mirror the server-side formula in shiprocketService.js: Shiprocket renders
  // invoices as `sub_total - total_discount + shipping_charges`, so `subTotal`
  // must be the items sub-total BEFORE the discount is applied.
  const subTotal =
    fallbackSubtotalBeforeDiscount > 0
      ? fallbackSubtotalBeforeDiscount
      : finalAmount !== null
        ? roundCurrencyValue(Math.max(0, finalAmount + totalDiscount - shippingCharges))
        : 0;
  const derivedFinalAmount = roundCurrencyValue(Math.max(0, subTotal - totalDiscount + shippingCharges));

  return normalizeAuditPricingSnapshot({
    formulaVersion: SHIPROCKET_PRICING_FORMULA_VERSION,
    source: 'client_shiprocket_fallback_expected',
    capturedAt: null,
    itemsSubtotal,
    localSubtotal: storedSubtotalBeforeDiscount,
    totalDiscount,
    shippingCharges,
    subTotal,
    localAmount: finalAmount !== null ? finalAmount : derivedFinalAmount,
    derivedFinalAmount,
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

const extractShiprocketLivePricingSnapshot = (payload = {}, checkedAt = Date.now(), options = {}) => {
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
  const explicitTotalDiscount = pickFirstFiniteCurrencyValue(
    orderRoot?.total_discount,
    orderRoot?.other_discounts,
    orderRoot?.discount
  );
  const fallbackTotalDiscountValue = pickFirstFiniteCurrencyValue(options?.fallbackTotalDiscount);
  // Shiprocket's `/orders/show` payload sometimes omits every order-level
  // discount field even when the printed invoice still applies the discount
  // (observed on COD orders — invoice shows Rs.20 discount and NET TOTAL
  // ₹190 while the JSON response has no `total_discount`/`other_discounts`/
  // `discount`). It also sometimes echoes a literal `discount: 0` on orders
  // that were created WITH a positive discount — the invoice and Shiprocket
  // panel still show the correct discounted total but the API zeroes out
  // the discount field. In both cases fall back to the locally-known
  // discount we sent at order creation so the verification doesn't surface
  // a phantom mismatch. Per-line product discounts are only used as a last
  // resort because Shiprocket usually returns 0 there even for discounted
  // orders.
  const productDiscountFallback = pickFirstFiniteCurrencyValue(productDiscount);
  const shouldUseFallbackDiscount =
    fallbackTotalDiscountValue !== null &&
    fallbackTotalDiscountValue > 0 &&
    (explicitTotalDiscount === null || explicitTotalDiscount === 0);
  const totalDiscount = shouldUseFallbackDiscount
    ? fallbackTotalDiscountValue
    : explicitTotalDiscount !== null
      ? explicitTotalDiscount
      : productDiscountFallback;
  const effectiveTotalDiscount = totalDiscount;
  // See server/services/shiprocketService.js for the rationale: Shiprocket's
  // `net_total` / `total_inr` / `total` are unreliable on `/orders/show` â€”
  // they often echo the items sub_total instead of the customer-facing grand
  // total. The component fields (sub_total, others.shipping_charges,
  // giftwrap_charges, transaction_charges, total_discount) are reliable, so
  // always derive the grand total from those and only use the grand-total
  // fields as a fallback when no components are present.
  const explicitGrandTotal = pickFirstFiniteCurrencyValue(orderRoot?.net_total, orderRoot?.total_inr);
  const explicitSubTotal = pickFirstFiniteCurrencyValue(orderRoot?.sub_total);
  const ambiguousTotal = pickFirstFiniteCurrencyValue(orderRoot?.total);
  const normalizedShippingCharges = shippingCharges ?? 0;
  const normalizedGiftwrapCharges = giftwrapCharges ?? 0;
  const normalizedTransactionCharges = transactionCharges ?? 0;
  const additiveCharges =
    normalizedShippingCharges + normalizedGiftwrapCharges + normalizedTransactionCharges;

  let normalizedSubTotal;
  if (explicitSubTotal !== null) {
    normalizedSubTotal = explicitSubTotal;
  } else if (itemsSubtotal > 0) {
    normalizedSubTotal = itemsSubtotal;
  } else if (ambiguousTotal !== null) {
    normalizedSubTotal =
      explicitGrandTotal !== null && Math.abs(ambiguousTotal - explicitGrandTotal) < 0.01
        ? roundCurrencyValue(Math.max(0, ambiguousTotal - additiveCharges))
        : ambiguousTotal;
  } else if (explicitGrandTotal !== null) {
    normalizedSubTotal = roundCurrencyValue(Math.max(0, explicitGrandTotal - additiveCharges));
  } else {
    normalizedSubTotal = 0;
  }

  const haveAnyComponentSignal =
    explicitSubTotal !== null ||
    itemsSubtotal > 0 ||
    shippingCharges !== null ||
    giftwrapCharges !== null ||
    transactionCharges !== null ||
    effectiveTotalDiscount !== null;
  const computedFromComponents = roundCurrencyValue(
    Math.max(0, normalizedSubTotal - Number(effectiveTotalDiscount || 0) + additiveCharges)
  );
  const normalizedDerivedFinalAmount = haveAnyComponentSignal
    ? computedFromComponents
    : explicitGrandTotal !== null
      ? explicitGrandTotal
      : ambiguousTotal !== null
        ? ambiguousTotal
        : computedFromComponents;

  return normalizeAuditPricingSnapshot({
    formulaVersion: SHIPROCKET_PRICING_FORMULA_VERSION,
    source: 'shiprocket_live_order_details_fallback',
    capturedAt: checkedAt,
    itemsSubtotal,
    localSubtotal: itemsSubtotal,
    totalDiscount: effectiveTotalDiscount ?? 0,
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
  const expectedTotalDiscount = Number(expectedShiprocket?.totalDiscount || 0);
  // Same fix as server/services/shiprocketService.js: `shiprocketOrder.pricingSnapshot`
  // may have been pre-computed without the `fallbackTotalDiscount` option,
  // so it can carry `totalDiscount: 0` when Shiprocket echoes a literal
  // `discount: 0`. Always prefer re-extracting from the raw payload with
  // the fallback so the discount gets restored before we fall back to the
  // cached snapshot.
  const rawShiprocketPayload = shiprocketOrder?.raw || shiprocketOrder;
  const liveShiprocketSnapshot =
    extractShiprocketLivePricingSnapshot(rawShiprocketPayload, checkedAt, {
      // Mirror the server-side fallback in shiprocketService.js: when the
      // Shiprocket /orders/show response omits the discount fields or echoes
      // a literal `discount: 0`, treat the locally-known discount as still
      // in effect so the live verification doesn't surface a phantom mismatch.
      fallbackTotalDiscount: expectedTotalDiscount > 0 ? expectedTotalDiscount : null,
    }) ||
    normalizeAuditPricingSnapshot(shiprocketOrder?.pricingSnapshot);
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
  const refundStatus = String(order?.refundStatus || '').trim().toLowerCase();
  const refundedAmount = Number(order?.refundedAmount || 0);
  const orderTotal = Number(order?.amount || 0);
  const isCancelledLike =
    String(order.paymentStatus || '').trim().toLowerCase() === 'cancelled' ||
    order.status === 'Cancelled';

  if (refundStatus === 'processed' || (refundedAmount > 0 && refundedAmount + 0.01 >= orderTotal)) {
    return 'Refunded';
  }

  if (refundStatus === 'partial' || (refundedAmount > 0 && refundedAmount + 0.01 < orderTotal)) {
    return 'Partially refunded';
  }

  if (refundStatus === 'pending') {
    return 'Refund processing';
  }

  if (refundStatus === 'failed') {
    return 'Refund failed';
  }

  if (isCancelledLike) {
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

const getPaymentBadgeClass = (order) => {
  const label = getPaymentLabel(order);

  if (label === 'Refunded') {
    return 'bg-emerald-50 text-emerald-700';
  }

  if (label === 'Partially refunded' || label === 'Refund processing') {
    return 'bg-amber-50 text-amber-800';
  }

  if (label === 'Refund failed') {
    return 'bg-rose-100 text-rose-800';
  }

  if (label === 'Refund pending') {
    return 'bg-rose-50 text-rose-700';
  }

  if (order.payment) {
    return 'bg-emerald-50 text-emerald-700';
  }

  if (order.status === 'Cancelled') {
    return 'bg-rose-50 text-rose-700';
  }

  return 'bg-amber-50 text-amber-700';
};

const getCancellationBanner = (order) => {
  if (!order.payment) {
    return 'Order cancelled. No payment received.';
  }

  const refundStatus = String(order?.refundStatus || '').trim().toLowerCase();
  const refundedAmount = Number(order?.refundedAmount || 0);
  const orderTotal = Number(order?.amount || 0);

  if (refundStatus === 'processed' || (refundedAmount > 0 && refundedAmount + 0.01 >= orderTotal)) {
    return `Order cancelled. Refund of ₹${Number(refundedAmount).toLocaleString('en-IN')} processed.`;
  }

  if (refundStatus === 'partial' || (refundedAmount > 0 && refundedAmount + 0.01 < orderTotal)) {
    const remaining = Math.max(0, Math.round((orderTotal - refundedAmount) * 100) / 100);
    return `Order cancelled. ₹${refundedAmount.toLocaleString('en-IN')} refunded, ₹${remaining.toLocaleString('en-IN')} pending.`;
  }

  if (refundStatus === 'pending') {
    return 'Order cancelled. Refund initiated, awaiting processing.';
  }

  if (refundStatus === 'failed') {
    return 'Order cancelled. Refund attempt failed — please retry.';
  }

  return 'Order cancelled. Refund must be processed.';
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
  // Persist filter selections across reloads so support agents return to the
  // exact saved view they had open (ADMIN_UI_OPTIMIZATION_PLAN §3.5 F).
  const [statusFilter, setStatusFilter] = usePersistedState('admin.orders.statusFilter', 'all');
  const [shiprocketAuditFilter, setShiprocketAuditFilter] = usePersistedState(
    'admin.orders.shiprocketAuditFilter',
    'all'
  );
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
  const [pendingCancelOrderId, setPendingCancelOrderId] = useState(null);
  const [cancelReason, setCancelReason] = useState(ORDER_CANCEL_REASONS[0]);
  const [cancelReasonNote, setCancelReasonNote] = useState('');
  const [pendingRefundOrderId, setPendingRefundOrderId] = useState('');
  const [refundAmountInput, setRefundAmountInput] = useState('');
  const [refundReasonInput, setRefundReasonInput] = useState('');
  const [refundSpeedInput, setRefundSpeedInput] = useState('normal');
  const [isProcessingRefund, setIsProcessingRefund] = useState(false);
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
    const newStatus = event.target.value;

    if (newStatus === 'Cancelled') {
      setPendingCancelOrderId(orderId);
      event.target.value = orders.find((o) => o._id === orderId)?.status || 'Order Placed';
      return;
    }

    await applyStatusUpdate(orderId, newStatus);
  };

  const applyStatusUpdate = async (orderId, status) => {
    setUpdatingOrderId(orderId);

    try {
      const response = await axios.post(
        `${ORDER_API_BASE}/status`,
        { orderId, status },
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

  const confirmCancelOrder = async () => {
    const orderId = pendingCancelOrderId;
    const reasonLabel = cancelReason === 'Other' && cancelReasonNote.trim()
      ? cancelReasonNote.trim()
      : cancelReason;
    setPendingCancelOrderId(null);
    setCancelReason(ORDER_CANCEL_REASONS[0]);
    setCancelReasonNote('');
    if (orderId) {
      await applyStatusUpdate(orderId, 'Cancelled');
      // Surface the captured reason to the agent so they have an audit trail
      // until a backend audit endpoint exists (plan §8 open question).
      toast.info(`Cancellation reason: ${reasonLabel}`);
    }
  };

  const openRefundDialog = (order) => {
    if (!order) return;
    const remaining = Math.max(
      0,
      Math.round((Number(order.amount || 0) - Number(order.refundedAmount || 0)) * 100) / 100
    );
    setPendingRefundOrderId(String(order._id));
    setRefundAmountInput(remaining > 0 ? String(remaining) : '');
    setRefundReasonInput('');
    setRefundSpeedInput('normal');
  };

  const closeRefundDialog = () => {
    if (isProcessingRefund) return;
    setPendingRefundOrderId('');
    setRefundAmountInput('');
    setRefundReasonInput('');
    setRefundSpeedInput('normal');
  };

  const submitRefund = async () => {
    if (!pendingRefundOrderId) return;

    const amountNumber = Number(refundAmountInput);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      toast.error('Enter a positive refund amount');
      return;
    }

    setIsProcessingRefund(true);
    try {
      const idempotencyKey = `refund-${pendingRefundOrderId}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      const response = await axios.post(
        `${ORDER_API_BASE}/${pendingRefundOrderId}/refund`,
        {
          amount: amountNumber,
          reason: refundReasonInput.trim(),
          speed: refundSpeedInput,
          notes: {},
        },
        { headers: { token, 'idempotency-key': idempotencyKey } }
      );

      if (response.data.success) {
        toast.success(response.data.message || 'Refund initiated');
        if (response.data.order) {
          setOrders((current) => upsertOrderById(current, response.data.order));
        } else {
          await fetchAllOrders({ silent: true });
        }
        closeRefundDialog();
        return;
      }

      toast.error(response.data.message || 'Refund failed');
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message || 'Refund failed');
    } finally {
      setIsProcessingRefund(false);
    }
  };

  const pendingRefundOrder = useMemo(
    () => orders.find((order) => String(order._id) === pendingRefundOrderId) || null,
    [orders, pendingRefundOrderId]
  );

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

  // === Support-friendly UI state (added by refactor) ===
  const [expandedOrderIds, setExpandedOrderIds] = useState(() => new Set());
  const [showOperations, setShowOperations] = useState(false);
  const [sortField, setSortField] = useState('newest');
  const [orderTabById, setOrderTabById] = useState({});

  const toggleOrderExpanded = useCallback((orderId) => {
    setExpandedOrderIds((current) => {
      const next = new Set(current);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  }, []);

  const setOrderTab = useCallback((orderId, tabId) => {
    setOrderTabById((current) => ({ ...current, [orderId]: tabId }));
  }, []);

  const handleCopyOrderId = useCallback((orderId) => {
    if (!orderId) {
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(String(orderId)).then(
        () => toast.success('Order ID copied'),
        () => toast.error('Could not copy ID')
      );
    }
  }, []);

  const visibleOrdersSorted = useMemo(() => {
    const list = [...visibleOrders];
    switch (sortField) {
      case 'oldest':
        return list.sort((a, b) => Number(a.date || 0) - Number(b.date || 0));
      case 'amount-desc':
        return list.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
      case 'amount-asc':
        return list.sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));
      case 'newest':
      default:
        return list.sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
    }
  }, [visibleOrders, sortField]);

  const statusCounts = useMemo(() => {
    const counts = {};
    for (const status of orderStatusOptions) {
      counts[status] = 0;
    }
    for (const order of orders) {
      if (counts[order.status] !== undefined) {
        counts[order.status] += 1;
      }
    }
    return counts;
  }, [orders]);

  const inProgressCount = useMemo(
    () => orders.filter((order) => !['Delivered', 'Cancelled'].includes(order.status)).length,
    [orders]
  );
  const deliveredCount = useMemo(
    () => orders.filter((order) => order.status === 'Delivered').length,
    [orders]
  );
  const awaitingPaymentCount = useMemo(() => orders.filter((order) => !order.payment).length, [orders]);

  const hasActiveFilters = search.trim() !== '' || statusFilter !== 'all' || shiprocketAuditFilter !== 'all';
  const clearAllFilters = useCallback(() => {
    setSearch('');
    setStatusFilter('all');
    setShiprocketAuditFilter('all');
  }, []);

  const STAGE_TIMELINE = ['Order Placed', 'Packing', 'Shipped', 'Out for delivery', 'Delivered'];

  const kpiCards = [
    {
      key: 'all',
      label: 'Total orders',
      value: orders.length,
      subtitle: 'All time',
      accent: 'slate',
      onClick: () => clearAllFilters(),
      isActive: statusFilter === 'all' && shiprocketAuditFilter === 'all' && search.trim() === '',
    },
    {
      key: 'inprogress',
      label: 'In progress',
      value: inProgressCount,
      subtitle: 'Awaiting fulfillment',
      accent: 'amber',
      onClick: null,
    },
    {
      key: 'delivered',
      label: 'Delivered',
      value: deliveredCount,
      subtitle: 'Completed orders',
      accent: 'emerald',
      onClick: () => {
        setStatusFilter('Delivered');
        setShiprocketAuditFilter('all');
        setSearch('');
      },
      isActive: statusFilter === 'Delivered',
    },
    {
      key: 'awaiting',
      label: 'Awaiting payment',
      value: awaitingPaymentCount,
      subtitle: 'Unpaid orders',
      accent: 'sky',
      onClick: null,
    },
    {
      key: 'alerts',
      label: 'Shiprocket alerts',
      value: shiprocketAuditCounts.alertCount,
      subtitle: `${shiprocketAuditCounts.mismatchCount} mismatch Â· ${shiprocketAuditCounts.warningCount} warning`,
      accent: shiprocketAuditCounts.alertCount > 0 ? 'rose' : 'emerald',
      onClick: () => {
        setShiprocketAuditFilter('alerts');
        setStatusFilter('all');
        setSearch('');
      },
      isActive: shiprocketAuditFilter === 'alerts',
    },
  ];

  const accentClassMap = {
    slate: { ring: 'ring-slate-300', text: 'text-slate-900', dot: 'bg-slate-400' },
    amber: { ring: 'ring-amber-300', text: 'text-amber-700', dot: 'bg-amber-500' },
    emerald: { ring: 'ring-emerald-300', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    sky: { ring: 'ring-sky-300', text: 'text-sky-700', dot: 'bg-sky-500' },
    rose: { ring: 'ring-rose-300', text: 'text-rose-700', dot: 'bg-rose-500' },
  };

  return (
    <div className='flex flex-col gap-5'>
      {/* Hero strip: title, live status, primary actions, alerts banner */}
      <section className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
        <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
          <div>
            <p className='text-[11px] uppercase tracking-[0.28em] text-slate-400'>Support workspace</p>
            <h2 className='mt-1 text-xl font-semibold text-slate-900'>Order operations console</h2>
            <p className='mt-1 max-w-xl text-sm text-slate-500'>
              Triage every incoming order, update fulfillment, and audit Shiprocket pricing â€” all from one place.
            </p>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
                liveUpdatesStatus.status === 'connected'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : liveUpdatesStatus.status === 'connecting'
                    ? 'border-sky-200 bg-sky-50 text-sky-800'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}
              title={liveUpdatesStatus.message || 'Live updates status'}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  liveUpdatesStatus.status === 'connected'
                    ? 'animate-pulse bg-emerald-500'
                    : liveUpdatesStatus.status === 'connecting'
                      ? 'animate-pulse bg-sky-500'
                      : 'bg-slate-400'
                }`}
              />
              {liveUpdatesStatus.status === 'connected'
                ? 'Live updates on'
                : liveUpdatesStatus.status === 'connecting'
                  ? 'Connecting...'
                  : liveUpdatesStatus.status === 'disabled'
                    ? 'Live updates off'
                    : 'Live updates disconnected'}
            </span>
            <button
              type='button'
              onClick={() => {
                fetchAllOrders();
                fetchShiprocketBulkVerifyJob({ silent: true });
              }}
              className='rounded-full border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50'
            >
              Refresh
            </button>
            <button
              type='button'
              onClick={() => setShowOperations((value) => !value)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                showOperations
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {showOperations ? 'Hide ops tools' : 'Open ops tools'}
            </button>
          </div>
        </div>

        {shiprocketAuditCounts.alertCount > 0 ? (
          <button
            type='button'
            onClick={() => {
              setShiprocketAuditFilter('alerts');
              setStatusFilter('all');
              setSearch('');
            }}
            className='mt-4 flex w-full items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-left text-sm text-rose-800 transition hover:bg-rose-100'
          >
            <span className='flex items-center gap-3'>
              <span className='inline-flex h-7 w-7 items-center justify-center rounded-full bg-rose-100 text-sm font-semibold text-rose-700'>
                !
              </span>
              <span>
                <span className='font-semibold'>{shiprocketAuditCounts.alertCount}</span> order
                {shiprocketAuditCounts.alertCount === 1 ? '' : 's'} need Shiprocket review
                <span className='ml-1 text-rose-600'>
                  ({shiprocketAuditCounts.mismatchCount} mismatch Â· {shiprocketAuditCounts.warningCount} warning)
                </span>
              </span>
            </span>
            <span className='shrink-0 text-xs font-semibold uppercase tracking-[0.18em]'>Filter â†’</span>
          </button>
        ) : null}
      </section>

      {/* KPI strip â€” clickable filters */}
      <section className='grid gap-3 sm:grid-cols-2 xl:grid-cols-5'>
        {kpiCards.map((card) => {
          const accent = accentClassMap[card.accent];
          const clickable = typeof card.onClick === 'function';
          return (
            <button
              key={card.key}
              type='button'
              disabled={!clickable}
              onClick={card.onClick || undefined}
              className={`group rounded-2xl border bg-white p-4 text-left shadow-sm transition disabled:cursor-default ${
                card.isActive
                  ? `border-transparent ring-2 ${accent.ring}`
                  : clickable
                    ? 'border-slate-200 hover:border-slate-300 hover:shadow-md'
                    : 'border-slate-200'
              }`}
            >
              <div className='flex items-center justify-between gap-2'>
                <p className='text-[11px] uppercase tracking-[0.22em] text-slate-500'>{card.label}</p>
                <span className={`h-2 w-2 rounded-full ${accent.dot}`} />
              </div>
              <p className={`mt-3 text-3xl font-semibold tracking-tight ${accent.text}`}>{card.value}</p>
              <p className='mt-1 text-xs text-slate-500'>{card.subtitle}</p>
            </button>
          );
        })}
      </section>

      {/* Operations drawer */}
      {showOperations ? (
        <section className='grid gap-4 xl:grid-cols-[1.05fr_0.95fr]'>
          {/* Bulk verify control */}
          <article className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
              <div>
                <p className='text-base font-semibold text-slate-900'>Bulk live verification</p>
                <p className='mt-1 text-sm text-slate-500'>
                  Verify high-risk Shiprocket orders in the background with paced rate limits.
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${shiprocketBulkVerifyBadge.className}`}
              >
                {shiprocketBulkVerifyBadge.label}
              </span>
            </div>

            <div className='mt-4 grid gap-3 md:grid-cols-3'>
              <label className='text-sm text-slate-600'>
                <span className='mb-1.5 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>Scope</span>
                <select
                  value={shiprocketBulkVerifyConfig.scope}
                  onChange={(event) => setShiprocketBulkVerifyConfigField('scope', event.target.value)}
                  disabled={shiprocketBulkVerifyJob?.status === 'running'}
                  className='w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60'
                >
                  <option value='high_risk'>High-risk alerts</option>
                  <option value='not_verified'>Not verified yet</option>
                  <option value='all_synced'>All synced orders</option>
                </select>
              </label>

              <label className='text-sm text-slate-600'>
                <span className='mb-1.5 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>Batch limit</span>
                <input
                  value={shiprocketBulkVerifyConfig.limit}
                  onChange={(event) => setShiprocketBulkVerifyConfigField('limit', event.target.value)}
                  disabled={shiprocketBulkVerifyJob?.status === 'running'}
                  className='w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60'
                  type='number'
                  min='1'
                  max='500'
                  inputMode='numeric'
                />
              </label>

              <label className='text-sm text-slate-600'>
                <span className='mb-1.5 block text-[11px] uppercase tracking-[0.18em] text-slate-400'>Reqs / minute</span>
                <input
                  value={shiprocketBulkVerifyConfig.requestsPerMinute}
                  onChange={(event) => setShiprocketBulkVerifyConfigField('requestsPerMinute', event.target.value)}
                  disabled={shiprocketBulkVerifyJob?.status === 'running'}
                  className='w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60'
                  type='number'
                  min='1'
                  max='180'
                  inputMode='numeric'
                />
              </label>
            </div>

            <div className='mt-4 flex flex-wrap gap-2'>
              <button
                type='button'
                onClick={handleStartShiprocketBulkVerify}
                disabled={isStartingBulkVerify || shiprocketBulkVerifyJob?.status === 'running'}
                className='rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60'
              >
                {isStartingBulkVerify
                  ? 'Starting...'
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
                className='rounded-xl border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-60'
              >
                {isCancellingBulkVerify
                  ? 'Cancelling...'
                  : shiprocketBulkVerifyJob?.isCancelling
                    ? 'Cancellation requested'
                    : 'Cancel run'}
              </button>
              <button
                type='button'
                onClick={() => fetchShiprocketBulkVerifyJob()}
                className='rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50'
              >
                Refresh status
              </button>
              <button
                type='button'
                onClick={handleShiprocketBackfill}
                disabled={isBackfillingSnapshots || shiprocketAuditCounts.missingSnapshotCount === 0}
                className='rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-60'
              >
                {isBackfillingSnapshots
                  ? 'Backfilling...'
                  : shiprocketAuditCounts.missingSnapshotCount > 0
                    ? `Backfill snapshots (${shiprocketAuditCounts.missingSnapshotCount})`
                    : 'Backfill snapshots'}
              </button>
            </div>
          </article>

          {/* Verification progress */}
          <article className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
            <div className='flex items-start justify-between gap-3'>
              <div>
                <p className='text-base font-semibold text-slate-900'>Verification progress</p>
                <p className='mt-1 text-sm text-slate-500'>
                  Persisted server-side; refreshes keep the current run visible.
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${shiprocketBulkVerifyBadge.className}`}
              >
                {shiprocketBulkVerifyBadge.label}
              </span>
            </div>

            <div className='mt-4 rounded-2xl bg-slate-50 p-4'>
              <div className='flex items-center justify-between gap-3 text-sm'>
                <span className='text-slate-500'>Processed</span>
                <span className='font-semibold text-slate-900'>
                  {Number(shiprocketBulkVerifyJob?.progress?.processedCount || 0)} /{' '}
                  {Number(shiprocketBulkVerifyJob?.progress?.totalCount || 0)}
                </span>
              </div>
              <div className='mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200'>
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    shiprocketBulkVerifyJob?.status === 'failed'
                      ? 'bg-rose-500'
                      : shiprocketBulkVerifyJob?.status === 'completed'
                        ? 'bg-emerald-500'
                        : 'bg-slate-900'
                  }`}
                  style={{
                    width: `${Math.max(0, Math.min(100, Number(shiprocketBulkVerifyJob?.progress?.percentComplete || 0)))}%`,
                  }}
                />
              </div>
              <p className='mt-2 text-[11px] uppercase tracking-[0.18em] text-slate-400'>
                {Number(shiprocketBulkVerifyJob?.progress?.percentComplete || 0)}% complete
              </p>
            </div>

            <div className='mt-3 grid gap-2 grid-cols-2 sm:grid-cols-4'>
              <div className='rounded-xl bg-emerald-50 px-3 py-2'>
                <p className='text-[10px] uppercase tracking-[0.18em] text-emerald-700'>Clear</p>
                <p className='mt-1 text-lg font-semibold text-emerald-900'>
                  {Number(shiprocketBulkVerifyJob?.progress?.clearCount || 0)}
                </p>
              </div>
              <div className='rounded-xl bg-amber-50 px-3 py-2'>
                <p className='text-[10px] uppercase tracking-[0.18em] text-amber-700'>Warning</p>
                <p className='mt-1 text-lg font-semibold text-amber-900'>
                  {Number(shiprocketBulkVerifyJob?.progress?.warningCount || 0)}
                </p>
              </div>
              <div className='rounded-xl bg-rose-50 px-3 py-2'>
                <p className='text-[10px] uppercase tracking-[0.18em] text-rose-700'>Mismatch</p>
                <p className='mt-1 text-lg font-semibold text-rose-900'>
                  {Number(shiprocketBulkVerifyJob?.progress?.mismatchCount || 0)}
                </p>
              </div>
              <div className='rounded-xl bg-slate-100 px-3 py-2'>
                <p className='text-[10px] uppercase tracking-[0.18em] text-slate-600'>Failed</p>
                <p className='mt-1 text-lg font-semibold text-slate-900'>
                  {Number(shiprocketBulkVerifyJob?.progress?.failedCount || 0)}
                </p>
              </div>
            </div>

            <div className='mt-3 grid gap-3 md:grid-cols-2'>
              <div className='rounded-xl border border-slate-200 px-3 py-3 text-xs text-slate-600'>
                <p className='text-[10px] uppercase tracking-[0.18em] text-slate-400'>Run context</p>
                <p className='mt-1 font-semibold text-slate-900'>
                  {formatEnumLabel(shiprocketBulkVerifyJob?.config?.scope, 'High risk')}
                </p>
                <p className='mt-1'>Started {formatDateTime(shiprocketBulkVerifyJob?.startedAt)}</p>
                <p>Finished {formatDateTime(shiprocketBulkVerifyJob?.finishedAt)}</p>
                <p>
                  Pacing {Number(shiprocketBulkVerifyJob?.config?.requestsPerMinute || 0)} req
                  {Number(shiprocketBulkVerifyJob?.config?.requestsPerMinute || 0) === 1 ? '' : 's'}/min
                </p>
                {shiprocketBulkVerifyJob?.cancelRequestedAt ? (
                  <p className='mt-1 text-amber-700'>
                    Cancel requested {formatDateTime(shiprocketBulkVerifyJob.cancelRequestedAt)}
                  </p>
                ) : null}
              </div>
              <div className='rounded-xl border border-slate-200 px-3 py-3 text-xs text-slate-600'>
                <p className='text-[10px] uppercase tracking-[0.18em] text-slate-400'>Current order</p>
                <p className='mt-1 font-semibold text-slate-900'>
                  {shiprocketBulkVerifyJob?.progress?.currentReferenceOrderId ||
                    shiprocketBulkVerifyJob?.progress?.currentOrderId ||
                    'No active order'}
                </p>
                <p className='mt-1'>
                  Last {shiprocketBulkVerifyJob?.progress?.lastProcessedOrderId || 'none'}
                </p>
                <p>By {shiprocketBulkVerifyJob?.requestedBy || 'Admin'}</p>
                {shiprocketBulkVerifyJob?.error ? (
                  <p className='mt-1 text-rose-600'>{shiprocketBulkVerifyJob.error}</p>
                ) : null}
                {shiprocketBulkVerifyJob?.isStale ? (
                  <p className='mt-1 text-amber-600'>Run looks stale. Refresh status or start fresh.</p>
                ) : null}
                {shiprocketBulkVerifyJob?.progress?.statusNote ? (
                  <p className='mt-1 text-sky-700'>{shiprocketBulkVerifyJob.progress.statusNote}</p>
                ) : null}
              </div>
            </div>

            {Array.isArray(shiprocketBulkVerifyJob?.progress?.recentFailures) &&
            shiprocketBulkVerifyJob.progress.recentFailures.length > 0 ? (
              <div className='mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-800'>
                <p className='text-[10px] uppercase tracking-[0.18em] text-rose-600'>Recent failures</p>
                <div className='mt-2 space-y-1.5'>
                  {shiprocketBulkVerifyJob.progress.recentFailures.map((failure) => (
                    <div
                      key={`${failure.orderId}-${failure.referenceOrderId}`}
                      className='rounded-lg bg-white px-2.5 py-2'
                    >
                      <p className='font-semibold text-slate-900'>
                        {failure.referenceOrderId || failure.orderId}
                      </p>
                      <p className='mt-0.5 text-rose-700'>{failure.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </article>
        </section>
      ) : null}

      {/* Sticky filter toolbar */}
      <section className='sticky top-0 z-20 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur'>
        <div className='grid gap-2 lg:grid-cols-[1.7fr_repeat(3,minmax(0,1fr))]'>
          <div className='relative'>
            <span className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400'>
              <svg width='16' height='16' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
                <path
                  d='M11 4a7 7 0 1 1-4.95 11.95l-3.79 3.79-1.42-1.42 3.79-3.79A7 7 0 0 1 11 4Zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z'
                  fill='currentColor'
                />
              </svg>
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              type='text'
              placeholder='Search by customer, order ID, Shiprocket ref, or issue code'
              className='w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-9 text-sm focus:border-slate-500 focus:outline-none'
            />
            {search ? (
              <button
                type='button'
                onClick={() => setSearch('')}
                className='absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                aria-label='Clear search'
              >
                <svg width='14' height='14' viewBox='0 0 24 24' fill='none'>
                  <path d='M6 6l12 12M18 6L6 18' stroke='currentColor' strokeWidth='2' strokeLinecap='round' />
                </svg>
              </button>
            ) : null}
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className='rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700'
          >
            <option value='all'>All statuses ({orders.length})</option>
            {orderStatusOptions.map((status) => (
              <option key={status} value={status}>
                {status} ({statusCounts[status] || 0})
              </option>
            ))}
          </select>
          <select
            value={shiprocketAuditFilter}
            onChange={(event) => setShiprocketAuditFilter(event.target.value)}
            className='rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700'
          >
            <option value='all'>All Shiprocket states</option>
            <option value='alerts'>Alerts ({shiprocketAuditCounts.alertCount})</option>
            <option value='mismatch'>Mismatch ({shiprocketAuditCounts.mismatchCount})</option>
            <option value='warning'>Needs review ({shiprocketAuditCounts.warningCount})</option>
            <option value='clear'>Verified ({shiprocketAuditCounts.clearCount})</option>
          </select>
          <select
            value={sortField}
            onChange={(event) => setSortField(event.target.value)}
            className='rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-700'
          >
            <option value='newest'>Newest first</option>
            <option value='oldest'>Oldest first</option>
            <option value='amount-desc'>Highest amount</option>
            <option value='amount-asc'>Lowest amount</option>
          </select>
        </div>
        <div className='mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500'>
          <span>
            Showing <span className='font-semibold text-slate-900'>{visibleOrdersSorted.length}</span> of{' '}
            {orders.length} orders
          </span>
          <div className='flex items-center gap-3'>
            {hasActiveFilters ? (
              <button type='button' onClick={clearAllFilters} className='font-semibold text-slate-700 hover:underline'>
                Clear filters
              </button>
            ) : null}
            {expandedOrderIds.size > 0 ? (
              <button
                type='button'
                onClick={() => setExpandedOrderIds(new Set())}
                className='font-semibold text-slate-700 hover:underline'
              >
                Collapse all
              </button>
            ) : null}
            {visibleOrdersSorted.length > 0 && expandedOrderIds.size < visibleOrdersSorted.length ? (
              <button
                type='button'
                onClick={() =>
                  setExpandedOrderIds(new Set(visibleOrdersSorted.map((order) => String(order._id))))
                }
                className='font-semibold text-slate-700 hover:underline'
              >
                Expand all
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {/* Orders list */}
      <section className='space-y-3'>
        {isLoading ? (
          <div className='ui-loading-state'>Loading orders...</div>
        ) : visibleOrdersSorted.length === 0 ? (
          <div className='rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm'>
            <p className='font-medium text-slate-700'>No orders match the current filters.</p>
            <p className='mt-1'>Try clearing the search or selecting a different status.</p>
            {hasActiveFilters ? (
              <button
                type='button'
                onClick={clearAllFilters}
                className='mt-4 rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50'
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          visibleOrdersSorted.map((order) => {
            const orderIdString = String(order._id);
            const isExpanded = expandedOrderIds.has(orderIdString);
            const customerName =
              `${order.address?.firstName || ''} ${order.address?.lastName || ''}`.trim() || 'Customer';
            const shiprocketAudit = resolveOrderShiprocketAudit(order);
            const shiprocketAuditBadge = getShiprocketAuditBadge(shiprocketAudit);
            const expectedShiprocket = shiprocketAudit.expectedShiprocket || {};
            const storedShiprocketSnapshot = shiprocketAudit.storedShiprocketSnapshot || null;
            const liveVerification = shiprocketAudit.liveVerification || {};
            const liveShiprocketSnapshot = liveVerification.snapshot || null;
            const activeShiprocketAction = shiprocketActionByOrderId[order._id] || '';
            const canVerifyLive = Boolean(order.shiprocket?.orderId);
            const tab = orderTabById[orderIdString] || 'customer';
            const accentBarClass =
              order.status === 'Cancelled'
                ? 'bg-rose-400'
                : order.status === 'Delivered'
                  ? 'bg-emerald-400'
                  : ['Shipped', 'Out for delivery'].includes(order.status)
                    ? 'bg-sky-400'
                    : order.status === 'Packing'
                      ? 'bg-amber-400'
                      : 'bg-slate-300';
            const stageIndex = order.status === 'Cancelled' ? -1 : STAGE_TIMELINE.indexOf(order.status);
            const totalItemsCount = order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
            const fullAddressForMaps = [
              order.address?.street,
              order.address?.city,
              order.address?.state,
              order.address?.pincode,
              order.address?.country,
            ]
              .filter(Boolean)
              .join(', ');
            const showShiprocketBadge =
              shiprocketAudit.hasMismatch ||
              shiprocketAudit.hasWarning ||
              (shiprocketAudit.syncStatus && shiprocketAudit.syncStatus !== 'not_required');

            return (
              <article
                key={order._id}
                className={`relative overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-300 ${
                  highlightedOrderId === orderIdString
                    ? 'border-sky-300 ring-2 ring-sky-200'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className={`absolute left-0 top-0 h-full w-1 ${accentBarClass}`} aria-hidden='true' />

                {/* Compact header row */}
                <div className='flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between'>
                  <div className='flex min-w-0 flex-1 flex-col gap-2'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <button
                        type='button'
                        onClick={() => handleCopyOrderId(order._id)}
                        title='Copy full order ID'
                        className='inline-flex items-center gap-1 rounded-md text-base font-semibold text-slate-900 hover:text-slate-600'
                      >
                        #{order._id.slice(-8).toUpperCase()}
                        <svg
                          width='12'
                          height='12'
                          viewBox='0 0 24 24'
                          fill='none'
                          className='text-slate-400'
                          aria-hidden='true'
                        >
                          <path
                            d='M8 4h10a2 2 0 0 1 2 2v12h-2V6H8V4Zm-4 4h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Zm0 2v10h10V10H4Z'
                            fill='currentColor'
                          />
                        </svg>
                      </button>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${getStatusClasses(
                          order.status
                        )}`}
                      >
                        {order.status}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${getPaymentBadgeClass(order)}`}
                      >
                        {getPaymentLabel(order)}
                      </span>
                      <span className='rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-700'>
                        {order.paymentMethod}
                      </span>
                      {showShiprocketBadge ? (
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${shiprocketAuditBadge.className}`}
                        >
                          {shiprocketAuditBadge.label}
                        </span>
                      ) : null}
                    </div>
                    <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600'>
                      <span className='font-medium text-slate-900'>{customerName}</span>
                      {order.address?.city ? (
                        <span>
                          {order.address.city}
                          {order.address?.state ? `, ${order.address.state}` : ''}
                        </span>
                      ) : null}
                      <span>
                        {totalItemsCount} item{totalItemsCount === 1 ? '' : 's'}
                      </span>
                      <span>{formatDate(order.date)}</span>
                    </div>
                  </div>

                  <div className='flex shrink-0 flex-wrap items-center gap-2'>
                    <div className='text-right'>
                      <p className='text-[10px] uppercase tracking-[0.18em] text-slate-400'>Order total</p>
                      <p className='text-lg font-semibold text-slate-900'>{formatCurrency(order.amount)}</p>
                    </div>
                    <select
                      onChange={(event) => statusHandler(event, order._id)}
                      value={order.status}
                      disabled={updatingOrderId === order._id}
                      className='rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60'
                    >
                      {getAvailableStatusOptions(order).map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                    <button
                      type='button'
                      onClick={() => toggleOrderExpanded(orderIdString)}
                      aria-expanded={isExpanded}
                      className='inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50'
                    >
                      {isExpanded ? 'Hide details' : 'View details'}
                      <svg
                        width='12'
                        height='12'
                        viewBox='0 0 24 24'
                        fill='none'
                        className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        aria-hidden='true'
                      >
                        <path
                          d='M6 9l6 6 6-6'
                          stroke='currentColor'
                          strokeWidth='2'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Mini timeline */}
                {order.status !== 'Cancelled' ? (
                  <div className='border-t border-slate-100 px-5 py-3'>
                    <div className='flex items-center gap-1.5'>
                      {STAGE_TIMELINE.map((stage, idx) => {
                        const reached = idx <= stageIndex;
                        const current = idx === stageIndex;
                        return (
                          <div key={stage} className='flex flex-1 items-center gap-1.5'>
                            <div className='flex flex-col items-center gap-1'>
                              <span
                                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                                  reached
                                    ? current
                                      ? 'bg-slate-900 text-white ring-4 ring-slate-200'
                                      : 'bg-slate-900 text-white'
                                    : 'bg-slate-100 text-slate-400'
                                }`}
                              >
                                {reached ? 'âœ“' : idx + 1}
                              </span>
                              <span
                                className={`hidden text-[10px] uppercase tracking-[0.14em] sm:block ${
                                  reached ? 'text-slate-700' : 'text-slate-400'
                                }`}
                              >
                                {stage}
                              </span>
                            </div>
                            {idx < STAGE_TIMELINE.length - 1 ? (
                              <span
                                className={`mx-0.5 h-[2px] flex-1 rounded-full ${
                                  idx < stageIndex ? 'bg-slate-900' : 'bg-slate-200'
                                }`}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className='border-t border-slate-100 bg-rose-50/50 px-5 py-2 text-xs text-rose-700'>
                    {getCancellationBanner(order)}
                  </div>
                )}

                {/* Expanded panel */}
                {isExpanded ? (
                  <div className='border-t border-slate-200 bg-slate-50/50'>
                    <div className='flex items-center gap-1 border-b border-slate-200 bg-white px-5'>
                      {[
                        { id: 'customer', label: 'Customer & Items' },
                        { id: 'payment', label: 'Payment' },
                        {
                          id: 'shiprocket',
                          label: shiprocketAudit.hasMismatch
                            ? 'Shiprocket âš '
                            : shiprocketAudit.hasWarning
                              ? 'Shiprocket â€¢'
                              : 'Shiprocket',
                        },
                      ].map((tabItem) => (
                        <button
                          key={tabItem.id}
                          type='button'
                          onClick={() => setOrderTab(orderIdString, tabItem.id)}
                          className={`relative px-3 py-3 text-sm font-medium transition ${
                            tab === tabItem.id ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          {tabItem.label}
                          {tab === tabItem.id ? (
                            <span className='absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-slate-900' />
                          ) : null}
                        </button>
                      ))}
                    </div>

                    <div className='px-5 py-5'>
                      {tab === 'customer' ? (
                        <div className='grid gap-4 lg:grid-cols-[1.1fr_0.9fr]'>
                          <div className='rounded-2xl border border-slate-200 bg-white p-4'>
                            <div className='flex items-center justify-between'>
                              <p className='text-sm font-semibold text-slate-900'>Ordered items</p>
                              <span className='text-xs text-slate-500'>
                                {order.items.length} line{order.items.length === 1 ? '' : 's'}
                              </span>
                            </div>
                            <div className='mt-3 space-y-2'>
                              {order.items.map((item, index) => (
                                <div
                                  key={`${order._id}-${index}`}
                                  className='flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-2.5'
                                >
                                  {getItemImageUrl(item) ? (
                                    <img
                                      src={getItemImageUrl(item)}
                                      alt={item.name}
                                      className='h-12 w-10 rounded-lg border border-white object-cover shadow-sm'
                                    />
                                  ) : (
                                    <div className='flex h-12 w-10 items-center justify-center rounded-lg bg-white text-[9px] uppercase tracking-[0.12em] text-slate-400'>
                                      No img
                                    </div>
                                  )}
                                  <div className='min-w-0 flex-1'>
                                    <p className='truncate text-sm font-medium text-slate-900'>{item.name}</p>
                                    <p className='text-xs text-slate-500'>
                                      Size {item.size || 'â€”'} Â· {formatCurrency(item.price)}
                                    </p>
                                  </div>
                                  <div className='shrink-0 text-right'>
                                    <p className='text-sm font-semibold text-slate-900'>Ã—{item.quantity}</p>
                                    <p className='text-xs text-slate-500'>
                                      {formatCurrency(Number(item.price || 0) * Number(item.quantity || 0))}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className='rounded-2xl border border-slate-200 bg-white p-4'>
                            <p className='text-sm font-semibold text-slate-900'>Customer & delivery</p>
                            <div className='mt-3 space-y-3 text-sm'>
                              <div>
                                <p className='text-[10px] uppercase tracking-[0.18em] text-slate-400'>Name</p>
                                <p className='mt-0.5 font-medium text-slate-900'>{customerName}</p>
                              </div>
                              <div>
                                <p className='text-[10px] uppercase tracking-[0.18em] text-slate-400'>
                                  Shipping address
                                </p>
                                <p className='mt-0.5 leading-6 text-slate-700'>
                                  {order.address?.street}
                                  <br />
                                  {order.address?.city}
                                  {order.address?.city && order.address?.state ? ', ' : ''}
                                  {order.address?.state} {order.address?.pincode}
                                  <br />
                                  {order.address?.country}
                                </p>
                                {fullAddressForMaps ? (
                                  <a
                                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddressForMaps)}`}
                                    target='_blank'
                                    rel='noopener noreferrer'
                                    className='mt-2 inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline'
                                  >
                                    Open in Maps â†’
                                  </a>
                                ) : null}
                              </div>
                              {order.address?.phone ? (
                                <div className='flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2'>
                                  <div>
                                    <p className='text-[10px] uppercase tracking-[0.18em] text-slate-400'>Phone</p>
                                    <p className='mt-0.5 font-medium text-slate-900'>{order.address.phone}</p>
                                  </div>
                                  <a
                                    href={`tel:${order.address.phone}`}
                                    className='rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100'
                                  >
                                    Call
                                  </a>
                                </div>
                              ) : null}
                              {order.address?.email ? (
                                <div className='flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2'>
                                  <div className='min-w-0'>
                                    <p className='text-[10px] uppercase tracking-[0.18em] text-slate-400'>Email</p>
                                    <p className='mt-0.5 truncate font-medium text-slate-900'>
                                      {order.address.email}
                                    </p>
                                  </div>
                                  <a
                                    href={`mailto:${order.address.email}`}
                                    className='shrink-0 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100'
                                  >
                                    Email
                                  </a>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {tab === 'payment' ? (
                        <div className='grid gap-4 lg:grid-cols-2'>
                          <div className='rounded-2xl border border-slate-200 bg-white p-4'>
                            <p className='text-sm font-semibold text-slate-900'>Payment status</p>
                            <div className='mt-3 grid grid-cols-2 gap-2'>
                              <div className='rounded-xl bg-slate-50 px-3 py-2.5'>
                                <p className='text-[10px] uppercase tracking-[0.18em] text-slate-400'>Status</p>
                                <p className='mt-1 text-sm font-semibold text-slate-900'>{getPaymentLabel(order)}</p>
                              </div>
                              <div className='rounded-xl bg-slate-50 px-3 py-2.5'>
                                <p className='text-[10px] uppercase tracking-[0.18em] text-slate-400'>Method</p>
                                <p className='mt-1 text-sm font-semibold text-slate-900'>{order.paymentMethod}</p>
                              </div>
                              <div className='rounded-xl bg-slate-50 px-3 py-2.5'>
                                <p className='text-[10px] uppercase tracking-[0.18em] text-slate-400'>Items</p>
                                <p className='mt-1 text-sm font-semibold text-slate-900'>{order.items.length}</p>
                              </div>
                              <div className='rounded-xl bg-slate-50 px-3 py-2.5'>
                                <p className='text-[10px] uppercase tracking-[0.18em] text-slate-400'>Placed</p>
                                <p className='mt-1 text-sm font-semibold text-slate-900'>{formatDate(order.date)}</p>
                              </div>
                            </div>

                            {order.paymentMethod === 'Razorpay' ? (
                              <div className='mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs'>
                                <div className='flex items-center justify-between gap-2'>
                                  <span className='text-slate-500'>Razorpay order</span>
                                  <span className='break-all font-mono text-[11px] text-slate-800'>
                                    {order.razorpayOrderId || '—'}
                                  </span>
                                </div>
                                <div className='flex items-center justify-between gap-2'>
                                  <span className='text-slate-500'>Razorpay payment</span>
                                  <span className='break-all font-mono text-[11px] text-slate-800'>
                                    {order.razorpayPaymentId || '—'}
                                  </span>
                                </div>
                                {order.paymentCapturedAt ? (
                                  <div className='flex items-center justify-between gap-2'>
                                    <span className='text-slate-500'>Captured at</span>
                                    <span className='text-slate-800'>{formatDateTime(order.paymentCapturedAt)}</span>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

                            {order.paymentMethod === 'Razorpay' && order.payment ? (
                              <div className='mt-3 flex flex-wrap items-center justify-between gap-2'>
                                <div className='text-xs text-slate-500'>
                                  Refunded {formatCurrency(order.refundedAmount || 0)} of {formatCurrency(order.amount)}
                                  {order.refundStatus && order.refundStatus !== 'none' ? (
                                    <span className='ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700'>
                                      {order.refundStatus}
                                    </span>
                                  ) : null}
                                </div>
                                {Number(order.refundedAmount || 0) < Number(order.amount || 0) - 0.01 ? (
                                  <button
                                    type='button'
                                    onClick={() => openRefundDialog(order)}
                                    className='rounded-full bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800'
                                  >
                                    Issue refund
                                  </button>
                                ) : (
                                  <span className='rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-800'>
                                    Fully refunded
                                  </span>
                                )}
                              </div>
                            ) : null}

                            {Array.isArray(order.refunds) && order.refunds.length > 0 ? (
                              <div className='mt-3 space-y-2'>
                                <p className='text-[10px] uppercase tracking-[0.18em] text-slate-400'>Refund history</p>
                                {order.refunds.map((refund) => (
                                  <div
                                    key={refund.refundId}
                                    className='rounded-xl border border-slate-200 bg-white p-2.5 text-xs'
                                  >
                                    <div className='flex items-center justify-between gap-2'>
                                      <span className='font-mono text-[11px] text-slate-700'>{refund.refundId}</span>
                                      <span
                                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                                          refund.status === 'processed'
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : refund.status === 'failed'
                                              ? 'bg-rose-100 text-rose-800'
                                              : 'bg-amber-100 text-amber-800'
                                        }`}
                                      >
                                        {refund.status}
                                      </span>
                                    </div>
                                    <div className='mt-1 flex items-center justify-between gap-2 text-slate-600'>
                                      <span>{formatCurrency(refund.amount)}</span>
                                      <span className='capitalize'>{refund.speed || 'normal'}</span>
                                    </div>
                                    {refund.reason ? (
                                      <p className='mt-1 text-slate-500'>Reason: {refund.reason}</p>
                                    ) : null}
                                    {refund.failureReason ? (
                                      <p className='mt-1 text-rose-700'>{refund.failureReason}</p>
                                    ) : null}
                                    <p className='mt-1 text-[10px] text-slate-400'>
                                      Initiated {formatDateTime(refund.createdAt)}
                                      {refund.processedAt ? ` • Processed ${formatDateTime(refund.processedAt)}` : ''}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <div className='rounded-2xl border border-slate-200 bg-white p-4'>
                            <p className='text-sm font-semibold text-slate-900'>Pricing breakdown</p>
                            <div className='mt-3 space-y-2 text-sm'>
                              <div className='flex items-center justify-between'>
                                <span className='text-slate-600'>Items subtotal</span>
                                <span className='font-medium text-slate-900'>
                                  {formatCurrency(shiprocketAudit.local?.itemsSubtotal)}
                                </span>
                              </div>
                              <div className='flex items-center justify-between'>
                                <span className='text-slate-600'>Discount</span>
                                <span className='font-medium text-rose-700'>
                                  -{formatCurrency(shiprocketAudit.local?.discountAmount)}
                                </span>
                              </div>
                              <div className='flex items-center justify-between'>
                                <span className='text-slate-600'>Shipping</span>
                                <span className='font-medium text-slate-900'>
                                  {formatCurrency(shiprocketAudit.local?.shippingCharges)}
                                </span>
                              </div>
                              <div className='mt-2 flex items-center justify-between border-t border-slate-200 pt-2'>
                                <span className='text-sm font-semibold text-slate-900'>Order total</span>
                                <span className='text-base font-semibold text-slate-900'>
                                  {formatCurrency(order.amount)}
                                </span>
                              </div>
                              {Number(order.refundedAmount || 0) > 0 ? (
                                <div className='flex items-center justify-between text-rose-700'>
                                  <span>Refunded</span>
                                  <span className='font-medium'>-{formatCurrency(order.refundedAmount)}</span>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {tab === 'shiprocket' ? (
                        <div className='space-y-4'>
                          <div className='flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-start sm:justify-between'>
                            <div>
                              <div className='flex items-center gap-2'>
                                <p className='text-[10px] uppercase tracking-[0.18em] text-slate-400'>Reference</p>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${shiprocketAuditBadge.className}`}
                                >
                                  {shiprocketAuditBadge.label}
                                </span>
                              </div>
                              <p className='mt-1 text-base font-semibold text-slate-900'>
                                {order.shiprocket?.referenceOrderId || 'Not assigned'}
                              </p>
                              <p className='mt-1 text-xs text-slate-500'>
                                {!order.shiprocket?.referenceOrderId
                                  ? 'No Shiprocket reference linked yet.'
                                  : shiprocketAudit.remoteOrderTracked
                                    ? 'Linked to a remote Shiprocket order.'
                                    : 'Reserved locally â€” Shiprocket sync still pending.'}
                              </p>
                            </div>
                            <div className='flex flex-col items-stretch gap-2 sm:items-end'>
                              <button
                                type='button'
                                onClick={() => verifyShiprocketPricingLive(order._id)}
                                disabled={!canVerifyLive || Boolean(activeShiprocketAction)}
                                className='rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60'
                              >
                                {activeShiprocketAction === 'verify_live' ? 'Verifyingâ€¦' : 'Verify live pricing'}
                              </button>
                              {!canVerifyLive ? (
                                <p className='text-[11px] text-slate-500 sm:text-right'>Sync to Shiprocket first.</p>
                              ) : null}
                            </div>
                          </div>

                          {order.status === 'Cancelled' && order.shiprocket?.orderId ? (
                            (() => {
                              const cancelStatus = String(order.shiprocket?.cancelStatus || '').toLowerCase();
                              const cancelStyle =
                                cancelStatus === 'cancelled'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                  : cancelStatus === 'failed'
                                    ? 'border-rose-200 bg-rose-50 text-rose-800'
                                    : cancelStatus === 'pending'
                                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                                      : 'border-slate-200 bg-slate-50 text-slate-700';
                              const cancelLabel =
                                cancelStatus === 'cancelled'
                                  ? 'Cancelled at Shiprocket'
                                  : cancelStatus === 'failed'
                                    ? 'Shiprocket cancel failed'
                                    : cancelStatus === 'pending'
                                      ? 'Shiprocket cancel pending'
                                      : 'Shiprocket cancel not requested';
                              return (
                                <div className={`rounded-2xl border px-4 py-3 text-sm ${cancelStyle}`}>
                                  <div className='flex flex-wrap items-center justify-between gap-2'>
                                    <p className='text-[10px] font-semibold uppercase tracking-[0.18em]'>
                                      {cancelLabel}
                                    </p>
                                    {order.shiprocket?.cancelledAt ? (
                                      <p className='text-[11px] opacity-80'>
                                        {formatDateTime(order.shiprocket.cancelledAt)}
                                      </p>
                                    ) : order.shiprocket?.cancelAttemptedAt ? (
                                      <p className='text-[11px] opacity-80'>
                                        Attempted {formatDateTime(order.shiprocket.cancelAttemptedAt)}
                                      </p>
                                    ) : null}
                                  </div>
                                  {order.shiprocket?.cancelError ? (
                                    <p className='mt-1 text-xs'>{order.shiprocket.cancelError}</p>
                                  ) : cancelStatus === 'cancelled' ? (
                                    <p className='mt-1 text-xs'>
                                      Shipment will not be dispatched. No further action needed.
                                    </p>
                                  ) : cancelStatus === 'pending' ? (
                                    <p className='mt-1 text-xs'>
                                      Awaiting confirmation from Shiprocket. Refresh the order in a moment.
                                    </p>
                                  ) : null}
                                </div>
                              );
                            })()
                          ) : null}

                          {order.status === 'Cancelled' && order.shiprocket?.orderId ? (
                            (() => {
                              const cancelStatus = String(order.shiprocket?.cancelStatus || '').toLowerCase();
                              const cancelStyle =
                                cancelStatus === 'cancelled'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                  : cancelStatus === 'failed'
                                    ? 'border-rose-200 bg-rose-50 text-rose-800'
                                    : cancelStatus === 'pending'
                                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                                      : 'border-slate-200 bg-slate-50 text-slate-700';
                              const cancelLabel =
                                cancelStatus === 'cancelled'
                                  ? 'Cancelled at Shiprocket'
                                  : cancelStatus === 'failed'
                                    ? 'Shiprocket cancel failed'
                                    : cancelStatus === 'pending'
                                      ? 'Shiprocket cancel pending'
                                      : 'Shiprocket cancel not requested';
                              return (
                                <div className={`rounded-2xl border px-4 py-3 text-sm ${cancelStyle}`}>
                                  <div className='flex flex-wrap items-center justify-between gap-2'>
                                    <p className='text-[10px] font-semibold uppercase tracking-[0.18em]'>
                                      {cancelLabel}
                                    </p>
                                    {order.shiprocket?.cancelledAt ? (
                                      <p className='text-[11px] opacity-80'>
                                        {formatDateTime(order.shiprocket.cancelledAt)}
                                      </p>
                                    ) : order.shiprocket?.cancelAttemptedAt ? (
                                      <p className='text-[11px] opacity-80'>
                                        Attempted {formatDateTime(order.shiprocket.cancelAttemptedAt)}
                                      </p>
                                    ) : null}
                                  </div>
                                  {order.shiprocket?.cancelError ? (
                                    <p className='mt-1 text-xs'>{order.shiprocket.cancelError}</p>
                                  ) : cancelStatus === 'cancelled' ? (
                                    <p className='mt-1 text-xs'>
                                      Shipment will not be dispatched. No further action needed.
                                    </p>
                                  ) : cancelStatus === 'pending' ? (
                                    <p className='mt-1 text-xs'>
                                      Awaiting confirmation from Shiprocket. Refresh the order in a moment.
                                    </p>
                                  ) : null}
                                </div>
                              );
                            })()
                          ) : null}

                          <div className='grid gap-3 lg:grid-cols-3'>
                            <div className='rounded-2xl border border-slate-200 bg-white p-4'>
                              <p className='text-[10px] uppercase tracking-[0.18em] text-slate-400'>
                                Expected payload
                              </p>
                              <p className='mt-1 text-base font-semibold text-slate-900'>
                                {formatCurrency(expectedShiprocket.derivedFinalAmount)}
                              </p>
                              <div className='mt-3 space-y-1 text-xs text-slate-600'>
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
                              </div>
                            </div>

                            <div className='rounded-2xl border border-slate-200 bg-white p-4'>
                              <div className='flex items-center justify-between'>
                                <p className='text-[10px] uppercase tracking-[0.18em] text-slate-400'>
                                  Stored snapshot
                                </p>
                                {storedShiprocketSnapshot ? (
                                  <span className='rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-600'>
                                    v{storedShiprocketSnapshot.formulaVersion || 2}
                                  </span>
                                ) : null}
                              </div>
                              {storedShiprocketSnapshot ? (
                                <>
                                  <p className='mt-1 text-base font-semibold text-slate-900'>
                                    {formatCurrency(storedShiprocketSnapshot.derivedFinalAmount)}
                                  </p>
                                  <div className='mt-3 space-y-1 text-xs text-slate-600'>
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
                                  </div>
                                  <p
                                    className={`mt-3 text-[11px] font-medium ${
                                      Math.abs(Number(storedShiprocketSnapshot.derivedFinalAmountDelta || 0)) > 0.01
                                        ? 'text-rose-600'
                                        : 'text-emerald-600'
                                    }`}
                                  >
                                    {Math.abs(Number(storedShiprocketSnapshot.derivedFinalAmountDelta || 0)) > 0.01
                                      ? `Î” ${formatCurrency(storedShiprocketSnapshot.derivedFinalAmountDelta)}`
                                      : 'Matches expected'}
                                  </p>
                                  <p className='mt-1 text-[11px] text-slate-500'>
                                    Captured {formatDateTime(storedShiprocketSnapshot.capturedAt)}
                                  </p>
                                </>
                              ) : (
                                <p className='mt-3 text-xs text-slate-500'>No snapshot stored yet.</p>
                              )}
                            </div>

                            <div className='rounded-2xl border border-slate-200 bg-white p-4'>
                              <div className='flex items-center justify-between'>
                                <p className='text-[10px] uppercase tracking-[0.18em] text-slate-400'>Live check</p>
                                <span className='rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-600'>
                                  {formatEnumLabel(liveVerification.status, 'Not verified')}
                                </span>
                              </div>
                              {liveShiprocketSnapshot ? (
                                <>
                                  <p className='mt-1 text-base font-semibold text-slate-900'>
                                    {formatCurrency(liveShiprocketSnapshot.derivedFinalAmount)}
                                  </p>
                                  <div className='mt-3 space-y-1 text-xs text-slate-600'>
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
                                  </div>
                                  <p
                                    className={`mt-3 text-[11px] font-medium ${
                                      Math.abs(Number(liveShiprocketSnapshot.derivedFinalAmountDelta || 0)) > 0.01
                                        ? 'text-rose-600'
                                        : 'text-emerald-600'
                                    }`}
                                  >
                                    {Math.abs(Number(liveShiprocketSnapshot.derivedFinalAmountDelta || 0)) > 0.01
                                      ? `Î” ${formatCurrency(liveShiprocketSnapshot.derivedFinalAmountDelta)}`
                                      : 'Matches expected'}
                                  </p>
                                  <p className='mt-1 text-[11px] text-slate-500'>
                                    {liveVerification.verifiedAt
                                      ? `Verified ${formatDateTime(liveVerification.verifiedAt)}`
                                      : 'Awaiting verification'}
                                  </p>
                                </>
                              ) : (
                                <p className='mt-3 text-xs text-slate-500'>
                                  {liveVerification.error ||
                                    'Run live verification to compare with Shiprocket directly.'}
                                </p>
                              )}
                            </div>
                          </div>

                          {shiprocketAudit.issues?.length > 0 ? (
                            <div className='space-y-2'>
                              {shiprocketAudit.issues.map((issue) => (
                                <div
                                  key={`${order._id}-${issue.code}`}
                                  className={`rounded-xl border px-3 py-3 text-sm ${getAuditIssueClasses(issue.severity)}`}
                                >
                                  <p className='text-[10px] font-semibold uppercase tracking-[0.18em]'>
                                    {issue.severity === 'error' ? 'Mismatch' : 'Review'}
                                  </p>
                                  <p className='mt-1'>{issue.message}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className='rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800'>
                              âœ“ Shiprocket pricing aligned with the current order breakdown.
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </section>

      <ConfirmDialog
        open={Boolean(pendingCancelOrderId)}
        title='Cancel this order?'
        description={
          pendingCancelOrderId
            ? `Cancelling #${orders.find((o) => o._id === pendingCancelOrderId)?.orderId || pendingCancelOrderId} releases inventory, reverses loyalty points, and cancels the shipment on Shiprocket if synced. This action cannot be undone.`
            : ''
        }
        confirmLabel='Yes, cancel order'
        cancelLabel='Keep order'
        destructive
        confirmDisabled={cancelReason === 'Other' && !cancelReasonNote.trim()}
        onCancel={() => {
          setPendingCancelOrderId(null);
          setCancelReason(ORDER_CANCEL_REASONS[0]);
          setCancelReasonNote('');
        }}
        onConfirm={confirmCancelOrder}
      >
        <div className='mt-2 space-y-3'>
          <label className='block text-sm font-medium text-slate-700'>
            Cancellation reason
            <select
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              className='mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm ui-focus-ring'
            >
              {ORDER_CANCEL_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          </label>
          {cancelReason === 'Other' ? (
            <label className='block text-sm font-medium text-slate-700'>
              Reason details
              <textarea
                value={cancelReasonNote}
                onChange={(event) => setCancelReasonNote(event.target.value)}
                className='mt-1 min-h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm ui-focus-ring'
                placeholder='Briefly describe the reason for cancellation.'
                maxLength={300}
                required
              />
            </label>
          ) : null}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(pendingRefundOrderId)}
        title='Issue Razorpay refund'
        description={
          pendingRefundOrder
            ? `Refunding ₹${Number(pendingRefundOrder.amount || 0).toLocaleString('en-IN')} order #${
                pendingRefundOrder.orderId || pendingRefundOrder._id
              }. Already refunded: ₹${Number(pendingRefundOrder.refundedAmount || 0).toLocaleString('en-IN')}.`
            : ''
        }
        confirmLabel={isProcessingRefund ? 'Refunding…' : 'Issue refund'}
        cancelLabel='Cancel'
        destructive
        confirmDisabled={isProcessingRefund || !refundAmountInput || Number(refundAmountInput) <= 0}
        onCancel={closeRefundDialog}
        onConfirm={submitRefund}
      >
        <div className='mt-2 space-y-3'>
          <label className='block text-sm font-medium text-slate-700'>
            Amount (INR)
            <input
              type='number'
              min='0'
              step='0.01'
              value={refundAmountInput}
              onChange={(event) => setRefundAmountInput(event.target.value)}
              className='mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm ui-focus-ring'
              disabled={isProcessingRefund}
              required
            />
          </label>
          <label className='block text-sm font-medium text-slate-700'>
            Speed
            <select
              value={refundSpeedInput}
              onChange={(event) => setRefundSpeedInput(event.target.value)}
              className='mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm ui-focus-ring'
              disabled={isProcessingRefund}
            >
              <option value='normal'>Normal (5–7 working days)</option>
              <option value='optimum'>Optimum (instant when available)</option>
            </select>
          </label>
          <label className='block text-sm font-medium text-slate-700'>
            Reason
            <textarea
              value={refundReasonInput}
              onChange={(event) => setRefundReasonInput(event.target.value)}
              className='mt-1 min-h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm ui-focus-ring'
              placeholder='Optional internal note shared with Razorpay.'
              maxLength={500}
              disabled={isProcessingRefund}
            />
          </label>
        </div>
      </ConfirmDialog>
    </div>
  );
};

export default Orders;
