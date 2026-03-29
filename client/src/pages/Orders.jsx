import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ShopContext } from '../context/ShopContext';
import { getFitFeedbackHistory, submitFitFeedback as submitFitFeedbackRequest } from '../services/fitApi';

const STATUS_STYLES = {
  delivered: {
    label: 'Delivered',
    badgeClass: 'bg-emerald-50 text-emerald-700',
    dotClass: 'bg-emerald-500',
  },
  shipped: {
    label: 'Shipped',
    badgeClass: 'bg-sky-50 text-sky-700',
    dotClass: 'bg-sky-500',
  },
  'out for delivery': {
    label: 'Out for delivery',
    badgeClass: 'bg-blue-50 text-blue-700',
    dotClass: 'bg-blue-500',
  },
  packing: {
    label: 'Packing',
    badgeClass: 'bg-amber-50 text-amber-700',
    dotClass: 'bg-amber-500',
  },
  'order placed': {
    label: 'Order placed',
    badgeClass: 'bg-slate-100 text-slate-700',
    dotClass: 'bg-slate-500',
  },
  cancelled: {
    label: 'Cancelled',
    badgeClass: 'bg-rose-50 text-rose-700',
    dotClass: 'bg-rose-500',
  },
};

const DELIVERY_STEPS = ['Order placed', 'Shipped', 'Delivered'];
const FIT_FEEDBACK_OPTIONS = [
  { value: 'too_small', label: 'Too small' },
  { value: 'perfect', label: 'Perfect fit' },
  { value: 'too_large', label: 'Too large' },
];
const FIT_FEEDBACK_LABELS = {
  too_small: 'Too small',
  perfect: 'Perfect fit',
  too_large: 'Too large',
};

