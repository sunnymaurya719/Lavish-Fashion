import React from 'react';

/**
 * Standard empty state used by lists and tables.
 * Replaces ad-hoc `<div className='rounded-2xl bg-slate-50 ...'>No X matched...</div>`.
 */
const EmptyState = ({ icon, title, description, action, className = '' }) => {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-3xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] px-6 py-12 text-center ${className}`}
    >
      {icon ? (
        <div className='mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[var(--color-text-muted)] shadow-sm'>
          {icon}
        </div>
      ) : null}
      {title ? (
        <p className='text-base font-semibold text-[var(--color-text-primary)]'>{title}</p>
      ) : null}
      {description ? (
        <p className='mt-1 max-w-md text-sm text-[var(--color-text-secondary)]'>{description}</p>
      ) : null}
      {action ? <div className='mt-4'>{action}</div> : null}
    </div>
  );
};

export default EmptyState;
