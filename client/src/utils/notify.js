import { toast as baseToast } from 'react-toastify';
import React from 'react';

const SINGLE_TOAST_ID = 'lf-single-toast';

const TOAST_DURATION = {
  success: 2000,
  error: 3500,
  info: 2600,
};

const triggerHapticFeedback = (type) => {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }

  try {
    if (type === 'error') {
      navigator.vibrate([22, 22, 22]);
      return;
    }

    if (type === 'success') {
      navigator.vibrate(14);
      return;
    }

    navigator.vibrate(10);
  } catch {
    // Ignore unsupported vibration runtime errors.
  }
};

const createToastContent = ({ message, actionLabel, onAction, actionAriaLabel }) => {
  if (!actionLabel || typeof onAction !== 'function') {
    return message;
  }

  const handleAction = () => {
    try {
      onAction();
    } finally {
      baseToast.dismiss(SINGLE_TOAST_ID);
    }
  };

  return React.createElement(
    'div',
    { className: 'lf-toast-content' },
    React.createElement('span', { className: 'lf-toast-message', title: message }, message),
    React.createElement(
      'button',
      {
        type: 'button',
        onClick: handleAction,
        className: 'lf-toast-action',
        'aria-label': actionAriaLabel || actionLabel,
      },
      actionLabel
    )
  );
};

const show = (type, message, options = {}) => {
  const {
    showCloseButton = true,
    haptic = true,
    autoClose,
    actionLabel = '',
    onAction = null,
    actionAriaLabel = '',
    ...toastOptions
  } = options;

  const text = String(message || '').replace(/\s+/g, ' ').trim();

  if (!text) {
    return null;
  }

  if (baseToast.isActive(SINGLE_TOAST_ID)) {
    baseToast.dismiss(SINGLE_TOAST_ID);
  }

  if (haptic) {
    triggerHapticFeedback(type);
  }

  const emitter = typeof baseToast[type] === 'function' ? baseToast[type] : baseToast;
  const content = createToastContent({
    message: text,
    actionLabel,
    onAction,
    actionAriaLabel,
  });

  return emitter(content, {
    toastId: SINGLE_TOAST_ID,
    autoClose: typeof autoClose === 'number' ? autoClose : TOAST_DURATION[type] || 2500,
    closeButton: showCloseButton ? undefined : false,
    ...toastOptions,
  });
};

export const notify = {
  success: (message, options) => show('success', message, options),
  error: (message, options) => show('error', message, options),
  info: (message, options) => show('info', message, options),
  message: (message, options) => show('info', message, options),
  wishlistAdded: (options) => show('success', 'Added to wishlist', { showCloseButton: false, ...options }),
  sizeRequired: (options) => show('error', 'Please select a size', options),
  dismiss: () => baseToast.dismiss(SINGLE_TOAST_ID),
};
