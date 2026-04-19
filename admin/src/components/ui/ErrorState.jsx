import React from 'react';

/**
 * Standard error state for failed loads / mutations.
 * Replaces the bespoke retry blocks (e.g. in Loyalty.jsx, FitAnalytics.jsx).
 */
const ErrorState = ({
  title = 'Something went wrong',
  description = 'We could not load this section. Please try again.',
  onRetry,
  retryLabel = 'Retry',
  detail,
  className = '',
}) => {
  return (
    <div
      role='alert'
      className={`rounded-3xl border border-rose-200 bg-rose-50 p-6 ${className}`}
    >
      <div className='flex items-start gap-3'>
        <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-700'>
          <svg width='20' height='20' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
            <path
              d='M12 2 1 21h22L12 2Zm0 6 7.5 13h-15L12 8Zm-1 5v3h2v-3h-2Zm0 4v2h2v-2h-2Z'
              fill='currentColor'
            />
          </svg>
        </div>
        <div className='min-w-0 flex-1'>
          <p className='text-base font-semibold text-rose-900'>{title}</p>
          <p className='mt-1 text-sm text-rose-800'>{description}</p>
          {detail ? (
            <pre className='mt-3 max-h-32 overflow-auto rounded-xl bg-white/60 p-3 text-[11px] text-rose-900/80'>
              {typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)}
            </pre>
          ) : null}
          {onRetry ? (
            <button
              type='button'
              onClick={onRetry}
              className='mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-800 transition hover:bg-rose-100 ui-focus-ring'
            >
              <svg width='14' height='14' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
                <path
                  d='M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z'
                  fill='currentColor'
                />
              </svg>
              {retryLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ErrorState;
