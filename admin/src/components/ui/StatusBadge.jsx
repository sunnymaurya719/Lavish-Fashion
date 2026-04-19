import React from 'react';

/**
 * Single source of truth for status colors across the panel.
 * Maps every domain status used in pages (products, inventory, orders,
 * reviews, coupons, marketing) to a single tone palette.
 */
const STATUS_TONE = {
  // Product / catalog
  active: 'success',
  draft: 'neutral',
  archived: 'muted',

  // Inventory
  healthy: 'success',
  low_stock: 'warning',
  'low stock': 'warning',
  out_of_stock: 'danger',
  'out of stock': 'danger',

  // Orders
  'order placed': 'info',
  packing: 'info',
  shipped: 'info',
  'out for delivery': 'info',
  delivered: 'success',
  cancelled: 'danger',
  refunded: 'muted',

  // Payment
  paid: 'success',
  unpaid: 'warning',
  failed: 'danger',
  pending: 'warning',

  // Reviews
  published: 'success',
  rejected: 'danger',

  // Marketing / coupons
  live: 'success',
  scheduled: 'info',
  expired: 'muted',
  paused: 'warning',
  queued: 'info',
  sent: 'success',
};

const TONE_CLASSES = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-rose-200 bg-rose-50 text-rose-800',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
  muted: 'border-slate-200 bg-slate-100 text-slate-600',
};

const SIZE_CLASSES = {
  sm: 'px-2 py-0.5 text-[10px]',
  md: 'px-2.5 py-1 text-xs',
  lg: 'px-3 py-1.5 text-sm',
};

const formatLabel = (value) => {
  if (!value) return '';
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
};

/**
 * Replaces the six different `getXxxClasses` helpers across pages.
 *
 * Usage:
 *   <StatusBadge status='low_stock' />
 *   <StatusBadge status='active' size='sm' />
 *   <StatusBadge tone='success'>Custom label</StatusBadge>
 */
const StatusBadge = ({
  status,
  tone,
  size = 'md',
  children,
  className = '',
  withDot = true,
}) => {
  const normalizedStatus = status ? String(status).toLowerCase().trim() : '';
  const resolvedTone = tone || STATUS_TONE[normalizedStatus] || 'neutral';
  const toneClass = TONE_CLASSES[resolvedTone] || TONE_CLASSES.neutral;
  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  const label = children || formatLabel(status);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium uppercase tracking-[0.14em] ${toneClass} ${sizeClass} ${className}`}
    >
      {withDot ? (
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            resolvedTone === 'success'
              ? 'bg-emerald-500'
              : resolvedTone === 'warning'
                ? 'bg-amber-500'
                : resolvedTone === 'danger'
                  ? 'bg-rose-500'
                  : resolvedTone === 'info'
                    ? 'bg-blue-500'
                    : 'bg-slate-400'
          }`}
          aria-hidden='true'
        />
      ) : null}
      {label}
    </span>
  );
};

export default StatusBadge;
export { STATUS_TONE, TONE_CLASSES };
