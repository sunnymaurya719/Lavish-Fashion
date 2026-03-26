import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import Title from '../components/Title';
import OrdersTotal from '../components/OrdersTotal';
import { assets } from '../assets/assets';
import { ShopContext } from '../context/ShopContext';

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
  const [method, setMethod] = useState('');
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [pointsInput, setPointsInput] = useState('');
  const [pricingPreview, setPricingPreview] = useState(null);
  const [pricingAction, setPricingAction] = useState('');
  const idempotencyKeyRef = useRef('');

  const location = useLocation();
  const isBuyNow = location.state?.buyNow;
  const buyNowProduct = location.state?.product;
  const checkoutItems = useMemo(
    () => getCheckoutItems({ isBuyNow, buyNowProduct }),
    [buyNowProduct, getCheckoutItems, isBuyNow]
  );
  const checkoutItemsKey = useMemo(() => JSON.stringify(checkoutItems), [checkoutItems]);

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    street: '',
    city: '',
    state: '',
    pincode: '',
    country: '',
    phone: '',
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
  const availableLoyaltyPoints = Number(pricingSummary.availableLoyaltyPoints || 0);
  const loyaltyRules = pricingSummary.loyaltyRules || null;
  const paymentCapabilities = serverBootstrap?.payments || {};
  const stripeEnabled = serverStatus === 'online' ? Boolean(paymentCapabilities.stripeEnabled) : true;
  const razorpayKeyId = paymentCapabilities.razorpayKeyId || import.meta.env.VITE_RAZORPAY_KEY_ID || '';
  const razorpayEnabled = serverStatus === 'online' ? Boolean(paymentCapabilities.razorpayEnabled && razorpayKeyId) : Boolean(razorpayKeyId);
  const pointValue = Number(loyaltyRules?.pointValue || 1);
  const minRedeemPoints = Number(loyaltyRules?.minRedeemPoints || 0);
  const minimumRedeemPointsRequired = Math.max(0, Math.floor(minRedeemPoints));
  const maxRedeemShare = Math.round(Number(loyaltyRules?.maxRedeemShare || 0) * 100);
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
  const orderRulePointCap = Math.max(
    0,
    Math.min(
      maxRedeemPointsPerOrder,
      perProductPointCap,
      orderValuePointCap || 0
    )
  );
  const maxRedeemableForThisOrder = Math.max(0, Math.min(availableLoyaltyPoints, orderRulePointCap));
  const orderCapBelowMinimum = minimumRedeemPointsRequired > 0 && orderRulePointCap < minimumRedeemPointsRequired;
  const canRedeemOnThisOrder = minimumRedeemPointsRequired > 0
    ? maxRedeemableForThisOrder >= minimumRedeemPointsRequired && !orderCapBelowMinimum
    : maxRedeemableForThisOrder > 0;
  const pointsNeededForMinimumRedemption =
    minimumRedeemPointsRequired > 0 && !orderCapBelowMinimum && maxRedeemableForThisOrder < minimumRedeemPointsRequired
      ? minimumRedeemPointsRequired - maxRedeemableForThisOrder
      : 0;
  const onlinePaymentDisabled = pricingSummary.total <= 0;
  const isRefreshingPricing = pricingAction === 'refresh';
  const isApplyingCoupon = pricingAction === 'coupon';
  const isApplyingPoints = pricingAction === 'points';

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
      await requestPricingPreview({
        action: 'refresh',
        toastOnError: false,
      });
    };

    refreshPricing();
  }, [checkoutItems.length, requestPricingPreview, token]);

  useEffect(() => {
    if (pricingSummary.total <= 0 && (method === 'stripe' || method === 'razorpay')) {
      setMethod('cod');
    }
  }, [pricingSummary.total, method]);

  if (!token) {
    return (
      <div className='min-h-[70vh] flex flex-col items-center justify-center text-center px-4'>
        <h2 className='text-2xl font-semibold mb-2'>Login Required</h2>
        <p className='text-gray-600 mb-6'>Please login to continue and place your order</p>
        <button
          onClick={() => navigate('/login')}
          className='bg-black text-white px-8 py-3 text-sm rounded hover:bg-gray-800 transition'
        >
          LOGIN TO CONTINUE
        </button>
      </div>
    );
  }

  if (checkoutItems.length === 0) {
    return (
      <div className='min-h-[70vh] flex flex-col items-center justify-center text-center px-4 border-t'>
        <h2 className='text-2xl font-semibold mb-2'>Nothing to checkout</h2>
        <p className='text-gray-600 mb-6'>Add products to your cart or start with Buy Now before placing an order.</p>
        <button
          onClick={() => navigate('/collection')}
          className='bg-black text-white px-8 py-3 text-sm rounded hover:bg-gray-800 transition'
        >
          SHOP COLLECTION
        </button>
      </div>
    );
  }

  const onChangeHandler = (event) => {
    const { name, value } = event.target;
    setFormData((currentData) => ({ ...currentData, [name]: value }));
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

    if (minimumRedeemPointsRequired > 0 && !canRedeemOnThisOrder) {
      if (orderCapBelowMinimum) {
        toast.error(
          `This order currently supports up to ${orderRulePointCap} points. Minimum redemption is ${minimumRedeemPointsRequired} points.`
        );
      } else {
        toast.error(`You need at least ${minimumRedeemPointsRequired} points to redeem on this order`);
      }
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
      toast.error('Razorpay checkout is unavailable right now. Please refresh the page or choose another payment method.');
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
    };

    const razorpay = new window.Razorpay(options);
    razorpay.open();
  };

  const buildOrderData = () => ({
    address: formData,
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

    if ((method === 'stripe' || method === 'razorpay') && onlinePaymentDisabled) {
      toast.error('Online payments are unavailable for zero-total orders');
      return;
    }

    setIsPlacingOrder(true);

    try {
      const orderData = buildOrderData();

      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = `order-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }

      const idempotencyKey = idempotencyKeyRef.current;

      switch (method) {
        case 'cod': {
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
          break;
        }

        case 'stripe': {
          const stripeResponse = await axios.post(BACKEND_URL + '/api/order/stripe', orderData, {
            headers: { token, 'idempotency-key': idempotencyKey },
          });

          if (stripeResponse.data.success && stripeResponse.data.session?.url) {
            window.location.replace(stripeResponse.data.session.url);
            return;
          }

          toast.error(stripeResponse.data.message || 'Unable to start Stripe checkout');
          break;
        }

        case 'razorpay': {
          const razorpayResponse = await axios.post(BACKEND_URL + '/api/order/razorpay', orderData, {
            headers: { token, 'idempotency-key': idempotencyKey },
          });

          if (razorpayResponse.data.success) {
            initPay(razorpayResponse.data.order);
            return;
          }

          toast.error(razorpayResponse.data.message || 'Failed to initialize Razorpay');
          break;
        }

        default:
          break;
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to place order. Please try again.');
      idempotencyKeyRef.current = '';
    } finally {
      setIsPlacingOrder(false);
    }
  };

  return (
    <form
      onSubmit={onSubmitHandler}
      className='flex flex-col sm:flex-row justify-between gap-6 pt-5 sm:pt-14 min-h-[80vh] border-t'
    >
      <div className='flex flex-col gap-4 w-full sm:max-w-[450px]'>
        <div className='text-xl sm:text-2xl my-3'>
          <Title text1='DELIVERY' text2='INFORMATION' />
        </div>
        <div className='flex gap-3'>
          <input
            onChange={onChangeHandler}
            name='firstName'
            value={formData.firstName}
            className='border border-gray-300 rounded py-1.5 px-3.5 w-full'
            type='text'
            placeholder='First name'
            maxLength='15'
            required
          />
          <input
            onChange={onChangeHandler}
            name='lastName'
            value={formData.lastName}
            className='border border-gray-300 rounded py-1.5 px-3.5 w-full'
            type='text'
            placeholder='Last name'
            maxLength='15'
            required
          />
        </div>
        <input
          onChange={onChangeHandler}
          name='phone'
          value={formData.phone}
          className='border border-gray-300 rounded py-1.5 px-3.5 w-full'
          type='text'
          placeholder='Phone number'
          maxLength='20'
          required
        />
        <input
          onChange={onChangeHandler}
          name='street'
          value={formData.street}
          className='border border-gray-300 rounded py-1.5 px-3.5 w-full'
          type='text'
          placeholder='Street'
          maxLength='60'
          required
        />
        <div className='flex gap-3'>
          <input
            onChange={onChangeHandler}
            name='city'
            value={formData.city}
            className='border border-gray-300 rounded py-1.5 px-3.5 w-full'
            type='text'
            placeholder='City'
            maxLength='25'
            required
          />
          <input
            onChange={onChangeHandler}
            name='state'
            value={formData.state}
            className='border border-gray-300 rounded py-1.5 px-3.5 w-full'
            type='text'
            placeholder='State'
            maxLength='25'
            required
          />
        </div>
        <div className='flex gap-3'>
          <input
            onChange={onChangeHandler}
            name='pincode'
            value={formData.pincode}
            className='border border-gray-300 rounded py-1.5 px-3.5 w-full'
            type='text'
            placeholder='PIN code'
            maxLength='12'
            required
          />
          <input
            onChange={onChangeHandler}
            name='country'
            value={formData.country}
            className='border border-gray-300 rounded py-1.5 px-3.5 w-full'
            type='text'
            placeholder='Country'
            maxLength='20'
            required
          />
        </div>
      </div>

      <div className='mt-8 w-full max-w-[420px]'>
            <div className='rounded-3xl border border-gray-200 bg-white p-6 shadow-sm'>
          <OrdersTotal
            isBuyNow={isBuyNow}
            buyNowProduct={buyNowProduct}
            subtotal={pricingSummary.subtotal}
            deliveryFee={pricingSummary.deliveryFee}
            discountAmount={pricingSummary.discountAmount}
            couponDiscountAmount={pricingSummary.couponDiscountAmount}
            loyaltyDiscountAmount={pricingSummary.loyaltyDiscountAmount}
            loyaltyPointsRedeemed={pricingSummary.loyaltyPointsRedeemed}
            total={pricingSummary.total}
            couponCode={appliedCouponCode}
          />

          {isRefreshingPricing ? (
            <p className='mt-4 text-xs text-slate-500'>Refreshing server-side pricing for the current checkout...</p>
          ) : null}

          {serverStatus === 'offline' ? (
            <p className='mt-3 text-xs text-rose-700'>
              Live server capability checks are currently unavailable. Checkout actions may fail until the API reconnects.
            </p>
          ) : null}
        </div>

        <div className='mt-5 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm'>
          <p className='text-sm font-semibold text-slate-900'>Offer code</p>
          <p className='mt-1 text-sm text-slate-500'>Validate coupon pricing directly against the server before payment.</p>
          <div className='mt-4 flex gap-3'>
            <input
              value={couponInput}
              onChange={(event) => setCouponInput(event.target.value.toUpperCase())}
              className='w-full rounded-2xl border border-slate-300 px-4 py-3 uppercase'
              type='text'
              placeholder='Enter coupon code'
              maxLength='30'
              disabled={Boolean(appliedCouponCode)}
            />
            <button
              type='button'
              onClick={applyCouponHandler}
              disabled={isApplyingCoupon || Boolean(appliedCouponCode)}
              className='rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white disabled:opacity-60'
            >
              {isApplyingCoupon ? 'Checking...' : 'Apply'}
            </button>
          </div>

          {appliedCouponCode ? (
            <div className='mt-4 rounded-2xl bg-emerald-50 px-4 py-4 text-sm text-emerald-900'>
              <div className='flex items-start justify-between gap-4'>
                <div>
                  <p className='font-medium'>{appliedCouponCode} applied</p>
                  <p className='mt-1 text-emerald-800'>
                    {pricingSummary.appliedCoupon?.description || 'Discount is now reflected in your order total.'}
                  </p>
                </div>
                <button type='button' onClick={clearCouponHandler} className='text-xs font-semibold uppercase tracking-[0.2em]'>
                  Remove
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className='mt-5 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm'>
          <div className='flex items-start justify-between gap-4'>
            <div>
              <p className='text-sm font-semibold text-slate-900'>Loyalty redemption</p>
              <p className='mt-1 text-sm text-slate-500'>Redeem points with a live checkout preview from the server.</p>
            </div>
            <div className='rounded-2xl bg-sky-50 px-4 py-3 text-right'>
              <p className='text-xs uppercase tracking-[0.2em] text-sky-600'>Available</p>
              <p className='mt-1 text-lg font-semibold text-sky-900'>{availableLoyaltyPoints} pts</p>
            </div>
          </div>

          <div className='mt-4 flex gap-3'>
            <input
              value={pointsInput}
              onChange={(event) => setPointsInput(event.target.value.replace(/[^\d]/g, '').slice(0, 6))}
              className='w-full rounded-2xl border border-slate-300 px-4 py-3'
              type='text'
              inputMode='numeric'
              placeholder='Enter points to redeem'
              disabled={availableLoyaltyPoints === 0 || !canRedeemOnThisOrder}
            />
            <button
              type='button'
              onClick={applyPointsHandler}
              disabled={isApplyingPoints || availableLoyaltyPoints === 0 || !canRedeemOnThisOrder}
              className='rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white disabled:opacity-60'
            >
              {isApplyingPoints ? 'Checking...' : 'Redeem'}
            </button>
          </div>

          {loyaltyRules ? (
            <div className='mt-4 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600'>
              <p>Minimum redemption for this order: {minimumRedeemPointsRequired} points.</p>
              <p className='mt-1'>Point value: 1 point = Rs {pointValue.toFixed(0)}.</p>
              <p className='mt-1'>Up to {maxRedeemShare}% of the coupon-adjusted order can be covered with points.</p>
              <p className='mt-1'>Per-product cap: {Number(loyaltyRules.maxRedeemPointsPerProduct || 0)} points each.</p>
              <p className='mt-1'>
                Current order cap: {orderRulePointCap} points
                {Number.isFinite(Number(loyaltyRules.maxRedeemPointsPerOrder))
                  ? ` (hard cap ${Number(loyaltyRules.maxRedeemPointsPerOrder)} per order)`
                  : ''}
                .
              </p>
              {orderCapBelowMinimum ? (
                <p className='mt-2 text-amber-700'>
                  This order does not currently meet the minimum redemption threshold of {minimumRedeemPointsRequired} points.
                </p>
              ) : null}
              {pointsNeededForMinimumRedemption > 0 ? (
                <p className='mt-2 text-amber-700'>
                  You need {pointsNeededForMinimumRedemption} more points to unlock redemption for this checkout.
                </p>
              ) : null}
            </div>
          ) : null}

          {Number(pricingSummary.loyaltyPointsRedeemed || 0) > 0 ? (
            <div className='mt-4 rounded-2xl bg-sky-50 px-4 py-4 text-sm text-sky-900'>
              <div className='flex items-start justify-between gap-4'>
                <div>
                  <p className='font-medium'>{pricingSummary.loyaltyPointsRedeemed} points reserved</p>
                  <p className='mt-1 text-sky-800'>
                    This redemption will remain reserved until payment succeeds or the COD order is finalized.
                  </p>
                </div>
                <button type='button' onClick={clearPointsHandler} className='text-xs font-semibold uppercase tracking-[0.2em]'>
                  Remove
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className='mt-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm'>
          <Title text1='PAYMENT' text2='METHOD' />

          <div className='mt-4 flex gap-3 flex-col'>
            <button
              type='button'
              onClick={() => setMethod('cod')}
              className={`flex items-center justify-between gap-3 border p-4 px-4 cursor-pointer rounded-2xl ${
                method === 'cod' ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
              }`}
            >
              <div className='flex items-center gap-3'>
                <p className={`min-w-3.5 h-3.5 border rounded-full ${method === 'cod' ? 'bg-green-400 border-green-400' : ''}`}></p>
                <span className='text-sm font-medium text-gray-700'>Cash on Delivery</span>
              </div>
              <span className='text-xs uppercase tracking-[0.2em] text-slate-500'>Flexible</span>
            </button>

            <button
              type='button'
              onClick={() => {
                if (!onlinePaymentDisabled && stripeEnabled) {
                  setMethod('stripe');
                }
              }}
              className={`flex items-center justify-between gap-3 border p-4 px-4 cursor-pointer rounded-2xl ${
                method === 'stripe' ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
              } ${onlinePaymentDisabled || !stripeEnabled ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <div className='flex items-center gap-3'>
                <p className={`min-w-3.5 h-3.5 border rounded-full ${method === 'stripe' ? 'bg-green-400 border-green-400' : ''}`}></p>
                <img className='h-5' src={assets.stripe_logo} alt='Stripe' />
              </div>
              <span className='text-xs uppercase tracking-[0.2em] text-slate-500'>
                {stripeEnabled ? 'Card checkout' : 'Unavailable'}
              </span>
            </button>

            <button
              type='button'
              onClick={() => {
                if (!onlinePaymentDisabled && razorpayEnabled) {
                  setMethod('razorpay');
                }
              }}
              className={`flex items-center justify-between gap-3 border p-4 px-4 cursor-pointer rounded-2xl ${
                method === 'razorpay' ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
              } ${onlinePaymentDisabled || !razorpayEnabled ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <div className='flex items-center gap-3'>
                <p className={`min-w-3.5 h-3.5 border rounded-full ${method === 'razorpay' ? 'bg-green-400 border-green-400' : ''}`}></p>
                <img className='h-5' src={assets.razorpay_logo} alt='Razorpay' />
              </div>
              <span className='text-xs uppercase tracking-[0.2em] text-slate-500'>
                {razorpayEnabled ? 'UPI and wallet' : 'Unavailable'}
              </span>
            </button>
          </div>

          <p className='mt-4 text-xs text-gray-500'>
            Choose COD to pay when your order arrives, or complete the payment online with Stripe or Razorpay.
          </p>

          {!stripeEnabled || !razorpayEnabled ? (
            <p className='mt-2 text-xs text-slate-500'>
              Server capability sync: Stripe is {stripeEnabled ? 'enabled' : 'disabled'} and Razorpay is{' '}
              {razorpayEnabled ? 'enabled' : 'disabled'} for this deployment.
            </p>
          ) : null}

          {onlinePaymentDisabled ? (
            <p className='mt-2 text-xs text-amber-700'>
              This order currently totals zero after discounts, so online payment is disabled.
            </p>
          ) : null}

          <div className='w-full text-end mt-8'>
            <button
              type='submit'
              disabled={isPlacingOrder}
              className='bg-black text-white px-16 py-3 text-sm disabled:opacity-60 disabled:cursor-not-allowed'
            >
              {isPlacingOrder ? 'PLACING ORDER...' : 'PLACE ORDER'}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
};

export default PlaceOrder;
