import React, { useEffect, useRef } from 'react';

/**
 * Confirmation modal with destructive variant. Replaces window.confirm calls
 * (e.g. List.jsx removeProduct).
 *
 * Controlled by `open`. Caller owns visibility and the confirm handler.
 *
 * Keyboard:
 *   Esc  → cancel
 *   Tab  → focus is trapped inside the dialog
 *   Enter→ activates the focused button (native)
 */
const ConfirmDialog = ({
  open,
  title = 'Are you sure?',
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
}) => {
  const dialogRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocusedRef.current = document.activeElement;
    const node = dialogRef.current;

    // Focus the primary action by default — agents Enter to confirm.
    const primary = node?.querySelector('[data-confirm-primary]');
    primary?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onCancel?.();
        return;
      }

      if (event.key === 'Tab' && node) {
        const focusable = node.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const previous = previouslyFocusedRef.current;
      if (previous && typeof previous.focus === 'function') {
        previous.focus();
      }
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center px-4 py-6'>
      <button
        type='button'
        aria-label='Close confirmation'
        className='absolute inset-0 bg-slate-950/45 backdrop-blur-sm'
        onClick={() => !busy && onCancel?.()}
      />

      <div
        ref={dialogRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby='confirm-dialog-title'
        className='relative z-10 w-full max-w-md rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-popover)]'
      >
        <h2
          id='confirm-dialog-title'
          className='text-lg font-semibold text-[var(--color-text-primary)]'
        >
          {title}
        </h2>
        {description ? (
          <p className='mt-2 text-sm text-[var(--color-text-secondary)]'>{description}</p>
        ) : null}

        {children ? <div className='mt-4'>{children}</div> : null}

        <div className='mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'>
          <button
            type='button'
            onClick={onCancel}
            disabled={busy}
            className='rounded-xl border border-[var(--color-border-strong)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] transition hover:bg-[var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-60 ui-focus-ring'
          >
            {cancelLabel}
          </button>
          <button
            type='button'
            data-confirm-primary
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ui-focus-ring ${
              destructive
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-slate-900 hover:bg-slate-800'
            }`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
