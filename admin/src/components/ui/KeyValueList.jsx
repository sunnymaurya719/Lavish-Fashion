import React from 'react';

/**
 * Two-column label→value renderer for detail panes (Customers, Reviews, Orders).
 * Replaces repeated grid blocks across pages.
 */

export const KeyValueRow = ({
  label,
  value,
  children,
  copyable,
  onCopy,
  mono = false,
  className = '',
}) => {
  const hasChildren = children !== undefined && children !== null && children !== '';
  const displayValue = hasChildren
    ? children
    : value === null || value === undefined || value === ''
      ? '—'
      : value;
  return (
    <div
      className={`flex flex-col gap-1 border-b border-[var(--color-border)] py-2 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4 ${className}`}
    >
      <dt className='text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-text-muted)]'>
        {label}
      </dt>
      <dd
        className={`text-sm text-[var(--color-text-primary)] sm:max-w-[60%] sm:text-right ${
          mono ? 'font-mono text-[13px]' : ''
        }`}
      >
        <span className='inline-flex items-center gap-2'>
          {displayValue}
          {copyable && value ? (
            <button
              type='button'
              onClick={() => {
                if (typeof navigator !== 'undefined' && navigator.clipboard) {
                  navigator.clipboard.writeText(String(value));
                }
                onCopy?.(value);
              }}
              className='rounded-md border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text-primary)] ui-focus-ring'
              aria-label={`Copy ${label}`}
            >
              Copy
            </button>
          ) : null}
        </span>
      </dd>
    </div>
  );
};

const KeyValueList = ({ items, children, columns = 1, className = '' }) => {
  const gridClass =
    columns === 2
      ? 'grid gap-x-6 sm:grid-cols-2'
      : columns === 3
        ? 'grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3'
        : '';
  return (
    <dl className={`${gridClass} ${className}`}>
      {items
        ? items.map((item) => <KeyValueRow key={item.key || item.label} {...item} />)
        : children}
    </dl>
  );
};

export default KeyValueList;
