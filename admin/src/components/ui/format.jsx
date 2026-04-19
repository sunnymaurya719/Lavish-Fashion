import React from 'react';

/**
 * Centralized number / currency / date / relative-time renderers.
 * Replaces the duplicated formatCurrency / formatDate / formatSyncTime
 * helpers that were re-implemented (with subtle drift) on every page.
 */

const DEFAULT_LOCALE = 'en-IN';
const DEFAULT_CURRENCY = 'INR';

const moneyFormatterCache = new Map();
const numberFormatterCache = new Map();

const getMoneyFormatter = (currency, fractionDigits) => {
  const key = `${currency}|${fractionDigits}`;
  if (!moneyFormatterCache.has(key)) {
    moneyFormatterCache.set(
      key,
      new Intl.NumberFormat(DEFAULT_LOCALE, {
        style: 'currency',
        currency,
        maximumFractionDigits: fractionDigits,
        minimumFractionDigits: fractionDigits,
      })
    );
  }
  return moneyFormatterCache.get(key);
};

const getNumberFormatter = (fractionDigits) => {
  const key = String(fractionDigits);
  if (!numberFormatterCache.has(key)) {
    numberFormatterCache.set(
      key,
      new Intl.NumberFormat(DEFAULT_LOCALE, {
        maximumFractionDigits: fractionDigits,
        minimumFractionDigits: fractionDigits,
      })
    );
  }
  return numberFormatterCache.get(key);
};

export const formatMoney = (value, { currency = DEFAULT_CURRENCY, fractionDigits = 0, fallback = '—' } = {}) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return getMoneyFormatter(currency, fractionDigits).format(numeric);
};

export const formatNumber = (value, { fractionDigits = 0, fallback = '—' } = {}) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return getNumberFormatter(fractionDigits).format(numeric);
};

export const formatDateTime = (
  value,
  {
    fallback = '—',
    dateStyle = 'medium',
    timeStyle = 'short',
  } = {}
) => {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { dateStyle, timeStyle }).format(date);
};

export const formatDate = (value, { fallback = '—', dateStyle = 'medium' } = {}) => {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { dateStyle }).format(date);
};

export const formatTime = (value, { fallback = 'Awaiting first sync' } = {}) => {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleTimeString(DEFAULT_LOCALE, { hour: '2-digit', minute: '2-digit' });
};

const RELATIVE_THRESHOLDS = [
  { limit: 60, divisor: 1, unit: 'second' },
  { limit: 3600, divisor: 60, unit: 'minute' },
  { limit: 86400, divisor: 3600, unit: 'hour' },
  { limit: 604800, divisor: 86400, unit: 'day' },
  { limit: 2629800, divisor: 604800, unit: 'week' },
  { limit: 31557600, divisor: 2629800, unit: 'month' },
  { limit: Infinity, divisor: 31557600, unit: 'year' },
];

const relativeFormatter = new Intl.RelativeTimeFormat(DEFAULT_LOCALE, { numeric: 'auto' });

export const formatRelativeTime = (value, { fallback = '—' } = {}) => {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const diffSeconds = (date.getTime() - Date.now()) / 1000;
  const absSeconds = Math.abs(diffSeconds);
  for (const { limit, divisor, unit } of RELATIVE_THRESHOLDS) {
    if (absSeconds < limit) {
      const valueInUnit = Math.round(diffSeconds / divisor);
      return relativeFormatter.format(valueInUnit, unit);
    }
  }
  return formatDate(date);
};

export const Money = ({ value, currency, fractionDigits, fallback, className }) => (
  <span className={className}>{formatMoney(value, { currency, fractionDigits, fallback })}</span>
);

export const DateTime = ({ value, dateStyle, timeStyle, fallback, className }) => (
  <span className={className}>{formatDateTime(value, { dateStyle, timeStyle, fallback })}</span>
);

export const RelativeTime = ({ value, fallback, className, title }) => {
  const date = value ? (value instanceof Date ? value : new Date(value)) : null;
  const titleText = title ?? (date && !Number.isNaN(date.getTime()) ? formatDateTime(date) : undefined);
  return (
    <time dateTime={date?.toISOString?.()} title={titleText} className={className}>
      {formatRelativeTime(value, { fallback })}
    </time>
  );
};

export default Money;
