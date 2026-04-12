import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useLocation, useSearchParams } from 'react-router-dom';
import { ShopContext } from '../context/ShopContext';

const FREE_DELIVERY_THRESHOLD = 999;
const STEP_QUERY_KEY = 'step';
const CHECKOUT_MODE_QUERY_KEY = 'checkout';
const STEP_QUERY_VALUES = ['address', 'payment', 'review'];
const BUY_NOW_CHECKOUT_MODE = 'buy-now';
const CHECKOUT_DRAFT_STORAGE_KEY = 'lf_checkout_draft_v1';
const CHECKOUT_DRAFT_TTL_MS = 1000 * 60 * 60 * 24;

const EMPTY_FORM_DATA = Object.freeze({
  fullName: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
});

const getStepIndexFromParam = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  const stepByName = STEP_QUERY_VALUES.indexOf(normalized);
  if (stepByName >= 0) {
    return stepByName;
  }

  const stepByNumber = Number.parseInt(normalized, 10);
  if (Number.isInteger(stepByNumber) && stepByNumber >= 1 && stepByNumber <= STEP_QUERY_VALUES.length) {
    return stepByNumber - 1;
  }

  return 0;
};

const getStepParamFromIndex = (stepIndex) => STEP_QUERY_VALUES[stepIndex] || STEP_QUERY_VALUES[0];

const sanitizeDraftFormData = (formData = {}) => ({
  fullName: String(formData.fullName || ''),
  phone: String(formData.phone || ''),
  address: String(formData.address || ''),
  city: String(formData.city || ''),
  state: String(formData.state || ''),
  pincode: String(formData.pincode || ''),
});

const readCheckoutDraft = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawDraft = window.sessionStorage.getItem(CHECKOUT_DRAFT_STORAGE_KEY);
    if (!rawDraft) {
      return null;
    }

    const parsedDraft = JSON.parse(rawDraft);
    const updatedAt = Number(parsedDraft?.updatedAt || 0);
    const isExpired = updatedAt && Date.now() - updatedAt > CHECKOUT_DRAFT_TTL_MS;

    if (isExpired) {
      window.sessionStorage.removeItem(CHECKOUT_DRAFT_STORAGE_KEY);
      return null;
    }

    const method = parsedDraft?.method === 'razorpay' || parsedDraft?.method === 'cod' ? parsedDraft.method : '';
    const step = Number.isInteger(parsedDraft?.step) ? Math.min(2, Math.max(0, parsedDraft.step)) : 0;

    return {
      formData: sanitizeDraftFormData(parsedDraft?.formData),
      method,
      step,
    };
  } catch {
    return null;
  }
};

