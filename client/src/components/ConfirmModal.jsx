import { useEffect } from 'react';
import { createPortal } from 'react-dom';

const ConfirmModal = ({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isLoading = false,
  onConfirm,
  onClose,
}) => {
  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !isLoading) {
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isLoading, onClose, open]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className='lf-modal-shell' role='presentation'>
      <button
        type='button'
        aria-label='Close confirmation modal'
        className='lf-modal-overlay'
        onClick={() => {
          if (!isLoading) {
            onClose?.();
          }
        }}
      />

      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='confirm-modal-title'
        aria-describedby='confirm-modal-message'
        className='lf-modal-panel lf-modal-animate-in'
      >
        <div>
          <p id='confirm-modal-title' className='text-xl font-semibold tracking-[-0.02em] text-slate-950'>
            {title}
          </p>
          <p id='confirm-modal-message' className='mt-3 whitespace-pre-line text-sm leading-6 text-slate-600'>
            {message}
          </p>
        </div>

        <div className='mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end'>
          <button
            type='button'
            onClick={onClose}
            disabled={isLoading}
            className='rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60'
          >
            {cancelLabel}
          </button>
          <button
            type='button'
            onClick={onConfirm}
            disabled={isLoading}
            className='inline-flex items-center justify-center gap-2 rounded-full bg-rose-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-400'
          >
            {isLoading ? (
              <>
                <svg
                  className='h-4 w-4 animate-spin'
                  xmlns='http://www.w3.org/2000/svg'
                  viewBox='0 0 24 24'
                  fill='none'
                  aria-hidden='true'
                >
                  <circle cx='12' cy='12' r='9' stroke='currentColor' strokeWidth='3' className='opacity-30' />
                  <path
                    d='M21 12a9 9 0 0 0-9-9'
                    stroke='currentColor'
                    strokeWidth='3'
                    strokeLinecap='round'
                  />
                </svg>
                Cancelling...
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ConfirmModal;
