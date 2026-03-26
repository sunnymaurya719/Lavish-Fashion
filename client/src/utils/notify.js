import { toast as baseToast } from 'react-toastify';

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

const show = (type, message, options = {}) => {
  const {
    showCloseButton = true,
    haptic = true,
    autoClose,
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

  return emitter(text, {
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
