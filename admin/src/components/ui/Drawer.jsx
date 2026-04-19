import React, { useEffect, useRef } from 'react';

const widthClass = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

/**
 * Right-side slide-in panel used for detail views (Customers, Reviews,
 * Marketing, Orders). Replaces the inline detail panes that compete for
 * vertical space on smaller screens.
 *
 * Caller controls open state. Returns focus on close.
 */
const Drawer = ({
  open,
  onClose,
  title,
  description,
  width = 'lg',
  footer,
  children,
}) => {
  const drawerRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  // Keep onClose in a ref so the effect never re-runs just because the parent
  // re-rendered and passed a new function reference (e.g. on every keystroke).
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocusedRef.current = document.activeElement;
    const node = drawerRef.current;
    const focusable = node?.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus?.();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      const previous = previouslyFocusedRef.current;
      if (previous && typeof previous.focus === 'function') {
        previous.focus();
      }
    };
  }, [open]); // ← only re-run when the drawer opens/closes, NOT on every onClose change

  return (
    <div
      className={`fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`}
      aria-hidden={!open}
    >
      <button
        type='button'
        aria-label='Close drawer'
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/45 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
        tabIndex={open ? 0 : -1}
      />

      <aside
        ref={drawerRef}
        role='dialog'
        aria-modal='true'
        aria-label={typeof title === 'string' ? title : 'Detail panel'}
        className={`absolute right-0 top-0 flex h-full w-full ${widthClass[width] || widthClass.lg} transform flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className='flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-6 py-4'>
          <div className='min-w-0'>
            {title ? (
              <h2 className='truncate text-lg font-semibold text-[var(--color-text-primary)]'>
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className='mt-1 text-sm text-[var(--color-text-secondary)]'>{description}</p>
            ) : null}
          </div>
          <button
            type='button'
            onClick={onClose}
            className='shrink-0 rounded-xl border border-[var(--color-border-strong)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-text-primary)] transition hover:bg-[var(--color-surface-muted)] ui-focus-ring'
            aria-label='Close drawer'
          >
            Close
          </button>
        </header>

        <div className='flex-1 overflow-y-auto px-6 py-5'>{children}</div>

        {footer ? (
          <footer className='border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-6 py-4'>
            {footer}
          </footer>
        ) : null}
      </aside>
    </div>
  );
};

export default Drawer;
