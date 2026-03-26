import React, { useCallback, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { dismissToast, getToastSnapshot, subscribeToToast } from '../utils/notify';

const ToastIcon = ({ type }) => {
  const iconClassName = `lf-toast-icon ${type === 'success' ? 'lf-toast-icon-success' : ''}`;

  if (type === 'success') {
    return (
      <span className={iconClassName}>
        <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor' className='h-4 w-4 text-emerald-400'>
          <path d='M12 2a10 10 0 100 20 10 10 0 000-20zm4.3 7.7l-5.25 5.25a1 1 0 01-1.4 0L7.7 13a1 1 0 111.4-1.4l1.25 1.25 4.55-4.55a1 1 0 111.4 1.4z' />
        </svg>
      </span>
    );
  }

  if (type === 'error') {
    return (
      <span className={iconClassName}>
        <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor' className='h-4 w-4 text-rose-400'>
          <path d='M12 2a10 10 0 100 20 10 10 0 000-20zm1 5v6h-2V7h2zm0 10v-2h-2v2h2z' />
        </svg>
      </span>
    );
  }

  return (
    <span className={iconClassName}>
      <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor' className='h-4 w-4 text-sky-400'>
        <path d='M12 2a10 10 0 100 20 10 10 0 000-20zm1 14h-2v-6h2v6zm0-8h-2V6h2v2z' />
      </svg>
    </span>
  );
};

const MobileToastContainer = () => {
  const toast = useSyncExternalStore(subscribeToToast, getToastSnapshot, getToastSnapshot);

  const handleClose = useCallback(() => {
    dismissToast();
  }, []);

  const handleAction = useCallback(() => {
    if (!toast || typeof toast.onAction !== 'function') {
      return;
    }

    try {
      toast.onAction();
    } finally {
      dismissToast();
    }
  }, [toast]);

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className='lf-toast-container'
      aria-live={toast?.type === 'error' || toast?.type === 'warning' ? 'assertive' : 'polite'}
      aria-atomic='true'
    >
      {toast ? (
        <div className='lf-toast-stack'>
          <article
            key={toast.id}
            className={`lf-toast lf-toast-${toast.type} ${toast.visible ? 'lf-toast-enter' : 'lf-toast-exit'}`}
            role={toast.role}
          >
            <ToastIcon type={toast.type} />

            <div className='lf-toast-body'>
              {toast.actionLabel && typeof toast.onAction === 'function' ? (
                <div className='lf-toast-content'>
                  <span className='lf-toast-message' title={toast.message}>
                    {toast.message}
                  </span>
                  <button
                    type='button'
                    onClick={handleAction}
                    className='lf-toast-action'
                    aria-label={toast.actionAriaLabel || toast.actionLabel}
                  >
                    {toast.actionLabel}
                  </button>
                </div>
              ) : (
                <span className='lf-toast-message' title={toast.message}>
                  {toast.message}
                </span>
              )}
            </div>

            {toast.showCloseButton ? (
              <button type='button' onClick={handleClose} className='lf-toast-close' aria-label='Close notification'>
                <svg
                  xmlns='http://www.w3.org/2000/svg'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='1.8'
                  className='h-4 w-4'
                >
                  <path d='M6 6 18 18M18 6 6 18' strokeLinecap='round' />
                </svg>
              </button>
            ) : null}
          </article>
        </div>
      ) : null}
    </div>,
    document.body
  );
};

export default MobileToastContainer;
