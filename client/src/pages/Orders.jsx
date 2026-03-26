import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Title from '../components/Title';
import { ShopContext } from '../context/ShopContext';

const STATUS_STYLES = {
  delivered: {
    label: 'Delivered',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dotClass: 'bg-emerald-500',
  },
  shipped: {
    label: 'Shipped',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
    dotClass: 'bg-sky-500',
  },
  'out for delivery': {
    label: 'Out for delivery',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
    dotClass: 'bg-blue-500',
  },
  packing: {
    label: 'Packing',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    dotClass: 'bg-amber-500',
  },
  'order placed': {
    label: 'Order placed',
    badgeClass: 'bg-slate-50 text-slate-700 border-slate-200',
    dotClass: 'bg-slate-500',
  },
  cancelled: {
    label: 'Cancelled',
    badgeClass: 'bg-red-50 text-red-700 border-red-200',
    dotClass: 'bg-red-500',
  },
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
      badgeClass: 'bg-slate-50 text-slate-700 border-slate-200',
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
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    };
  }

  if (paymentState === 'failed') {
    return {
      summary: `${method} failed`,
      badgeClass: 'bg-red-50 text-red-700 border-red-200',
    };
  }

  if (method === 'COD') {
    return {
      summary: 'Cash on delivery',
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    };
  }

  return {
    summary: `${method} pending`,
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
  };
};

const getAddressLines = (address) => {
  if (!address) {
    return [];
  }

  const fullName = [address.firstName, address.lastName].filter(Boolean).join(' ').trim();
  const locality = [address.city, address.state, address.pincode].filter(Boolean).join(', ');
  const lines = [fullName, address.street, locality, address.country, address.phone ? `Phone: ${address.phone}` : ''];

  return lines.map((line) => String(line || '').trim()).filter(Boolean);
};

const calculateItemsValue = (items = []) =>
  items.reduce((total, item) => total + Number(item.price || 0) * Number(item.quantity || 0), 0);

const getOrderCode = (orderId = '') => `LF-${String(orderId).slice(-8).toUpperCase()}`;

