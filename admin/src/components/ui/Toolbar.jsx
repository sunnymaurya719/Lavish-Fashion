import React, { useEffect, useRef } from 'react';

/**
 * Toolbar with a search input, optional filter slot, and secondary actions.
 *
 * - Press `/` anywhere on the page to focus the search input
 *   (we register a keydown listener; ignored when typing in another input).
 *
 * Replaces the custom flex rows used in List, Inventory, Customers, Reviews,
 * Marketing.
 */
const Toolbar = ({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  filters,
  actions,
  trailing,
  enableSlashShortcut = true,
  className = '',
}) => {
  const inputRef = useRef(null);

  useEffect(() => {
    if (!enableSlashShortcut) return undefined;
    const handler = (event) => {
      if (event.key !== '/') return;
      const target = event.target;
      const tag = target?.tagName;
      const isEditable =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
      if (isEditable) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select?.();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [enableSlashShortcut]);

  return (
    <div
      className={`flex flex-col gap-3 rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm lg:flex-row lg:items-center ${className}`}
    >
      {onSearchChange ? (
        <div className='relative flex-1 min-w-0'>
          <span className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]'>
            <svg width='16' height='16' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
              <path
                d='M10.5 3a7.5 7.5 0 1 0 4.55 13.43l4.51 4.51 1.41-1.41-4.5-4.51A7.5 7.5 0 0 0 10.5 3Zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z'
                fill='currentColor'
              />
            </svg>
          </span>
          <input
            ref={inputRef}
            type='search'
            value={searchValue ?? ''}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className='w-full rounded-2xl border border-[var(--color-border-strong)] bg-white py-2.5 pl-10 pr-12 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-subtle)]'
            aria-label='Search'
          />
          {enableSlashShortcut ? (
            <span className='pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)] sm:inline'>
              /
            </span>
          ) : null}
        </div>
      ) : null}

      {filters ? <div className='flex flex-wrap items-center gap-2'>{filters}</div> : null}

      {actions ? <div className='flex flex-wrap items-center gap-2 lg:ml-auto'>{actions}</div> : null}

      {trailing}
    </div>
  );
};

export default Toolbar;
