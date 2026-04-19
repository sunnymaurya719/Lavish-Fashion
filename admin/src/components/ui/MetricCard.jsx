import React from 'react';

const toneStyles = {
  default: 'border-[var(--color-border)] bg-[var(--color-surface)]',
  success: 'border-emerald-200 bg-emerald-50/60',
  warning: 'border-amber-200 bg-amber-50/60',
  danger: 'border-rose-200 bg-rose-50/60',
  info: 'border-blue-200 bg-blue-50/60',
  accent: 'border-slate-900 bg-slate-950 text-white',
};

const labelTone = {
  default: 'text-[var(--color-text-muted)]',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-rose-700',
  info: 'text-blue-700',
  accent: 'text-slate-300',
};

const valueTone = {
  default: 'text-[var(--color-text-primary)]',
  success: 'text-emerald-900',
  warning: 'text-amber-900',
  danger: 'text-rose-900',
  info: 'text-blue-900',
  accent: 'text-white',
};

/**
 * Single source of truth for the metric tile used across Dashboard, Inventory,
 * Customers, Orders summaries, etc. Replaces ~8 different bespoke implementations
 * that used slightly different paddings, radii, and colors.
 */
const MetricCard = ({
  label,
  value,
  helper,
  tone = 'default',
  icon,
  trend,
  trendDirection,
  as: Tag = 'article',
  href,
  to,
  onClick,
  className = '',
}) => {
  const interactive = Boolean(href || to || onClick);
  const Component = href ? 'a' : Tag;

  const props = interactive
    ? {
        href,
        onClick,
        role: onClick && Tag === 'div' ? 'button' : undefined,
        tabIndex: onClick && Tag === 'div' ? 0 : undefined,
      }
    : {};

  return (
    <Component
      {...props}
      className={`rounded-3xl border p-5 shadow-[var(--shadow-card)] transition ${toneStyles[tone] || toneStyles.default} ${
        interactive ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md' : ''
      } ${className}`}
    >
      <div className='flex items-start justify-between gap-3'>
        <p className={`text-[11px] font-medium uppercase tracking-[0.24em] ${labelTone[tone] || labelTone.default}`}>
          {label}
        </p>
        {icon ? <span className='shrink-0 opacity-80'>{icon}</span> : null}
      </div>

      <p className={`mt-3 text-3xl font-semibold leading-tight ${valueTone[tone] || valueTone.default}`}>
        {value}
      </p>

      {trend ? (
        <p
          className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${
            trendDirection === 'up'
              ? 'text-emerald-700'
              : trendDirection === 'down'
                ? 'text-rose-700'
                : 'text-[var(--color-text-muted)]'
          }`}
        >
          {trendDirection === 'up' ? '▲' : trendDirection === 'down' ? '▼' : '·'} {trend}
        </p>
      ) : null}

      {helper ? (
        <p
          className={`mt-2 text-sm leading-relaxed ${
            tone === 'accent' ? 'text-slate-300' : 'text-[var(--color-text-secondary)]'
          }`}
        >
          {helper}
        </p>
      ) : null}
    </Component>
  );
};

export default MetricCard;
