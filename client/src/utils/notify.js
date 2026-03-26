const TOAST_DURATION = {
  success: 2000,
  error: 3500,
  info: 2600,
  warning: 3000,
  default: 2500,
};

const TOAST_EXIT_DURATION = 180;

let currentToast = null;
let dismissTimer = null;
let removeTimer = null;
let toastSequence = 0;

const listeners = new Set();

const emit = () => {
  listeners.forEach((listener) => listener());
};

const clearToastTimers = () => {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }

  if (removeTimer) {
    clearTimeout(removeTimer);
    removeTimer = null;
  }
};

const resolveAutoClose = (type, autoClose) => {
  if (autoClose === false) {
    return false;
  }

  if (Number.isFinite(autoClose) && autoClose > 0) {
    return autoClose;
  }

  return TOAST_DURATION[type] || TOAST_DURATION.default;
};

const resolveRole = (type) => (type === 'error' || type === 'warning' ? 'alert' : 'status');

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

export const getToastSnapshot = () => currentToast;

export const subscribeToToast = (listener) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

export const dismissToast = () => {
  clearToastTimers();

  if (!currentToast) {
    return;
  }

  currentToast = {
    ...currentToast,
    visible: false,
  };
  emit();

  removeTimer = setTimeout(() => {
    currentToast = null;
    removeTimer = null;
    emit();
  }, TOAST_EXIT_DURATION);
};

const show = (type, message, options = {}) => {
  const {
    showCloseButton = true,
    haptic = true,
    autoClose,
    actionLabel = '',
    onAction = null,
    actionAriaLabel = '',
  } = options;

  const text = String(message || '').replace(/\s+/g, ' ').trim();

  if (!text) {
    return null;
  }

  clearToastTimers();

  if (haptic) {
    triggerHapticFeedback(type);
  }

  const nextToast = {
    id: `lf-toast-${toastSequence += 1}`,
    type,
    message: text,
    actionLabel,
    onAction,
    actionAriaLabel,
    showCloseButton,
    autoClose: resolveAutoClose(type, autoClose),
    role: resolveRole(type),
    visible: true,
  };

  currentToast = nextToast;
  emit();

  if (nextToast.autoClose !== false) {
    dismissTimer = setTimeout(() => {
      dismissToast();
    }, nextToast.autoClose);
  }

  return nextToast.id;
};

export const notify = {
  success: (message, options) => show('success', message, options),
  error: (message, options) => show('error', message, options),
  info: (message, options) => show('info', message, options),
  warning: (message, options) => show('warning', message, options),
  message: (message, options) => show('info', message, options),
  wishlistAdded: (options) => show('success', 'Added to wishlist', { showCloseButton: false, ...options }),
  sizeRequired: (options) => show('error', 'Please select a size', options),
  dismiss: dismissToast,
};
