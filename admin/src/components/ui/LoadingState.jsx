import React from 'react';

/**
 * Loading state primitives. Replaces the mixed `ui-loading-state`,
 * inline spinners, and `Loading X...` strings used across pages.
 */

export const Skeleton = ({ className = '', as: Tag = 'div', style }) => (
  <Tag className={`ui-skeleton ${className}`} style={style} aria-hidden='true' />
);

export const SkeletonText = ({ lines = 3, className = '' }) => (
  <div className={`space-y-2 ${className}`} aria-hidden='true'>
    {Array.from({ length: lines }).map((_, index) => (
      <Skeleton
        key={index}
        className='h-3 w-full'
        style={{ width: `${85 - index * 10}%` }}
      />
    ))}
  </div>
);

export const SkeletonCard = ({ className = '' }) => (
  <div
    className={`rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 ${className}`}
  >
    <Skeleton className='h-3 w-24' />
    <Skeleton className='mt-3 h-8 w-32' />
    <Skeleton className='mt-2 h-3 w-40' />
  </div>
);

export const SkeletonTable = ({ rows = 5, columns = 4, className = '' }) => (
  <div
    className={`overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] ${className}`}
  >
    <div className='grid gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3' style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {Array.from({ length: columns }).map((_, c) => (
        <Skeleton key={c} className='h-3' />
      ))}
    </div>
    <div className='divide-y divide-[var(--color-border)]'>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className='grid gap-3 px-4 py-3'
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className='h-4' />
          ))}
        </div>
      ))}
    </div>
  </div>
);

export const Spinner = ({ size = 'md', className = '' }) => {
  const dimension =
    size === 'sm' ? 'h-4 w-4 border-2' : size === 'lg' ? 'h-10 w-10 border-[3px]' : 'h-6 w-6 border-2';
  return (
    <span
      className={`inline-block animate-spin rounded-full border-slate-200 border-t-slate-700 ${dimension} ${className}`}
      role='status'
      aria-label='Loading'
    />
  );
};

const LoadingState = ({
  variant = 'card',
  rows,
  columns,
  message = 'Loading…',
  className = '',
}) => {
  if (variant === 'table') {
    return <SkeletonTable rows={rows ?? 5} columns={columns ?? 4} className={className} />;
  }

  if (variant === 'list') {
    return (
      <div className={`space-y-3 ${className}`}>
        {Array.from({ length: rows ?? 4 }).map((_, idx) => (
          <SkeletonCard key={idx} />
        ))}
      </div>
    );
  }

  if (variant === 'spinner') {
    return (
      <div className={`flex items-center justify-center gap-3 py-10 text-sm text-[var(--color-text-muted)] ${className}`}>
        <Spinner />
        <span>{message}</span>
      </div>
    );
  }

  return <SkeletonCard className={className} />;
};

export default LoadingState;
