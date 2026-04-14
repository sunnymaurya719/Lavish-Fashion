import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';
import { createAdminOrderRealtimeClient } from '../services/realtimeClient';
import { mergeOrderSnapshot, upsertOrderById } from '../utils/orderMerge';

const orderStatusOptions = ['Order Placed', 'Packing', 'Shipped', 'Out for delivery', 'Delivered', 'Cancelled'];

const getAvailableStatusOptions = (order) => {
  if (order?.status === 'Cancelled') {
    return ['Cancelled'];
  }

  if (order?.status === 'Delivered') {
    return orderStatusOptions.filter((status) => status !== 'Cancelled');
  }

  return orderStatusOptions;
};

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const formatDate = (value) =>
  new Date(value).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const getItemImageUrl = (item) => {
  if (Array.isArray(item?.image) && item.image.length > 0) {
    return item.image[0];
  }

  if (typeof item?.image === 'string') {
    return item.image;
  }

  return '';
};

const getPaymentLabel = (order) => {
  if (String(order.paymentStatus || '').trim().toLowerCase() === 'cancelled' || order.status === 'Cancelled') {
    return order.payment ? 'Refund pending' : 'Cancelled';
  }

  if (order.payment) {
    return 'Paid';
  }

  if (order.paymentMethod === 'COD') {
    return 'Pending on delivery';
  }

  return 'Pending';
};

const getStatusClasses = (status) => {
  if (status === 'Cancelled') {
    return 'bg-rose-100 text-rose-800';
  }

  if (status === 'Delivered') {
    return 'bg-emerald-100 text-emerald-800';
  }

  if (status === 'Out for delivery' || status === 'Shipped') {
    return 'bg-sky-100 text-sky-800';
  }

  if (status === 'Packing') {
    return 'bg-amber-100 text-amber-800';
  }

  return 'bg-slate-200 text-slate-700';
};

const realtimeEnabled = String(import.meta.env.VITE_REALTIME_ENABLED || 'true').trim().toLowerCase() !== 'false';

