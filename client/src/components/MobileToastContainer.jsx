import React from 'react';
import { ToastContainer, cssTransition } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const mobileToastTransition = cssTransition({
  enter: 'lf-toast-enter',
  exit: 'lf-toast-exit',
  duration: [280, 220],
  collapse: true,
  appendPosition: false,
});

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

const ToastCloseButton = ({ closeToast }) => (
  <button
    type='button'
    onClick={closeToast}
    className='lf-toast-close'
    aria-label='Close notification'
  >
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' className='h-4 w-4'>
      <path d='M6 6 18 18M18 6 6 18' strokeLinecap='round' />
    </svg>
  </button>
);

const MobileToastContainer = () => (
  <ToastContainer
    position='bottom-center'
    autoClose={2500}
    closeOnClick={false}
    draggable
    draggableDirection='x'
    draggablePercent={30}
    pauseOnHover={false}
    pauseOnFocusLoss={false}
    newestOnTop
    limit={1}
    hideProgressBar
    role='status'
    icon={ToastIcon}
    closeButton={ToastCloseButton}
    transition={mobileToastTransition}
    containerClassName='lf-toast-container'
    toastClassName='lf-toast'
    bodyClassName='lf-toast-body'
  />
);

export default MobileToastContainer;