const Orders = () => {
  const { BACKEND_URL, token, currency } = useContext(ShopContext);
  const [orderData, setOrderData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState('');

  const fetchOrders = useCallback(async ({ silent = false } = {}) => {
    if (!token) {
      setOrderData([]);
      return;
    }

    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    setFetchError('');

    try {
      const response = await axios.post(BACKEND_URL + '/api/order/userorders', {}, { headers: { token } });

      if (response.data.success) {
        setOrderData(response.data.orders || []);
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
  }, [BACKEND_URL, token]);

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

  return (
    <div className='border-t pt-12 sm:pt-16'>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <Title text1='MY' text2='ORDERS' />
          <p className='text-sm text-gray-500'>Track delivery, payment, and order history in one place.</p>
        </div>
        <button
          type='button'
          onClick={() => fetchOrders({ silent: true })}
          disabled={isRefreshing || isLoading || !token}
          className='w-full sm:w-auto border border-gray-300 px-4 py-2 text-sm font-medium rounded-md transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60'
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh orders'}
        </button>
      </div>

      {token && (
        <div className='mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4'>
          <div className='rounded-xl border border-gray-200 bg-white p-4'>
            <p className='text-xs uppercase tracking-wider text-gray-500'>Total Orders</p>
            <p className='mt-1 text-2xl font-semibold text-gray-900'>{orderStats.totalOrders}</p>
          </div>
          <div className='rounded-xl border border-gray-200 bg-white p-4'>
            <p className='text-xs uppercase tracking-wider text-gray-500'>Active</p>
            <p className='mt-1 text-2xl font-semibold text-gray-900'>{orderStats.activeOrders}</p>
          </div>
          <div className='rounded-xl border border-gray-200 bg-white p-4'>
            <p className='text-xs uppercase tracking-wider text-gray-500'>Delivered</p>
            <p className='mt-1 text-2xl font-semibold text-gray-900'>{orderStats.deliveredOrders}</p>
          </div>
          <div className='rounded-xl border border-gray-200 bg-white p-4'>
            <p className='text-xs uppercase tracking-wider text-gray-500'>Total Spend</p>
            <p className='mt-1 text-2xl font-semibold text-gray-900'>{formatMoney(currency, orderStats.totalSpend)}</p>
          </div>
        </div>
      )}

      {isLoading && (
        <div className='mt-6 rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-500'>
          Loading your orders...
        </div>
      )}

      {!isLoading && fetchError && (
        <div className='mt-6 rounded-xl border border-red-200 bg-red-50 p-4 sm:p-5'>
          <p className='text-sm text-red-700'>{fetchError}</p>
          <button
            type='button'
            onClick={() => fetchOrders()}
            className='mt-3 border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 rounded-md hover:bg-red-100 transition-colors'
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && !fetchError && token && orderData.length === 0 && (
        <div className='mt-6 rounded-2xl border border-gray-200 bg-white p-10 text-center'>
          <p className='text-lg font-medium text-gray-900'>No orders yet</p>
          <p className='mt-2 text-sm text-gray-500'>Your completed orders will appear here once you checkout.</p>
        </div>
      )}

      {!isLoading && !fetchError && !token && (
        <div className='mt-6 rounded-2xl border border-gray-200 bg-white p-10 text-center'>
          <p className='text-lg font-medium text-gray-900'>Sign in to view your orders</p>
          <p className='mt-2 text-sm text-gray-500'>Order history is available after login.</p>
        </div>
      )}

      {!isLoading && !fetchError && orderData.length > 0 && (
        <div className='mt-6 space-y-5'>
          {orderData.map((order) => {
            const statusMeta = getStatusStyle(order.status);
            const paymentMeta = getPaymentMeta(order);
            const subtotal = Number(order.subtotal || calculateItemsValue(order.items));
            const deliveryFee = Number(order.deliveryFee || 0);
            const discount = Number(order.discountAmount || 0);
            const amount = Number(order.amount || 0);
            const addressLines = getAddressLines(order.address);

            return (
              <article key={order._id} className='rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden'>
                <header className='border-b border-gray-200 bg-gray-50 px-4 py-4 sm:px-6'>
                  <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
                    <div>
                      <p className='text-xs uppercase tracking-wider text-gray-500'>Order</p>
                      <p className='text-base sm:text-lg font-semibold text-gray-900'>{getOrderCode(order._id)}</p>
                      <p className='mt-1 text-sm text-gray-500'>Placed on {formatDate(order.date, { includeTime: true })}</p>
                    </div>

                    <div className='flex flex-wrap items-center gap-2 sm:gap-3'>
                      <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs sm:text-sm font-medium ${statusMeta.badgeClass}`}>
                        <span className={`h-2 w-2 rounded-full ${statusMeta.dotClass}`}></span>
                        {statusMeta.label}
                      </span>
                      <span className={`inline-flex rounded-full border px-3 py-1 text-xs sm:text-sm font-medium ${paymentMeta.badgeClass}`}>
                        {paymentMeta.summary}
                      </span>
                    </div>
                  </div>

                  <div className='mt-4 grid grid-cols-2 md:grid-cols-4 gap-3'>
                    <div>
                      <p className='text-xs uppercase tracking-wider text-gray-500'>Items</p>
                      <p className='text-sm font-semibold text-gray-900'>{order.items?.length || 0}</p>
                    </div>
                    <div>
                      <p className='text-xs uppercase tracking-wider text-gray-500'>Payment Method</p>
                      <p className='text-sm font-semibold text-gray-900'>{order.paymentMethod || 'N/A'}</p>
                    </div>
                    <div>
                      <p className='text-xs uppercase tracking-wider text-gray-500'>Payment Verified</p>
                      <p className='text-sm font-semibold text-gray-900'>{formatDate(order.paymentVerifiedAt)}</p>
                    </div>
                    <div>
                      <p className='text-xs uppercase tracking-wider text-gray-500'>Order Total</p>
                      <p className='text-sm font-semibold text-gray-900'>{formatMoney(currency, amount)}</p>
                    </div>
                  </div>
                </header>

                <div className='grid gap-4 lg:grid-cols-[1.6fr_1fr] p-4 sm:p-6'>
                  <div>
                    <p className='text-xs uppercase tracking-wider text-gray-500'>Items in this order</p>
                    <div className='mt-3 rounded-xl border border-gray-200 overflow-hidden'>
                      {(order.items || []).map((item, index) => {
                        const imageSrc = Array.isArray(item.image) && item.image.length > 0 ? item.image[0] : '';

                        return (
                          <div
                            key={`${order._id}-${item._id}-${item.size}-${index}`}
                            className='grid grid-cols-[auto_1fr] gap-3 sm:gap-4 p-3 sm:p-4 border-b border-gray-100 last:border-b-0'
                          >
                            {imageSrc ? (
                              <img
                                className='h-20 w-16 sm:h-24 sm:w-20 rounded-md object-cover border border-gray-200 bg-gray-50'
                                src={imageSrc}
                                alt={item.name}
                              />
                            ) : (
                              <div className='h-20 w-16 sm:h-24 sm:w-20 rounded-md border border-gray-200 bg-gray-100 text-[11px] text-gray-500 flex items-center justify-center text-center px-1'>
                                No image
                              </div>
                            )}
                          <div className='min-w-0'>
                            <p className='text-sm sm:text-base font-medium text-gray-900'>{item.name}</p>
                            <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600'>
                              <span>Qty: {item.quantity}</span>
                              <span>Size: {item.size || 'N/A'}</span>
                              <span>Unit: {formatMoney(currency, item.price)}</span>
                            </div>
                            <p className='mt-2 text-sm font-semibold text-gray-900'>
                              Line total: {formatMoney(currency, Number(item.price || 0) * Number(item.quantity || 0))}
                            </p>
                          </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <aside className='space-y-4'>
                    <div className='rounded-xl border border-gray-200 p-4'>
                      <p className='text-xs uppercase tracking-wider text-gray-500'>Shipping address</p>
                      {addressLines.length > 0 ? (
                        <div className='mt-2 space-y-1'>
                          {addressLines.map((line) => (
                            <p key={line} className='text-sm text-gray-700'>
                              {line}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className='mt-2 text-sm text-gray-500'>Address details are unavailable.</p>
                      )}
                    </div>

                    <div className='rounded-xl border border-gray-200 p-4'>
                      <p className='text-xs uppercase tracking-wider text-gray-500'>Price summary</p>
                      <div className='mt-3 space-y-2 text-sm'>
                        <div className='flex items-center justify-between text-gray-600'>
                          <span>Subtotal</span>
                          <span>{formatMoney(currency, subtotal)}</span>
                        </div>
                        <div className='flex items-center justify-between text-gray-600'>
                          <span>Delivery fee</span>
                          <span>{formatMoney(currency, deliveryFee)}</span>
                        </div>
                        <div className='flex items-center justify-between text-gray-600'>
                          <span>Discount</span>
                          <span>-{formatMoney(currency, discount)}</span>
                        </div>
                        <div className='pt-2 border-t border-gray-200 flex items-center justify-between font-semibold text-gray-900'>
                          <span>Total paid</span>
                          <span>{formatMoney(currency, amount)}</span>
                        </div>
                      </div>
                    </div>
                  </aside>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Orders;