const Orders = ({ token }) => {
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [updatingOrderId, setUpdatingOrderId] = useState('');
  const [liveUpdatesStatus, setLiveUpdatesStatus] = useState({ status: 'idle', message: '' });
  const [highlightedOrderId, setHighlightedOrderId] = useState('');
  const processedEventIdsRef = useRef(new Set());
  const highlightTimerRef = useRef(null);

  const fetchAllOrders = useCallback(async ({ silent = false } = {}) => {
    if (!token) {
      return;
    }

    if (!silent) {
      setIsLoading(true);
    }

    try {
      const response = await axios.post(BACKEND_URL + '/api/order/list', {}, { headers: { token } });

      if (response.data.success) {
        setOrders(mergeOrderSnapshot(response.data.orders || []));
        return;
      }

      if (!silent) {
        toast.error(response.data.message || 'Failed to fetch orders');
      }
    } catch (error) {
      if (!silent) {
        toast.error(error?.response?.data?.message || error.message);
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [token]);

  const statusHandler = async (event, orderId) => {
    setUpdatingOrderId(orderId);

    try {
      const response = await axios.post(
        BACKEND_URL + '/api/order/status',
        { orderId, status: event.target.value },
        { headers: { token } }
      );

      if (response.data.success) {
        toast.success('Order status updated');
        await fetchAllOrders({ silent: true });
        return;
      }

      toast.error(response.data.message || 'Failed to update order status');
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setUpdatingOrderId('');
    }
  };

  useEffect(() => {
    fetchAllOrders();
  }, [fetchAllOrders]);

  useEffect(() => {
    if (!token || !realtimeEnabled) {
      setLiveUpdatesStatus({ status: 'disabled', message: 'Live updates disabled' });
      return undefined;
    }

    const disconnect = createAdminOrderRealtimeClient({
      token,
      onConnectionStatusChange: ({ status, message }) => {
        setLiveUpdatesStatus({ status, message });
      },
      onOrderUpsert: (eventPayload, message) => {
        const eventId = String(eventPayload?.eventId || message?.id || '');

        if (eventId) {
          if (processedEventIdsRef.current.has(eventId)) {
            return;
          }

          processedEventIdsRef.current.add(eventId);

          if (processedEventIdsRef.current.size > 500) {
            const iterator = processedEventIdsRef.current.values();
            const oldest = iterator.next().value;
            if (oldest) {
              processedEventIdsRef.current.delete(oldest);
            }
          }
        }

        const nextOrder = eventPayload?.order;
        if (!nextOrder?._id) {
          return;
        }

        setOrders((currentOrders) => upsertOrderById(currentOrders, nextOrder));

        const incomingOrderId = String(nextOrder._id);
        setHighlightedOrderId(incomingOrderId);

        if (highlightTimerRef.current) {
          clearTimeout(highlightTimerRef.current);
        }

        highlightTimerRef.current = setTimeout(() => {
          setHighlightedOrderId('');
          highlightTimerRef.current = null;
        }, 1500);
      },
    });

    return () => {
      disconnect?.();

      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, [token]);

  useEffect(() => {
    if (!token) {
      return undefined;
    }

    const intervalId = setInterval(() => {
      fetchAllOrders({ silent: true });
    }, 45000);

    return () => clearInterval(intervalId);
  }, [fetchAllOrders, token]);

  const visibleOrders = useMemo(() => {
    return orders.filter((order) => {
      const customerName = `${order.address?.firstName || ''} ${order.address?.lastName || ''}`.trim();
      const haystack = `${customerName} ${order._id} ${order.paymentMethod}`.toLowerCase();
      const matchesSearch = haystack.includes(search.toLowerCase().trim());

      if (!matchesSearch) {
        return false;
      }

      if (statusFilter !== 'all' && order.status !== statusFilter) {
        return false;
      }

      return true;
    });
  }, [orders, search, statusFilter]);

  const summaryCards = useMemo(() => {
    return [
      {
        label: 'Total orders',
        value: orders.length,
        tone: 'text-slate-900',
      },
      {
        label: 'In progress',
        value: orders.filter((order) => !['Delivered', 'Cancelled'].includes(order.status)).length,
        tone: 'text-amber-700',
      },
      {
        label: 'Delivered',
        value: orders.filter((order) => order.status === 'Delivered').length,
        tone: 'text-emerald-700',
      },
      {
        label: 'Awaiting payment',
        value: orders.filter((order) => !order.payment).length,
        tone: 'text-rose-700',
      },
    ];
  }, [orders]);

  return (
    <div className='flex flex-col gap-6'>
      <section className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
        <div className='flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between'>
          <div>
            <p className='text-lg font-semibold text-slate-900'>Order operations</p>
            <p className='text-sm text-slate-500'>
              Review the order pipeline, verify payment posture, and push fulfillment updates back to the server.
            </p>
          </div>

          <button
            type='button'
            onClick={fetchAllOrders}
            className='rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700'
          >
            Refresh orders
          </button>

          <span
            className={`rounded-2xl border px-4 py-3 text-xs font-medium uppercase tracking-[0.2em] ${
              liveUpdatesStatus.status === 'connected'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : liveUpdatesStatus.status === 'connecting'
                  ? 'border-sky-200 bg-sky-50 text-sky-800'
                  : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
            title={liveUpdatesStatus.message || 'Live updates status'}
          >
            {liveUpdatesStatus.status === 'connected'
              ? 'Live on'
              : liveUpdatesStatus.status === 'connecting'
                ? 'Live syncing'
                : liveUpdatesStatus.status === 'disabled'
                  ? 'Live off'
                  : 'Live disconnected'}
          </span>
        </div>
      </section>

      <section className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
        {summaryCards.map((card) => (
          <article key={card.label} className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
            <p className='text-sm text-slate-500'>{card.label}</p>
            <p className={`mt-3 text-3xl font-semibold ${card.tone}`}>{card.value}</p>
          </article>
        ))}
      </section>

      <section className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
        <div className='grid gap-3 lg:grid-cols-[1.6fr_0.8fr]'>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className='rounded-2xl border border-slate-300 px-4 py-3'
            type='text'
            placeholder='Search by customer name, order id, or payment method'
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className='rounded-2xl border border-slate-300 bg-white px-4 py-3'
          >
            <option value='all'>All statuses</option>
            {orderStatusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className='space-y-4'>
        {isLoading ? (
          <div className='ui-loading-state'>Loading orders...</div>
        ) : visibleOrders.length === 0 ? (
          <div className='rounded-[32px] border border-slate-200 bg-white px-6 py-10 text-sm text-slate-500 shadow-sm'>
            No orders matched the current filters.
          </div>
        ) : (
          visibleOrders.map((order) => {
            const customerName = `${order.address?.firstName || ''} ${order.address?.lastName || ''}`.trim();

            return (
              <article
                key={order._id}
                className={`rounded-[32px] border bg-white p-5 shadow-sm transition-all duration-500 ${
                  highlightedOrderId === String(order._id)
                    ? 'border-sky-300 shadow-[0_0_0_3px_rgba(125,211,252,0.35)]'
                    : 'border-slate-200'
                }`}
              >
                <div className='flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between'>
                  <div>
                    <div className='flex flex-wrap items-center gap-2'>
                      <h2 className='text-lg font-semibold text-slate-900'>#{order._id.slice(-8).toUpperCase()}</h2>
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${getStatusClasses(
                          order.status
                        )}`}
                      >
                        {order.status}
                      </span>
                      <span className='rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-700'>
                        {order.paymentMethod}
                      </span>
                    </div>
                    <p className='mt-2 text-sm text-slate-500'>{customerName || 'Customer order'}</p>
                    <p className='mt-1 text-sm text-slate-500'>{formatDate(order.date)}</p>
                  </div>

                  <div className='flex flex-col gap-3 sm:flex-row sm:items-center'>
                    <div className='rounded-2xl bg-slate-50 px-4 py-3'>
                      <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Amount</p>
                      <p className='mt-1 text-lg font-semibold text-slate-900'>{formatCurrency(order.amount)}</p>
                    </div>

                    <select
                      onChange={(event) => statusHandler(event, order._id)}
                      value={order.status}
                      disabled={updatingOrderId === order._id}
                      className='rounded-2xl border border-slate-300 bg-white px-4 py-3 font-medium text-slate-700 disabled:opacity-60'
                    >
                      {getAvailableStatusOptions(order).map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className='mt-5 grid gap-4 xl:grid-cols-[1.2fr_1.1fr_0.9fr]'>
                  <div className='rounded-3xl bg-slate-50 p-4'>
                    <p className='text-sm font-medium text-slate-900'>Ordered items</p>
                    <div className='mt-3 space-y-2 text-sm text-slate-600'>
                      {order.items.map((item, index) => (
                        <div
                          key={`${order._id}-${index}`}
                          className='flex items-center justify-between gap-3 rounded-2xl bg-white px-3 py-3'
                        >
                          <div className='flex min-w-0 items-center gap-3'>
                            {getItemImageUrl(item) ? (
                              <img
                                src={getItemImageUrl(item)}
                                alt={item.name}
                                className='h-14 w-12 rounded-xl border border-slate-200 object-cover'
                              />
                            ) : (
                              <div className='flex h-14 w-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-[11px] uppercase tracking-[0.15em] text-slate-500'>
                                No image
                              </div>
                            )}
                            <div className='min-w-0'>
                              <p className='truncate font-medium text-slate-900'>{item.name}</p>
                              <p className='text-xs text-slate-500'>Size {item.size || '-'}</p>
                            </div>
                          </div>
                          <div className='text-right'>
                            <p className='font-medium text-slate-900'>x{item.quantity}</p>
                            <p className='text-xs text-slate-500'>{formatCurrency(item.price)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className='rounded-3xl bg-slate-50 p-4'>
                    <p className='text-sm font-medium text-slate-900'>Delivery details</p>
                    <div className='mt-3 space-y-2 text-sm leading-6 text-slate-600'>
                      <p className='font-medium text-slate-900'>{customerName}</p>
                      <p>{order.address?.street}</p>
                      <p>
                        {order.address?.city}, {order.address?.state}, {order.address?.country}
                      </p>
                      <p>{order.address?.pincode}</p>
                      <p>{order.address?.phone}</p>
                    </div>
                  </div>

                  <div className='rounded-3xl bg-slate-50 p-4'>
                    <p className='text-sm font-medium text-slate-900'>Payment snapshot</p>
                    <div className='mt-3 space-y-3 text-sm text-slate-600'>
                      <div className='rounded-2xl bg-white px-3 py-3'>
                        <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Payment</p>
                        <p className='mt-1 font-medium text-slate-900'>{getPaymentLabel(order)}</p>
                      </div>
                      <div className='rounded-2xl bg-white px-3 py-3'>
                        <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Method</p>
                        <p className='mt-1 font-medium text-slate-900'>{order.paymentMethod}</p>
                      </div>
                      <div className='rounded-2xl bg-white px-3 py-3'>
                        <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Line items</p>
                        <p className='mt-1 font-medium text-slate-900'>{order.items.length}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
};

export default Orders;