const loadRazorpayScript = () => {
  if (typeof window !== 'undefined' && typeof window.Razorpay === 'function') {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const sanitizeAddressData = (data = {}) => {
  const normalizedName = String(data.fullName || '').trim().replace(/\s+/g, ' ');
  const nameParts = normalizedName.split(' ').filter(Boolean);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : firstName;

  return {
    firstName,
    lastName,
    street: String(data.address || '').trim(),
    city: String(data.city || '').trim(),
    state: String(data.state || '').trim(),
    pincode: String(data.pincode || '').trim(),
    country: 'India',
    phone: String(data.phone || '').trim(),
  };
};

const PlaceOrder = () => {
  const {
    navigate,
    toast,
    BACKEND_URL,
    token,
    clearCartState,
    buyNowCheckout,
    clearBuyNowCheckout,
    getCartAmount,
    delivery_fee,
    getCheckoutItems,
    products,
    serverBootstrap,
    serverStatus,
  } = useContext(ShopContext);

  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const checkoutMode = String(searchParams.get(CHECKOUT_MODE_QUERY_KEY) || '').trim().toLowerCase();
  const routeBuyNowProduct = location.state?.buyNow ? location.state?.product : null;
  const isBuyNowCheckout = Boolean(
    checkoutMode === BUY_NOW_CHECKOUT_MODE || location.state?.buyNow || routeBuyNowProduct?._id
  );
  const resolvedBuyNowProduct = useMemo(() => {
    if (!isBuyNowCheckout) {
      return null;
    }

    return routeBuyNowProduct?._id ? routeBuyNowProduct : buyNowCheckout;
  }, [buyNowCheckout, isBuyNowCheckout, routeBuyNowProduct]);
  const initialDraftRef = useRef(readCheckoutDraft());
  const initialStepFromUrl = getStepIndexFromParam(searchParams.get(STEP_QUERY_KEY));

  const [method, setMethod] = useState(() => initialDraftRef.current?.method || '');
  const [currentStep, setCurrentStep] = useState(() => {
    if (initialStepFromUrl !== null) {
      return initialStepFromUrl;
    }

    return initialDraftRef.current?.step || 0;
  });
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [isStepTransitioning, setIsStepTransitioning] = useState(false);
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [pointsInput, setPointsInput] = useState('');
  const [pricingPreview, setPricingPreview] = useState(null);
  const [pricingAction, setPricingAction] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const idempotencyKeyRef = useRef('');

  const clearCheckoutDraft = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.sessionStorage.removeItem(CHECKOUT_DRAFT_STORAGE_KEY);
    } catch {
      // Ignore storage errors to keep checkout resilient.
    }
  }, []);

  const checkoutItems = useMemo(
    () => getCheckoutItems({ isBuyNow: isBuyNowCheckout, buyNowProduct: resolvedBuyNowProduct }),
    [getCheckoutItems, isBuyNowCheckout, resolvedBuyNowProduct]
  );
  const checkoutItemsKey = useMemo(() => JSON.stringify(checkoutItems), [checkoutItems]);

  const [formData, setFormData] = useState(() => ({
    ...EMPTY_FORM_DATA,
    ...(initialDraftRef.current?.formData || {}),
  }));

  const baseSubtotal =
    isBuyNowCheckout && resolvedBuyNowProduct
      ? Number(resolvedBuyNowProduct.price || 0) * Number(resolvedBuyNowProduct.quantity || 1)
      : getCartAmount();

  const defaultPricingSummary = useMemo(
    () => ({
      subtotal: baseSubtotal,
      deliveryFee: baseSubtotal === 0 ? 0 : delivery_fee,
      couponDiscountAmount: 0,
      loyaltyDiscountAmount: 0,
      discountAmount: 0,
      total: baseSubtotal === 0 ? 0 : baseSubtotal + delivery_fee,
      appliedCoupon: null,
      loyaltyPointsRedeemed: 0,
      availableLoyaltyPoints: 0,
      loyaltyRules: null,
    }),
    [baseSubtotal, delivery_fee]
  );

  const pricingSummary = pricingPreview || defaultPricingSummary;
  const appliedCouponCode = pricingSummary.appliedCoupon?.code || '';
  const availableLoyaltyPoints = Math.max(0, Number(pricingSummary.availableLoyaltyPoints || 0));
  const loyaltyRules = pricingSummary.loyaltyRules || null;

  const paymentCapabilities = serverBootstrap?.payments || {};
  const razorpayKeyId = paymentCapabilities.razorpayKeyId || import.meta.env.VITE_RAZORPAY_KEY_ID || '';
  const razorpayEnabled =
    serverStatus === 'online'
      ? Boolean(paymentCapabilities.razorpayEnabled && razorpayKeyId)
      : Boolean(razorpayKeyId);

  const pointValue = Number(loyaltyRules?.pointValue || 1);
  const minRedeemPoints = Number(loyaltyRules?.minRedeemPoints || 0);
  const minimumRedeemPointsRequired = Math.max(0, Math.floor(minRedeemPoints));
  const couponAdjustedBaseAmount = Math.max(
    0,
    Number(pricingSummary.subtotal || 0) +
      Number(pricingSummary.deliveryFee || 0) -
      Number(pricingSummary.couponDiscountAmount || 0)
  );

  const orderShareCap = Math.floor(couponAdjustedBaseAmount * Number(loyaltyRules?.maxRedeemShare || 0));
  const orderValuePointCap = Math.floor(orderShareCap / Math.max(pointValue, 0.01));
  const totalCheckoutUnits = checkoutItems.reduce(
    (sum, item) => sum + Math.max(0, Math.floor(Number(item.quantity || 0))),
    0
  );

  const perProductPointCap = Number.isFinite(Number(loyaltyRules?.maxRedeemPointsPerProduct))
    ? Math.max(0, totalCheckoutUnits * Math.max(0, Math.floor(Number(loyaltyRules?.maxRedeemPointsPerProduct || 0))))
    : Number.POSITIVE_INFINITY;

  const maxRedeemPointsPerOrder = Number.isFinite(Number(loyaltyRules?.maxRedeemPointsPerOrder))
    ? Math.max(0, Math.floor(Number(loyaltyRules?.maxRedeemPointsPerOrder || 0)))
    : Number.POSITIVE_INFINITY;

  const orderRulePointCap = Math.max(0, Math.min(maxRedeemPointsPerOrder, perProductPointCap, orderValuePointCap || 0));
  const maxRedeemableForThisOrder = Math.max(0, Math.min(availableLoyaltyPoints, orderRulePointCap));
  const canRedeemOnThisOrder = minimumRedeemPointsRequired > 0
    ? maxRedeemableForThisOrder >= minimumRedeemPointsRequired
    : maxRedeemableForThisOrder > 0;

  const itemCount = checkoutItems.reduce((total, item) => total + Number(item.quantity || 0), 0);
  const onlinePaymentDisabled = Number(pricingSummary.total || 0) <= 0;
  const isRefreshingPricing = pricingAction === 'refresh';
  const isApplyingCoupon = pricingAction === 'coupon';
  const isApplyingPoints = pricingAction === 'points';

  const phoneDigits = formData.phone.replace(/\D/g, '');
  const pincodeDigits = formData.pincode.replace(/\D/g, '');

  const requiredAddressFields = [
    { key: 'fullName', label: 'Full name', valid: Boolean(formData.fullName.trim()) },
    { key: 'phone', label: 'Phone', valid: phoneDigits.length === 10 },
    { key: 'address', label: 'Address', valid: Boolean(formData.address.trim()) },
    { key: 'city', label: 'City', valid: Boolean(formData.city.trim()) },
    { key: 'state', label: 'State', valid: Boolean(formData.state.trim()) },
    { key: 'pincode', label: 'PIN code', valid: pincodeDigits.length === 6 },
  ];

  const incompleteAddressFields = requiredAddressFields
    .filter((field) => !field.valid)
    .map((field) => field.label);
  const hasAddressInput = incompleteAddressFields.length === 0;
  const canAccessPaymentStep = hasAddressInput;
  const canAccessReviewStep = hasAddressInput && Boolean(method);
  const stepAccess = [true, canAccessPaymentStep, canAccessReviewStep];

  const steps = [
    { label: 'Address', description: 'Delivery details' },
    { label: 'Payment', description: 'Choose method' },
    { label: 'Review', description: 'Confirm order' },
  ];

  useEffect(() => {
    setPricingPreview(null);
    setCouponInput('');
    setPointsInput('');
    idempotencyKeyRef.current = '';
  }, [checkoutItemsKey]);

  useEffect(() => {
    if (!isStepTransitioning) {
      return;
    }

    const timerId = setTimeout(() => setIsStepTransitioning(false), 700);
    return () => clearTimeout(timerId);
  }, [isStepTransitioning]);

  const requestPricingPreview = useCallback(
    async ({
      couponCode = '',
      pointsToRedeem = 0,
      action = 'refresh',
      successMessage = '',
      toastOnSuccess = false,
      toastOnError = true,
    } = {}) => {
      if (!token || checkoutItems.length === 0) {
        return null;
      }

      setPricingAction(action);

      try {
        const response = await axios.post(
          BACKEND_URL + '/api/order/preview',
          {
            items: checkoutItems,
            couponCode: couponCode.trim(),
            pointsToRedeem: Number(pointsToRedeem || 0),
          },
          { headers: { token } }
        );

        if (!response.data.success) {
          throw new Error(response.data.message || 'Unable to refresh order pricing');
        }

        const nextPricing = response.data.pricing || defaultPricingSummary;
        setPricingPreview(nextPricing);
        setPointsInput(nextPricing.loyaltyPointsRedeemed ? String(nextPricing.loyaltyPointsRedeemed) : '');

        if (action === 'coupon' || !couponCode.trim()) {
          setCouponInput(nextPricing.appliedCoupon?.code || '');
        }

        if (toastOnSuccess && successMessage) {
          toast.success(successMessage);
        }

        return nextPricing;
      } catch (error) {
        if (action === 'refresh') {
          setPricingPreview(null);
        }

        if (toastOnError) {
          toast.error(error?.response?.data?.message || error.message || 'Unable to refresh order pricing');
        }

        return null;
      } finally {
        setPricingAction('');
      }
    },
    [BACKEND_URL, checkoutItems, defaultPricingSummary, toast, token]
  );

  useEffect(() => {
    if (!token || checkoutItems.length === 0) {
      return;
    }

    const refreshPricing = async () => {
      await requestPricingPreview({ action: 'refresh', toastOnError: false });
    };

    refreshPricing();
  }, [checkoutItemsKey, requestPricingPreview, token, checkoutItems.length]);

  useEffect(() => {
    if (method === 'razorpay' && (!razorpayEnabled || onlinePaymentDisabled)) {
      setMethod('cod');
    }
  }, [method, onlinePaymentDisabled, razorpayEnabled]);

  useEffect(() => {
    if (currentStep > 0 && !canAccessPaymentStep) {
      setCurrentStep(0);
      return;
    }

    if (currentStep > 1 && !canAccessReviewStep) {
      setCurrentStep(1);
    }
  }, [canAccessPaymentStep, canAccessReviewStep, currentStep]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const draftPayload = {
      formData,
      method,
      step: currentStep,
      updatedAt: Date.now(),
    };

    try {
      window.sessionStorage.setItem(CHECKOUT_DRAFT_STORAGE_KEY, JSON.stringify(draftPayload));
    } catch {
      // Ignore storage errors so checkout can continue.
    }
  }, [currentStep, formData, method]);

  useEffect(() => {
    const currentStepParam = searchParams.get(STEP_QUERY_KEY) || '';
    const expectedStepParam = currentStep > 0 ? getStepParamFromIndex(currentStep) : '';

    if (currentStepParam === expectedStepParam) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    if (expectedStepParam) {
      nextParams.set(STEP_QUERY_KEY, expectedStepParam);
    } else {
      nextParams.delete(STEP_QUERY_KEY);
    }

    setSearchParams(nextParams, { replace: true, state: location.state });
  }, [currentStep, location.state, searchParams, setSearchParams]);

  const onChangeHandler = (event) => {
    const { name, value } = event.target;

    let nextValue = value;
    if (name === 'phone' || name === 'pincode') {
      nextValue = value.replace(/\D/g, '');
    }

    if (name === 'fullName') {
      nextValue = value.replace(/\s+/g, ' ').trimStart();
    }

    setFormData((currentData) => ({ ...currentData, [name]: nextValue }));
  };

  const focusField = (fieldName) => {
    if (typeof document === 'undefined' || !fieldName) {
      return;
    }

    const field = document.querySelector(`[name="${fieldName}"]`);
    if (field && typeof field.focus === 'function') {
      field.focus();
    }
  };

  const continueFromAddress = () => {
    if (!hasAddressInput) {
      const firstInvalidField = requiredAddressFields.find((field) => !field.valid)?.key;
      toast.error(`Complete address details: ${incompleteAddressFields.join(', ')}`);
      focusField(firstInvalidField);
      return;
    }

    setCurrentStep(1);
  };

  const continueFromPayment = () => {
    if (!method) {
      toast.error('Choose a payment method to continue');
      return;
    }

    setIsStepTransitioning(true);
    setCurrentStep(2);
  };

  const goToStep = (stepIndex) => {
    if (stepIndex < 0 || stepIndex > 2) {
      return;
    }

    if (!stepAccess[stepIndex]) {
      if (stepIndex === 1) {
        continueFromAddress();
      } else if (stepIndex === 2) {
        if (!hasAddressInput) {
          continueFromAddress();
        } else {
          continueFromPayment();
        }
      }

      return;
    }

    setCurrentStep(stepIndex);
  };

  const useCurrentLocationHandler = () => {
    if (isLocating) {
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast.error('Location access is not available on this device');
      return;
    }

    setIsLocating(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position.coords?.latitude || 0).toFixed(4);
        const lng = Number(position.coords?.longitude || 0).toFixed(4);

        setFormData((current) => ({
          ...current,
          address: current.address.trim() || `Near current location (${lat}, ${lng})`,
        }));

        toast.success('Current location added. Please confirm address details.');
        setIsLocating(false);
      },
      (error) => {
        const denied = Number(error?.code || 0) === 1;
        toast.error(denied ? 'Location permission was denied' : 'Unable to access your current location');
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const resetLocalCartIfNeeded = () => {
    if (isBuyNowCheckout) {
      clearBuyNowCheckout();
      return;
    }

    clearCartState();
  };

  const applyCouponHandler = async () => {
    if (pricingAction) {
      return;
    }

    if (!couponInput.trim()) {
      toast.error('Enter a coupon code');
      return;
    }

    await requestPricingPreview({
      couponCode: couponInput,
      pointsToRedeem: pricingSummary.loyaltyPointsRedeemed,
      action: 'coupon',
      successMessage: 'Coupon applied successfully',
      toastOnSuccess: true,
    });
  };

  const clearCouponHandler = async () => {
    if (pricingAction) {
      return;
    }

    await requestPricingPreview({
      couponCode: '',
      pointsToRedeem: pricingSummary.loyaltyPointsRedeemed,
      action: 'coupon',
      successMessage: 'Coupon removed from this order',
      toastOnSuccess: true,
    });
  };

  const applyPointsHandler = async () => {
    if (pricingAction) {
      return;
    }

    const normalizedPoints = Math.max(0, Math.floor(Number(pointsInput || 0)));

    if (!normalizedPoints) {
      toast.error('Enter how many points you want to redeem');
      return;
    }

    if (minimumRedeemPointsRequired > 0 && normalizedPoints < minimumRedeemPointsRequired) {
      toast.error(`Minimum redemption is ${minimumRedeemPointsRequired} points`);
      return;
    }

    if (normalizedPoints > maxRedeemableForThisOrder) {
      toast.error(`You can redeem up to ${maxRedeemableForThisOrder} points on this order`);
      return;
    }

    await requestPricingPreview({
      couponCode: appliedCouponCode,
      pointsToRedeem: normalizedPoints,
      action: 'points',
      successMessage: 'Rewards applied to this order',
      toastOnSuccess: true,
    });
  };

  const clearPointsHandler = async () => {
    if (pricingAction) {
      return;
    }

    await requestPricingPreview({
      couponCode: appliedCouponCode,
      pointsToRedeem: 0,
      action: 'points',
      successMessage: 'Rewards removed from this order',
      toastOnSuccess: true,
    });
  };

  const initPay = async (order) => {
    if (!razorpayKeyId) {
      toast.error('Razorpay is not configured for this storefront');
      return;
    }

    const loaded = await loadRazorpayScript();
    if (!loaded || typeof window === 'undefined' || typeof window.Razorpay !== 'function') {
      toast.error('Razorpay checkout is unavailable right now. Please refresh and try again.');
      return;
    }

    const options = {
      key: razorpayKeyId,
      amount: order.amount,
      currency: order.currency,
      name: 'Lavish Fashion',
      description: 'Order Payment',
      order_id: order.id,
      receipt: order.receipt,
      handler: async (response) => {
        try {
          const res = await axios.post(BACKEND_URL + '/api/order/verifyRazorpay', response, {
            headers: { token },
          });

          if (res.data.success) {
            clearCheckoutDraft();
            resetLocalCartIfNeeded();
            navigate('/orders');
            return;
          }

          toast.error(res.data.message || 'Payment verification failed');
        } catch (error) {
          toast.error(error?.response?.data?.message || error.message);
        }
      },
      prefill: {
        name: formData.fullName,
        contact: formData.phone,
      },
    };

    const razorpay = new window.Razorpay(options);
    razorpay.open();
  };

  const buildOrderData = () => ({
    address: sanitizeAddressData(formData),
    items: checkoutItems,
    checkoutSource: isBuyNowCheckout && resolvedBuyNowProduct ? 'buy_now' : 'cart',
    couponCode: appliedCouponCode,
    pointsToRedeem: Number(pricingSummary.loyaltyPointsRedeemed || 0),
  });

  const onSubmitHandler = async (event) => {
    event.preventDefault();

    if (isPlacingOrder || isStepTransitioning) {
      return;
    }

    if (currentStep === 0) {
      continueFromAddress();
      return;
    }

    if (currentStep === 1) {
      continueFromPayment();
      return;
    }

    if (!method) {
      toast.error('Please select a payment method');
      return;
    }

    if (!hasAddressInput) {
      toast.error('Please complete your address details');
      return;
    }

    if (method === 'razorpay' && onlinePaymentDisabled) {
      toast.error('Online payment is unavailable for zero-total orders');
      return;
    }

    setIsPlacingOrder(true);

    try {
      const orderData = buildOrderData();

      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = `order-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }

      const idempotencyKey = idempotencyKeyRef.current;

      if (method === 'cod') {
        const codResponse = await axios.post(BACKEND_URL + '/api/order/place', orderData, {
          headers: { token, 'idempotency-key': idempotencyKey },
        });

        if (codResponse.data.success) {
          clearCheckoutDraft();
          resetLocalCartIfNeeded();
          toast.success('Order placed successfully');
          navigate('/orders');
          return;
        }

        toast.error(codResponse.data.message || 'Unable to place COD order');
        return;
      }

      if (method === 'razorpay') {
        const razorpayResponse = await axios.post(BACKEND_URL + '/api/order/razorpay', orderData, {
          headers: { token, 'idempotency-key': idempotencyKey },
        });

        if (razorpayResponse.data.success) {
          initPay(razorpayResponse.data.order);
          return;
        }

        toast.error(razorpayResponse.data.message || 'Failed to initialize Razorpay');
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to place order. Please try again.');
      idempotencyKeyRef.current = '';
    } finally {
      setIsPlacingOrder(false);
    }
  };

  const selectedPaymentLabel =
    method === 'razorpay' ? 'Razorpay' : method === 'cod' ? 'Cash on Delivery' : 'Not selected';
  const selectedPaymentHint =
    method === 'razorpay'
      ? 'You will complete payment securely in Razorpay checkout.'
      : method === 'cod'
        ? 'Pay in cash when your order is delivered.'
        : 'Select one method to continue.';
  const visibleReviewItems = checkoutItems.slice(0, 3);

  const productMap = useMemo(() => {
    const map = {};
    for (const p of products) {
      map[p._id] = p;
    }

    if (isBuyNowCheckout && resolvedBuyNowProduct?._id && !map[resolvedBuyNowProduct._id]) {
      map[resolvedBuyNowProduct._id] = resolvedBuyNowProduct;
    }

    return map;
  }, [isBuyNowCheckout, products, resolvedBuyNowProduct]);

  if (!token) {
    return (
      <div className='checkout-shell checkout-entrance checkout-delay-0 min-h-[70vh] flex flex-col items-center justify-center text-center px-4'>
        <h2 className='text-3xl font-semibold text-slate-900'>Checkout</h2>
        <p className='mt-2 text-base text-slate-600'>Login to continue</p>
        <p className='mt-4 max-w-md text-sm text-slate-500'>Please login to continue and place your order.</p>
        <button
          onClick={() => navigate('/login')}
          className='mt-6 rounded-full bg-slate-950 px-8 py-3 text-sm font-medium text-white transition hover:bg-slate-800'
        >
          Login to continue
        </button>
      </div>
    );
  }

  if (checkoutItems.length === 0) {
    return (
      <div className='checkout-shell checkout-entrance checkout-delay-0 min-h-[70vh] flex flex-col items-center justify-center text-center px-4'>
        <h2 className='text-3xl font-semibold text-slate-900'>Checkout</h2>
        <p className='mt-2 text-base text-slate-600'>No items to review</p>
        <p className='mt-4 max-w-md text-sm text-slate-500'>
          {isBuyNowCheckout
            ? 'Your Buy Now selection is no longer available. Please return to the product page and choose the item again.'
            : 'Add products to your cart or use Buy Now before placing an order.'}
        </p>
        <button
          onClick={() => navigate('/collection')}
          className='mt-6 rounded-full bg-slate-950 px-8 py-3 text-sm font-medium text-white transition hover:bg-slate-800'
        >
          Shop collection
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmitHandler} className='checkout-shell pt-8 sm:pt-10 pb-28 lg:pb-20'>
      <header className='checkout-entrance checkout-delay-0'>
        <h1 className='text-[2rem] sm:text-[2.35rem] font-semibold tracking-[-0.015em] text-[#111] leading-none'>Checkout</h1>
        <p className='mt-2 text-sm text-slate-500'>{itemCount} item{itemCount === 1 ? '' : 's'} ready</p>

        <div className='mt-4 grid grid-cols-3 gap-2'>
          {steps.map((step, index) => (
            <button
              key={step.label}
              type='button'
              onClick={() => goToStep(index)}
              aria-disabled={!stepAccess[index]}
              aria-current={currentStep === index ? 'step' : undefined}
              style={{ animationDelay: `${Math.min(0.08 + index * 0.04, 0.2)}s` }}
              className='checkout-entrance text-left'
              data-step={step.label}
            >
              <div className={`rounded-2xl border px-3 py-2 text-xs transition ${
                currentStep === index
                  ? 'border-slate-900 bg-slate-950 text-white'
                  : index < currentStep
                    ? 'border-slate-300 bg-slate-100 text-slate-900'
                    : stepAccess[index]
                      ? 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                      : 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
              }`}>
                <span className='uppercase tracking-[0.16em]'>0{index + 1}</span>
                <p className='mt-0.5 normal-case tracking-normal text-sm font-medium'>{step.label}</p>
                <p className='mt-0.5 text-[11px] opacity-85'>{step.description}</p>
              </div>
            </button>
          ))}
        </div>
      </header>

      <div className='mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-start'>
        <div className='space-y-4'>
          {currentStep === 0 ? (
            <section className='checkout-entrance checkout-delay-1 rounded-[24px] border border-slate-200 bg-white p-4 sm:p-5'>
              <div className='flex items-start justify-between gap-3'>
                <div>
                  <h2 className='text-lg font-semibold text-slate-900'>Delivery information</h2>
                  <p className='mt-1 text-sm text-slate-500'>Use one complete address to speed up checkout.</p>
                </div>
                <button
                  type='button'
                  onClick={useCurrentLocationHandler}
                  disabled={isLocating}
                  className='rounded-full border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 disabled:opacity-60'
                >
                  {isLocating ? 'Locating...' : 'Use current location'}
                </button>
              </div>

              <div className='mt-4 space-y-3'>
                <input
                  onChange={onChangeHandler}
                  name='fullName'
                  value={formData.fullName}
                  className='w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500'
                  type='text'
                  placeholder='Full Name'
                  maxLength='40'
                  required
                />

                <input
                  onChange={onChangeHandler}
                  name='phone'
                  value={formData.phone}
                  className='w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500'
                  type='text'
                  inputMode='numeric'
                  placeholder='Phone (10 digits)'
                  maxLength='10'
                  required
                />

                <textarea
                  onChange={onChangeHandler}
                  name='address'
                  value={formData.address}
                  className='w-full resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500'
                  rows='3'
                  placeholder='Address'
                  maxLength='120'
                  required
                />

                <div className='grid grid-cols-2 gap-3'>
                  <input
                    onChange={onChangeHandler}
                    name='city'
                    value={formData.city}
                    className='w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500'
                    type='text'
                    placeholder='City'
                    maxLength='25'
                    required
                  />

                  <input
                    onChange={onChangeHandler}
                    name='state'
                    value={formData.state}
                    className='w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500'
                    type='text'
                    placeholder='State'
                    maxLength='25'
                    required
                  />
                </div>

                <input
                  onChange={onChangeHandler}
                  name='pincode'
                  value={formData.pincode}
                  className='w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-500'
                  type='text'
                  inputMode='numeric'
                  placeholder='PIN Code (6 digits)'
                  maxLength='6'
                  required
                />
              </div>
            </section>
          ) : null}

          {currentStep === 1 ? (
            <section className='checkout-entrance checkout-delay-2 rounded-[24px] border border-slate-200 bg-white p-4 sm:p-5'>
              <h2 className='text-lg font-semibold text-slate-900'>Payment</h2>
              <p className='mt-1 text-sm text-slate-500'>Choose a payment method.</p>

              <div className='mt-4 space-y-2.5'>
                <button
                  type='button'
                  onClick={() => setMethod('cod')}
                  className={`w-full rounded-2xl border px-4 py-3 text-left ${
                    method === 'cod' ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
                  }`}
                >
                  <div className='flex items-center justify-between gap-3'>
                    <div>
                      <p className='text-sm font-medium text-slate-900'>Cash on Delivery</p>
                      <p className='mt-0.5 text-xs text-slate-500'>Pay when your order arrives</p>
                    </div>
                    <span className={`h-3 w-3 rounded-full ${method === 'cod' ? 'bg-slate-900' : 'bg-slate-300'}`}></span>
                  </div>
                </button>

                {razorpayEnabled && !onlinePaymentDisabled ? (
                  <button
                    type='button'
                    onClick={() => setMethod('razorpay')}
                    className={`w-full rounded-2xl border px-4 py-3 text-left ${
                      method === 'razorpay' ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
                    }`}
                  >
                    <div className='flex items-center justify-between gap-3'>
                      <div>
                        <p className='text-sm font-medium text-slate-900'>Razorpay</p>
                        <p className='mt-0.5 text-xs text-slate-500'>UPI, Cards, Wallets</p>
                      </div>
                      <span
                        className={`h-3 w-3 rounded-full ${method === 'razorpay' ? 'bg-slate-900' : 'bg-slate-300'}`}
                      ></span>
                    </div>
                  </button>
                ) : null}
              </div>

              {!razorpayEnabled ? (
                <p className='mt-3 text-xs text-slate-500'>Online payment is currently unavailable. Cash on Delivery is enabled.</p>
              ) : null}

              {onlinePaymentDisabled ? (
                <p className='mt-2 text-xs text-slate-500'>Zero-total orders can only be placed with Cash on Delivery.</p>
              ) : null}
            </section>
          ) : null}

          {currentStep === 2 ? (
            <section className='checkout-entrance checkout-delay-2 rounded-[24px] border border-slate-200 bg-white p-4 sm:p-5'>
              <h2 className='text-lg font-semibold text-slate-900'>Review your order</h2>
              <p className='mt-1 text-sm text-slate-500'>Confirm address, payment method, and items before placing the order.</p>

              <div className='mt-4 grid gap-3 sm:grid-cols-2'>
                <article className='rounded-2xl border border-slate-200 bg-slate-50/70 p-3'>
                  <div className='flex items-center justify-between gap-2'>
                    <p className='text-xs uppercase tracking-[0.16em] text-slate-500'>Delivery</p>
                    <button
                      type='button'
                      onClick={() => goToStep(0)}
                      className='text-xs font-medium text-slate-700 underline underline-offset-2'
                    >
                      Edit
                    </button>
                  </div>
                  <div className='mt-2 space-y-1 text-sm text-slate-700'>
                    <p className='font-medium text-slate-900'>{formData.fullName}</p>
                    <p>{formData.phone}</p>
                    <p>{formData.address}</p>
                    <p>{[formData.city, formData.state, formData.pincode].filter(Boolean).join(', ')}</p>
                  </div>
                </article>

                <article className='rounded-2xl border border-slate-200 bg-slate-50/70 p-3'>
                  <div className='flex items-center justify-between gap-2'>
                    <p className='text-xs uppercase tracking-[0.16em] text-slate-500'>Payment</p>
                    <button
                      type='button'
                      onClick={() => goToStep(1)}
                      className='text-xs font-medium text-slate-700 underline underline-offset-2'
                    >
                      Edit
                    </button>
                  </div>
                  <p className='mt-2 text-sm font-medium text-slate-900'>{selectedPaymentLabel}</p>
                  <p className='mt-1 text-xs text-slate-600'>{selectedPaymentHint}</p>
                </article>
              </div>

              <article className='mt-3 rounded-2xl border border-slate-200 p-3'>
                <p className='text-xs uppercase tracking-[0.16em] text-slate-500'>Items</p>
                <ul className='mt-2 space-y-2'>
                  {visibleReviewItems.map((item, index) => {
                    const product = productMap[item._id] || productMap[item.productId];
                    const itemName = product?.name || item.name || 'Unknown product';
                    const itemPrice = Number(product?.price ?? item.price ?? 0);
                    const qty = Number(item.quantity || 0);
                    return (
                      <li key={`${item._id || item.productId || 'item'}-${item.size || ''}-${index}`} className='flex items-center justify-between gap-3 text-sm'>
                        <span className='truncate text-slate-700'>{itemName}</span>
                        <span className='shrink-0 text-slate-500'>x{qty}</span>
                        <span className='shrink-0 font-medium text-slate-900'>
                          {formatCurrency(itemPrice * qty)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {checkoutItems.length > visibleReviewItems.length ? (
                  <p className='mt-2 text-xs text-slate-500'>+ {checkoutItems.length - visibleReviewItems.length} more item(s)</p>
                ) : null}
              </article>
            </section>
          ) : null}
        </div>

        <aside className='space-y-4 lg:sticky lg:top-24'>
          <section className='checkout-entrance checkout-delay-2 rounded-[24px] border border-slate-200 bg-white p-4 sm:p-5'>
            <h2 className='text-lg font-semibold text-slate-900'>Review</h2>
            <p className='mt-1 text-sm text-slate-500'>Subtotal and discounts before payment.</p>

            {isRefreshingPricing ? (
              <div className='mt-4 space-y-2'>
                <div className='lf-shimmer h-3.5 w-32 rounded-full'></div>
                <div className='lf-shimmer h-3.5 w-full rounded-full'></div>
                <div className='lf-shimmer h-3.5 w-2/3 rounded-full'></div>
              </div>
            ) : (
              <div className='mt-4 space-y-2.5 text-sm'>
                <div className='flex items-center justify-between text-slate-600'>
                  <span>Subtotal</span>
                  <span className='font-medium text-slate-900'>{formatCurrency(pricingSummary.subtotal)}</span>
                </div>

                <div className='flex items-center justify-between text-slate-600'>
                  <span>Shipping</span>
                  <span className='font-medium text-slate-900'>
                    {Number(pricingSummary.deliveryFee || 0) === 0 ? 'Free' : formatCurrency(pricingSummary.deliveryFee)}
                  </span>
                </div>

                {Number(pricingSummary.couponDiscountAmount || 0) > 0 ? (
                  <div className='flex items-center justify-between text-emerald-700'>
                    <span>Coupon</span>
                    <span>-{formatCurrency(pricingSummary.couponDiscountAmount)}</span>
                  </div>
                ) : null}

                {Number(pricingSummary.loyaltyDiscountAmount || 0) > 0 ? (
                  <div className='flex items-center justify-between text-sky-700'>
                    <span>Rewards</span>
                    <span>-{formatCurrency(pricingSummary.loyaltyDiscountAmount)}</span>
                  </div>
                ) : null}
              </div>
            )}

            <p className='mt-4 text-xs text-slate-500'>
              Free delivery above {formatCurrency(FREE_DELIVERY_THRESHOLD)}.
            </p>
          </section>

          {currentStep === 2 ? (
            <>
              <section className='checkout-entrance checkout-delay-3 rounded-[24px] border border-slate-200 bg-white p-4 sm:p-5'>
                <button
                  type='button'
                  onClick={() => setCouponOpen((current) => !current)}
                  className='w-full flex items-center justify-between gap-3'
                >
                  <div className='text-left'>
                    <p className='text-base font-semibold text-slate-900'>Coupon</p>
                    <p className='text-xs text-slate-500'>Apply code if you have one</p>
                  </div>
                  <span className='text-lg text-slate-500'>{couponOpen ? '-' : '+'}</span>
                </button>

                {couponOpen ? (
                  <div className='mt-3 space-y-3'>
                    <div className='flex gap-2'>
                      <input
                        value={couponInput}
                        onChange={(event) => setCouponInput(event.target.value.toUpperCase())}
                        className='w-full rounded-full border border-slate-300 px-4 py-2.5 text-sm uppercase'
                        type='text'
                        placeholder='Enter coupon'
                        maxLength='30'
                        disabled={Boolean(appliedCouponCode)}
                      />
                      <button
                        type='button'
                        onClick={applyCouponHandler}
                        disabled={isApplyingCoupon || Boolean(appliedCouponCode)}
                        className='rounded-full bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60'
                      >
                        {isApplyingCoupon ? '...' : 'Apply'}
                      </button>
                    </div>

                    {appliedCouponCode ? (
                      <div className='rounded-2xl bg-emerald-50 px-3 py-3 text-xs text-emerald-800'>
                        <div className='flex items-center justify-between gap-3'>
                          <span>{appliedCouponCode} applied</span>
                          <button type='button' onClick={clearCouponHandler} className='font-semibold'>
                            Remove
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section className='checkout-entrance checkout-delay-4 rounded-[24px] border border-slate-200 bg-white p-4 sm:p-5'>
                <div className='flex items-center justify-between gap-3'>
                  <div>
                    <p className='text-base font-semibold text-slate-900'>Loyalty</p>
                    <p className='text-xs text-slate-500'>Redeem available points</p>
                  </div>
                  <span className='rounded-full bg-sky-50 px-3 py-1 text-sm font-medium text-sky-800'>
                    {availableLoyaltyPoints} pts
                  </span>
                </div>

                <div className='mt-3 flex gap-2'>
                  <input
                    value={pointsInput}
                    onChange={(event) => setPointsInput(event.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                    className='w-full rounded-full border border-slate-300 px-4 py-2.5 text-sm'
                    type='text'
                    inputMode='numeric'
                    placeholder='Enter points'
                    disabled={availableLoyaltyPoints === 0 || !canRedeemOnThisOrder}
                  />
                  <button
                    type='button'
                    onClick={applyPointsHandler}
                    disabled={isApplyingPoints || availableLoyaltyPoints === 0 || !canRedeemOnThisOrder}
                    className='rounded-full bg-slate-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60'
                  >
                    {isApplyingPoints ? '...' : 'Redeem'}
                  </button>
                </div>

                {minimumRedeemPointsRequired > 0 ? (
                  <p className='mt-2 text-xs text-slate-500'>Minimum redemption: {minimumRedeemPointsRequired} pts.</p>
                ) : null}

                {Number(pricingSummary.loyaltyPointsRedeemed || 0) > 0 ? (
                  <div className='mt-3 flex items-center justify-between rounded-2xl bg-sky-50 px-3 py-3 text-xs text-sky-900'>
                    <span>{pricingSummary.loyaltyPointsRedeemed} points applied</span>
                    <button type='button' onClick={clearPointsHandler} className='font-semibold'>
                      Remove
                    </button>
                  </div>
                ) : null}
              </section>
            </>
          ) : (
            <section className='checkout-entrance checkout-delay-3 rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 p-4 sm:p-5'>
              <p className='text-sm font-medium text-slate-800'>Unlock discounts in the review step</p>
              <p className='mt-1 text-xs text-slate-500'>
                {currentStep === 0
                  ? 'Complete your address to continue to payment and unlock coupon/rewards review.'
                  : 'Choose a payment method to unlock coupon and loyalty redemption.'}
              </p>
            </section>
          )}

          <section className='checkout-entrance checkout-delay-4 rounded-[24px] border border-slate-200 bg-white p-4'>
            <div className='flex flex-wrap gap-2'>
              <span className='rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600'>Secure payment</span>
              <span className='rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600'>Easy returns</span>
              <span className='rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600'>Order tracking</span>
            </div>
          </section>
        </aside>
      </div>

      <div
        className='fixed left-1/2 -translate-x-1/2 bottom-3 z-40 w-[calc(100%-1.25rem)] max-w-5xl'
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className='checkout-entrance checkout-delay-5 rounded-2xl border border-slate-200 bg-white/95 px-3 py-3 shadow-[0_10px_28px_rgba(15,23,42,0.12)] backdrop-blur'>
          <div className='flex items-center justify-between gap-3'>
            <div>
              <p className='text-xs uppercase tracking-[0.16em] text-slate-500'>Total</p>
              <p className='mt-0.5 text-xl font-semibold text-slate-900'>{formatCurrency(pricingSummary.total)}</p>
            </div>

            <div className='flex items-center gap-2'>
              {currentStep > 0 ? (
                <button
                  type='button'
                  onClick={() => setCurrentStep((prev) => Math.max(0, prev - 1))}
                  className='rounded-full border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700'
                >
                  Back
                </button>
              ) : null}

              {currentStep < 2 ? (
                <button
                  type='button'
                  onClick={currentStep === 0 ? continueFromAddress : continueFromPayment}
                  className='rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white'
                >
                  {currentStep === 0 ? 'Continue to payment' : 'Continue to review'}
                </button>
              ) : (
                <button
                  type='submit'
                  disabled={isPlacingOrder || isStepTransitioning || !method || !hasAddressInput}
                  className='rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-60 disabled:cursor-not-allowed'
                >
                  {isPlacingOrder ? 'Placing...' : 'Place order'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </form>
  );
};

export default PlaceOrder;
