import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import { ShopContext } from '../context/ShopContext';

const FREE_DELIVERY_THRESHOLD = 999;

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
    setCartItems,
    getCartAmount,
    delivery_fee,
    getCheckoutItems,
    serverBootstrap,
    serverStatus,
  } = useContext(ShopContext);

  const location = useLocation();
  const isBuyNow = location.state?.buyNow;
  const buyNowProduct = location.state?.product;

  const [method, setMethod] = useState('cod');
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [pointsInput, setPointsInput] = useState('');
  const [pricingPreview, setPricingPreview] = useState(null);
  const [pricingAction, setPricingAction] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const idempotencyKeyRef = useRef('');

  const checkoutItems = useMemo(
    () => getCheckoutItems({ isBuyNow, buyNowProduct }),
    [buyNowProduct, getCheckoutItems, isBuyNow]
  );
  const checkoutItemsKey = useMemo(() => JSON.stringify(checkoutItems), [checkoutItems]);

  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
  });

  const baseSubtotal =
    isBuyNow && buyNowProduct ? Number(buyNowProduct.price || 0) * Number(buyNowProduct.quantity || 1) : getCartAmount();

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

  const hasAddressInput =
    Boolean(formData.fullName.trim()) &&
    Boolean(formData.phone.trim()) &&
    Boolean(formData.address.trim()) &&
    Boolean(formData.city.trim()) &&
    Boolean(formData.state.trim()) &&
    Boolean(formData.pincode.trim());

  const steps = [
    { label: 'Address', active: hasAddressInput },
    { label: 'Payment', active: Boolean(method) },
    { label: 'Review', active: itemCount > 0 },
  ];

  useEffect(() => {
    setPricingPreview(null);
    setCouponInput('');
    setPointsInput('');
    idempotencyKeyRef.current = '';
  }, [checkoutItemsKey]);

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

  const onChangeHandler = (event) => {
    const { name, value } = event.target;
    setFormData((currentData) => ({ ...currentData, [name]: value }));
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
    if (!isBuyNow) {
      setCartItems({});
    }
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

  const initPay = (order) => {
    if (!razorpayKeyId) {
      toast.error('Razorpay is not configured for this storefront');
      return;
    }

    if (typeof window === 'undefined' || typeof window.Razorpay !== 'function') {
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
    checkoutSource: isBuyNow && buyNowProduct ? 'buy_now' : 'cart',
    couponCode: appliedCouponCode,
    pointsToRedeem: Number(pricingSummary.loyaltyPointsRedeemed || 0),
  });

  const onSubmitHandler = async (event) => {
    event.preventDefault();

    if (isPlacingOrder) {
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
        <p className='mt-4 max-w-md text-sm text-slate-500'>Add products to your cart or use Buy Now before placing an order.</p>
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
            <div
              key={step.label}
              style={{ animationDelay: `${Math.min(0.08 + index * 0.04, 0.2)}s` }}
              className='checkout-entrance'
              data-step={step.label}
            >
              <div className={`rounded-full px-3 py-2 text-center text-xs font-medium ${
                step.active ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-500'
              }`}>
                <span className='uppercase tracking-[0.16em]'>0{index + 1}</span>
                <p className='mt-0.5 normal-case tracking-normal'>{step.label}</p>
              </div>
            </div>
          ))}
        </div>
      </header>

      <div className='mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-start'>
        <div className='space-y-4'>
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
                placeholder='Phone'
                maxLength='20'
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
                placeholder='PIN Code'
                maxLength='12'
                required
              />
            </div>
          </section>

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
          </section>
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

            <button
              type='submit'
              disabled={isPlacingOrder || !method || !hasAddressInput}
              className='rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-60 disabled:cursor-not-allowed'
            >
              {isPlacingOrder ? 'Placing...' : 'Place order'}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
};

export default PlaceOrder;