const formatMoney = (currency, value) => {
  const amount = Number(value || 0);
  return `${currency}${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
};

const formatDate = (value, { includeTime = false } = {}) => {
  if (!value) {
    return 'N/A';
  }

  const normalizedDate = new Date(Number(value) || value);
  if (Number.isNaN(normalizedDate.getTime())) {
    return 'N/A';
  }

  if (includeTime) {
    return normalizedDate.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return normalizedDate.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const getStatusStyle = (status) => {
  const key = String(status || '').trim().toLowerCase();
  return (
    STATUS_STYLES[key] || {
      label: status || 'Processing',
      badgeClass: 'bg-slate-100 text-slate-700',
      dotClass: 'bg-slate-500',
    }
  );
};

const getPaymentMeta = (order) => {
  const method = order.paymentMethod || 'Payment';
  const paymentState = String(order.paymentStatus || '').toLowerCase();

  if (order.payment || paymentState === 'paid') {
    return {
      summary: `${method} paid`,
      badgeClass: 'bg-emerald-50 text-emerald-700',
    };
  }

  if (paymentState === 'failed') {
    return {
      summary: `${method} failed`,
      badgeClass: 'bg-rose-50 text-rose-700',
    };
  }

  if (method === 'COD') {
    return {
      summary: 'Cash on delivery',
      badgeClass: 'bg-amber-50 text-amber-700',
    };
  }

  return {
    summary: `${method} pending`,
    badgeClass: 'bg-sky-50 text-sky-700',
  };
};

const getAddressData = (address) => {
  if (!address) {
    return {
      compactName: '',
      compactCity: '',
      phone: '',
      fullAddress: '',
    };
  }

  const compactName = [address.firstName, address.lastName].filter(Boolean).join(' ').trim();
  const compactCity = [address.city, address.state].filter(Boolean).join(', ');
  const phone = String(address.phone || '').trim();
  const fullAddress = [
    [address.firstName, address.lastName].filter(Boolean).join(' ').trim(),
    address.street,
    [address.city, address.state, address.pincode].filter(Boolean).join(', '),
    address.country,
    phone ? `Phone: ${phone}` : '',
  ]
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .join(', ');

  return {
    compactName,
    compactCity,
    phone,
    fullAddress,
  };
};

const calculateItemsValue = (items = []) =>
  items.reduce((total, item) => total + Number(item.price || 0) * Number(item.quantity || 0), 0);

const getOrderCode = (orderId = '') => `LF-${String(orderId).slice(-8).toUpperCase()}`;

const getTimelineIndex = (status) => {
  const normalizedStatus = String(status || '').trim().toLowerCase();

  if (normalizedStatus === 'delivered') {
    return 2;
  }

  if (normalizedStatus === 'shipped' || normalizedStatus === 'out for delivery') {
    return 1;
  }

  return 0;
};

const buildFitFeedbackKey = (orderId, productId) => `${orderId}:${productId}`;

const buildFitFeedbackMap = (entries = []) =>
  entries.reduce((accumulator, entry) => {
    const feedbackKey = buildFitFeedbackKey(entry.orderId, entry.productId);
    accumulator[feedbackKey] = entry;
    return accumulator;
  }, {});

const formatFitConfidence = (value) => `${Math.round(Number(value || 0) * 100)}%`;

const Orders = () => {
  const { BACKEND_URL, token, currency, navigate, toast } = useContext(ShopContext);
  const [orderData, setOrderData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [expandedOrders, setExpandedOrders] = useState({});
  const [expandedAddresses, setExpandedAddresses] = useState({});
  const [fitFeedbackMap, setFitFeedbackMap] = useState({});
  const [submittingFitFeedbackKey, setSubmittingFitFeedbackKey] = useState('');

  const refreshFitFeedbackHistory = useCallback(
    async ({ silent = true } = {}) => {
      if (!token) {
        setFitFeedbackMap({});
        return null;
      }

      try {
        const response = await getFitFeedbackHistory({ backendUrl: BACKEND_URL, token });

        if (response.success) {
          setFitFeedbackMap(buildFitFeedbackMap(response.feedback || []));
        }

        return response;
      } catch (error) {
        if (!silent) {
          toast.error(error?.response?.data?.message || 'Unable to load fit feedback history right now.');
        }

        return null;
      }
    },
    [BACKEND_URL, toast, token]
  );

  const fetchOrders = useCallback(
    async ({ silent = false } = {}) => {
      if (!token) {
        setOrderData([]);
        setFitFeedbackMap({});
        return;
      }

      if (silent) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      setFetchError('');

      try {
        const [response, fitFeedbackResponse] = await Promise.all([
          axios.post(BACKEND_URL + '/api/order/userorders', {}, { headers: { token } }),
          getFitFeedbackHistory({ backendUrl: BACKEND_URL, token }).catch(() => null),
        ]);

        if (response.data.success) {
          setOrderData(response.data.orders || []);
          setFitFeedbackMap(
            fitFeedbackResponse?.success ? buildFitFeedbackMap(fitFeedbackResponse.feedback || []) : {}
          );
          return;
        }

        setFetchError(response.data.message || 'Unable to load your orders right now.');
      } catch (error) {
        console.error('Error while fetching orders', error);
        setFetchError(error?.response?.data?.message || 'Unable to load your orders right now.');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [BACKEND_URL, token]
  );

  const orderStats = useMemo(() => {
    const totalOrders = orderData.length;
    const deliveredOrders = orderData.filter(
      (order) => String(order.status || '').trim().toLowerCase() === 'delivered'
    ).length;
    const activeOrders = orderData.filter(
      (order) => !['delivered', 'cancelled'].includes(String(order.status || '').trim().toLowerCase())
    ).length;
    const totalSpend = orderData.reduce((total, order) => total + Number(order.amount || 0), 0);

    return {
      totalOrders,
      deliveredOrders,
      activeOrders,
      totalSpend,
    };
  }, [orderData]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const toggleOrderDetails = (orderId) => {
    setExpandedOrders((current) => ({
      ...current,
      [orderId]: !current[orderId],
    }));
  };

  const toggleAddress = (orderId) => {
    setExpandedAddresses((current) => ({
      ...current,
      [orderId]: !current[orderId],
    }));
  };

  const handleSubmitFitFeedback = async ({ orderId, item, feedback }) => {
    const feedbackKey = buildFitFeedbackKey(orderId, item._id);

    if (submittingFitFeedbackKey === feedbackKey) {
      return;
    }

    setSubmittingFitFeedbackKey(feedbackKey);

    try {
      const response = await submitFitFeedbackRequest({
        backendUrl: BACKEND_URL,
        token,
        productId: item._id,
        orderId,
        selectedSize: item.size,
        recommendedSize: item.fitAssistant.recommendedSize,
        feedback,
        source: item.fitAssistant.source || 'manual',
        confidence: item.fitAssistant.confidence,
        modelVersion: item.fitAssistant.modelVersion || '',
      });

      if (!response.success) {
        toast.error(response.message || 'Unable to record fit feedback right now.');
        return;
      }

      setFitFeedbackMap((current) => ({
        ...current,
        [feedbackKey]: {
          productId: item._id,
          orderId,
          selectedSize: item.size,
          recommendedSize: item.fitAssistant.recommendedSize,
          feedback,
          source: item.fitAssistant.source || 'manual',
          confidence: item.fitAssistant.confidence ?? null,
          modelVersion: item.fitAssistant.modelVersion || '',
          createdAt: new Date().toISOString(),
        },
      }));
      toast.success('Fit feedback saved. Thanks for helping improve sizing.');
    } catch (error) {
      if (Number(error?.response?.status || 0) === 409) {
        await refreshFitFeedbackHistory({ silent: true });
        toast.info('Fit feedback was already submitted for this item.');
        return;
      }

      toast.error(error?.response?.data?.message || 'Unable to record fit feedback right now.');
    } finally {
      setSubmittingFitFeedbackKey('');
    }
  };

  return (
    <section className='orders-shell pt-6 sm:pt-8'>
      <div className='orders-entrance orders-delay-0 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <h1 className='text-[2rem] sm:text-[2.35rem] font-semibold tracking-[-0.015em] text-[#111] leading-none'>
            Orders
          </h1>
          <p className='mt-2 text-sm text-[#777]'>Track and manage your purchases</p>
        </div>

        <button
          type='button'
          onClick={() => fetchOrders({ silent: true })}
          disabled={isRefreshing || isLoading || !token}
          className='w-full sm:w-auto rounded-full bg-white px-5 py-3 text-sm font-medium text-[#111] shadow-[0_6px_18px_rgba(15,23,42,0.06)] disabled:cursor-not-allowed disabled:opacity-60'
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh orders'}
        </button>
      </div>

      {token && (
        <div className='orders-entrance orders-delay-1 mt-4 rounded-2xl bg-white px-4 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)]'>
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
            <div>
              <p className='text-[10px] uppercase tracking-[0.2em] text-slate-500'>Total</p>
              <p className='mt-1 text-xl font-semibold text-slate-900'>{orderStats.totalOrders}</p>
            </div>
            <div>
              <p className='text-[10px] uppercase tracking-[0.2em] text-slate-500'>Active</p>
              <p className='mt-1 text-xl font-semibold text-slate-900'>{orderStats.activeOrders}</p>
            </div>
            <div>
              <p className='text-[10px] uppercase tracking-[0.2em] text-slate-500'>Delivered</p>
              <p className='mt-1 text-xl font-semibold text-slate-900'>{orderStats.deliveredOrders}</p>
            </div>
            <div>
              <p className='text-[10px] uppercase tracking-[0.2em] text-slate-500'>Spend</p>
              <p className='mt-1 text-xl font-semibold text-slate-900'>{formatMoney(currency, orderStats.totalSpend)}</p>
            </div>
          </div>
        </div>
      )}

      {token && isRefreshing && !isLoading && (
        <div className='orders-entrance orders-delay-2 mt-3 space-y-2'>
          <div className='lf-shimmer h-2.5 w-40 rounded-full'></div>
          <div className='lf-shimmer h-2 w-full rounded-full'></div>
        </div>
      )}

      {isLoading && (
        <div className='orders-entrance orders-delay-2 mt-5 space-y-3'>
          <div className='rounded-2xl bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)]'>
            <div className='lf-shimmer h-4 w-28 rounded-full'></div>
            <div className='mt-3 lf-shimmer h-8 w-52 rounded-full'></div>
            <div className='mt-4 lf-shimmer h-24 rounded-2xl'></div>
          </div>
          <div className='rounded-2xl bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)]'>
            <div className='lf-shimmer h-4 w-28 rounded-full'></div>
            <div className='mt-3 lf-shimmer h-8 w-48 rounded-full'></div>
            <div className='mt-4 lf-shimmer h-24 rounded-2xl'></div>
          </div>
        </div>
      )}

      {!isLoading && fetchError && (
        <div className='orders-entrance orders-delay-2 mt-5 rounded-2xl bg-rose-50 p-4'>
          <p className='text-sm text-rose-700'>{fetchError}</p>
          <button
            type='button'
            onClick={() => fetchOrders()}
            className='mt-3 rounded-full bg-white px-4 py-2 text-sm font-medium text-rose-700'
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && !fetchError && token && orderData.length === 0 && (
        <div className='orders-entrance orders-delay-2 mt-5 rounded-2xl bg-white p-8 text-center shadow-[0_8px_24px_rgba(15,23,42,0.06)]'>
          <p className='text-lg font-semibold text-slate-900'>No orders yet</p>
          <p className='mt-2 text-sm text-slate-500'>Your completed purchases will appear here after checkout.</p>
        </div>
      )}

      {!isLoading && !fetchError && !token && (
        <div className='orders-entrance orders-delay-2 mt-5 rounded-2xl bg-white p-8 text-center shadow-[0_8px_24px_rgba(15,23,42,0.06)]'>
          <p className='text-lg font-semibold text-slate-900'>Sign in to view your orders</p>
          <p className='mt-2 text-sm text-slate-500'>Order history is available after login.</p>
        </div>
      )}

      {!isLoading && !fetchError && orderData.length > 0 && (
        <div className='mt-5 space-y-4'>
          {orderData.map((order, index) => {
            const statusMeta = getStatusStyle(order.status);
            const paymentMeta = getPaymentMeta(order);
            const subtotal = Number(order.subtotal || calculateItemsValue(order.items));
            const deliveryFee = Number(order.deliveryFee || 0);
            const discount = Number(order.discountAmount || 0);
            const amount = Number(order.amount || 0);
            const itemCount = (order.items || []).length;
            const primaryItem = order.items?.[0];
            const imageSrc = Array.isArray(primaryItem?.image) && primaryItem.image.length > 0 ? primaryItem.image[0] : '';
            const timelineIndex = getTimelineIndex(order.status);
            const isExpanded = Boolean(expandedOrders[order._id]);
            const isAddressExpanded = Boolean(expandedAddresses[order._id]);
            const addressData = getAddressData(order.address);
            const isDelivered = String(order.status || '').trim().toLowerCase() === 'delivered';
            const fitFeedbackItems = isDelivered
              ? (order.items || []).filter(
                  (item) => item?.size && String(item?.fitAssistant?.recommendedSize || '').trim()
                )
              : [];

            return (
              <article
                key={order._id}
                className='orders-entrance rounded-[24px] bg-white p-4 sm:p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]'
                style={{ animationDelay: `${Math.min(0.12 + index * 0.06, 0.5)}s` }}
              >
                <header className='flex items-start justify-between gap-3'>
                  <div>
                    <p className='text-[10px] uppercase tracking-[0.2em] text-slate-500'>Order ID</p>
                    <p className='mt-1 text-[1.7rem] sm:text-3xl font-semibold tracking-[-0.015em] text-slate-900'>
                      {getOrderCode(order._id)}
                    </p>
                    <p className='mt-1 text-sm text-slate-500'>Placed on {formatDate(order.date, { includeTime: true })}</p>
                  </div>
                  <p className='text-base sm:text-lg font-semibold text-slate-900'>{formatMoney(currency, amount)}</p>
                </header>

                <div className='mt-3 flex flex-wrap gap-2'>
                  <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${statusMeta.badgeClass}`}>
                    <span className={`h-2 w-2 rounded-full ${statusMeta.dotClass}`}></span>
                    {statusMeta.label}
                  </span>
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${paymentMeta.badgeClass}`}>
                    {paymentMeta.summary}
                  </span>
                </div>

                <div className='mt-4 flex gap-3 rounded-2xl bg-[#f7f7f7] p-3'>
                  {imageSrc ? (
                    <img
                      src={imageSrc}
                      alt={primaryItem?.name || 'Ordered item'}
                      className='h-20 w-16 shrink-0 rounded-xl object-cover bg-white'
                    />
                  ) : (
                    <div className='h-20 w-16 shrink-0 rounded-xl bg-slate-200'></div>
                  )}

                  <div className='min-w-0'>
                    <p className='text-base font-medium text-slate-900 line-clamp-2'>
                      {primaryItem?.name || 'Order items'}
                    </p>
                    <p className='mt-1 text-sm text-slate-500'>
                      {itemCount} item{itemCount > 1 ? 's' : ''} in this order
                    </p>
                    <p className='mt-1 text-sm text-slate-700'>
                      {primaryItem?.quantity ? `Qty: ${primaryItem.quantity}` : ''}{' '}
                      {primaryItem?.size ? `Size: ${primaryItem.size}` : ''}
                    </p>
                  </div>
                </div>

                <div className='mt-4 grid grid-cols-2 gap-2.5'>
                  <button
                    type='button'
                    onClick={() => setExpandedOrders((current) => ({ ...current, [order._id]: true }))}
                    className='rounded-full bg-slate-950 px-4 py-3 text-sm font-medium text-white'
                  >
                    Track order
                  </button>
                  <button
                    type='button'
                    onClick={() => {
                      if (isDelivered) {
                        navigate('/collection');
                        return;
                      }

                      toggleOrderDetails(order._id);
                    }}
                    className='rounded-full border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700'
                  >
                    {isDelivered ? 'Reorder' : isExpanded ? 'Hide details' : 'View details'}
                  </button>
                </div>

                <div className='mt-4'>
                  <p className='text-[10px] uppercase tracking-[0.2em] text-slate-500'>Delivery timeline</p>
                  <div className='mt-2 grid grid-cols-3 gap-2'>
                    {DELIVERY_STEPS.map((step, index) => {
                      const active = index <= timelineIndex;

                      return (
                        <div key={`${order._id}-${step}`} className='flex flex-col items-center text-center'>
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${active ? 'bg-slate-900' : 'bg-slate-300'}`}
                          ></span>
                          <p className={`mt-1 text-[11px] ${active ? 'text-slate-800' : 'text-slate-400'}`}>{step}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {isExpanded && (
                  <div className='mt-4 space-y-3 border-t border-slate-100 pt-4'>
                    <div className='rounded-2xl bg-[#f7f7f7] p-3'>
                      <p className='text-[10px] uppercase tracking-[0.2em] text-slate-500'>Shipping</p>
                      {addressData.compactName || addressData.compactCity || addressData.phone ? (
                        <div className='mt-2 text-sm text-slate-700 space-y-0.5'>
                          <p>{addressData.compactName}</p>
                          <p>{addressData.compactCity}</p>
                          <p>{addressData.phone ? `Phone: ${addressData.phone}` : ''}</p>
                        </div>
                      ) : (
                        <p className='mt-2 text-sm text-slate-500'>Address details unavailable.</p>
                      )}

                      {addressData.fullAddress ? (
                        <>
                          {isAddressExpanded ? (
                            <p className='mt-2 text-xs text-slate-500 leading-5'>{addressData.fullAddress}</p>
                          ) : null}
                          <button
                            type='button'
                            onClick={() => toggleAddress(order._id)}
                            className='mt-2 text-xs uppercase tracking-[0.18em] text-slate-600'
                          >
                            {isAddressExpanded ? 'Hide address' : 'View full address'}
                          </button>
                        </>
                      ) : null}
                    </div>

                    <div className='rounded-2xl bg-[#f7f7f7] p-3'>
                      <p className='text-[10px] uppercase tracking-[0.2em] text-slate-500'>Price summary</p>
                      <div className='mt-2 space-y-1.5 text-sm text-slate-600'>
                        <div className='flex items-center justify-between'>
                          <span>Subtotal</span>
                          <span>{formatMoney(currency, subtotal)}</span>
                        </div>
                        <div className='flex items-center justify-between'>
                          <span>Delivery fee</span>
                          <span>{formatMoney(currency, deliveryFee)}</span>
                        </div>
                        <div className='flex items-center justify-between'>
                          <span>Discount</span>
                          <span>-{formatMoney(currency, discount)}</span>
                        </div>
                        <div className='mt-2 border-t border-slate-200 pt-2 flex items-center justify-between font-semibold text-slate-900'>
                          <span>Total amount</span>
                          <span>{formatMoney(currency, amount)}</span>
                        </div>
                      </div>
                    </div>

                    {fitFeedbackItems.length > 0 ? (
                      <div className='rounded-2xl bg-[#f7f7f7] p-3'>
                        <div className='flex items-start justify-between gap-3'>
                          <div>
                            <p className='text-[10px] uppercase tracking-[0.2em] text-slate-500'>Fit feedback</p>
                            <p className='mt-1 text-sm text-slate-600'>
                              Tell us whether the assistant landed on the right size for delivered items.
                            </p>
                          </div>
                        </div>

                        <div className='mt-3 space-y-3'>
                          {fitFeedbackItems.map((item) => {
                            const feedbackKey = buildFitFeedbackKey(order._id, item._id);
                            const feedbackEntry = fitFeedbackMap[feedbackKey];
                            const isSubmittingFeedback = submittingFitFeedbackKey === feedbackKey;
                            const selectedSizeDiffers =
                              String(item.fitAssistant?.recommendedSize || '').trim() !== String(item.size || '').trim();

                            return (
                              <div key={feedbackKey} className='rounded-2xl border border-slate-200 bg-white p-3'>
                                <div className='flex items-start justify-between gap-3'>
                                  <div>
                                    <p className='text-sm font-medium text-slate-900'>{item.name}</p>
                                    <p className='mt-1 text-xs uppercase tracking-[0.16em] text-slate-500'>
                                      Bought {item.size} | Recommended {item.fitAssistant.recommendedSize}
                                    </p>
                                  </div>

                                  {item.fitAssistant?.confidence !== null && item.fitAssistant?.confidence !== undefined ? (
                                    <span className='rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-600'>
                                      {formatFitConfidence(item.fitAssistant.confidence)} confidence
                                    </span>
                                  ) : null}
                                </div>

                                {selectedSizeDiffers ? (
                                  <p className='mt-2 text-sm text-slate-500'>
                                    You bought a different size than the assistant&apos;s first suggestion, so this helps us
                                    learn about overrides too.
                                  </p>
                                ) : null}

                                {feedbackEntry ? (
                                  <div className='mt-3 rounded-2xl bg-emerald-50 px-3 py-3 text-sm text-emerald-800'>
                                    Recorded: {FIT_FEEDBACK_LABELS[feedbackEntry.feedback] || 'Fit feedback submitted'}
                                  </div>
                                ) : (
                                  <div className='mt-3 flex flex-wrap gap-2'>
                                    {FIT_FEEDBACK_OPTIONS.map((option) => (
                                      <button
                                        key={option.value}
                                        type='button'
                                        disabled={isSubmittingFeedback}
                                        onClick={() =>
                                          handleSubmitFitFeedback({
                                            orderId: order._id,
                                            item,
                                            feedback: option.value,
                                          })
                                        }
                                        className='rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60'
                                      >
                                        {isSubmittingFeedback ? 'Saving...' : option.label}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default Orders;
