import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';

const formatCurrency = (value, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const formatCompact = (value) =>
  new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0));

const formatDate = (value) => {
  if (!value) {
    return 'Recently';
  }

  return new Date(value).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const Dashboard = ({ token, serverStatus, serverBootstrap, onRefreshServerStatus }) => {
  const [metrics, setMetrics] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await axios.get(BACKEND_URL + '/api/admin/dashboard', {
        headers: { token },
      });

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to fetch dashboard metrics');
        return;
      }

      setMetrics(response.data.metrics);
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const summaryCards = useMemo(() => {
    if (!metrics) {
      return [];
    }

    return [
      {
        label: 'Realized revenue',
        value: formatCurrency(metrics.totals.revenue, metrics.currency),
        helper: `${metrics.totals.paidOrders} paid orders`,
      },
      {
        label: 'Total orders',
        value: formatCompact(metrics.totals.orders),
        helper: `${metrics.totals.pendingOrders} still in motion`,
      },
      {
        label: 'Customers',
        value: formatCompact(metrics.totals.customers),
        helper: `${metrics.totals.newCustomersLast30Days} joined in 30 days`,
      },
      {
        label: 'Inventory units',
        value: formatCompact(metrics.totals.inventoryUnits),
        helper: `${metrics.totals.lowStockProducts} products need attention`,
      },
    ];
  }, [metrics]);

  const catalogHighlights = useMemo(() => {
    if (!metrics) {
      return [];
    }

    const findCatalogCount = (status) =>
      metrics.catalogStatusBreakdown?.find((item) => item.status === status)?.count || 0;

    return [
      {
        label: 'Active',
        value: findCatalogCount('active'),
        tone: 'bg-emerald-50 text-emerald-900',
      },
      {
        label: 'Draft',
        value: findCatalogCount('draft'),
        tone: 'bg-amber-50 text-amber-900',
      },
      {
        label: 'Archived',
        value: findCatalogCount('archived'),
        tone: 'bg-slate-100 text-slate-800',
      },
      {
        label: 'Featured',
        value: metrics.totals.featuredProducts || 0,
        tone: 'bg-sky-50 text-sky-900',
      },
    ];
  }, [metrics]);

  const revenueMax = metrics ? Math.max(...metrics.revenueSeries.map((item) => item.revenue), 1) : 1;
  const statusMax = metrics ? Math.max(...metrics.statusBreakdown.map((item) => item.count), 1) : 1;

  if (isLoading) {
    return <div className='ui-loading-state'>Loading dashboard metrics...</div>;
  }

  if (!metrics) {
    return (
      <div className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
        <p className='font-medium text-slate-700'>Dashboard unavailable</p>
        <button
          type='button'
          onClick={fetchDashboard}
          className='mt-4 rounded-xl bg-slate-900 px-4 py-2 text-white'
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-6'>
      <section className='relative overflow-hidden rounded-[32px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-8 text-white shadow-lg'>
        <div className='relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between'>
          <div className='max-w-2xl'>
            <p className='text-xs uppercase tracking-[0.35em] text-slate-300'>Operations overview</p>
            <h1 className='mt-3 text-3xl font-semibold leading-tight'>
              Industry-style admin dashboard, now backed by live server metrics.
            </h1>
            <p className='mt-3 max-w-xl text-sm text-slate-300'>
              Revenue, order flow, customer growth, inventory health, and low-stock risk are all being read
              from the same API layer that powers the rest of the platform.
            </p>
            <div className='mt-4 flex flex-wrap gap-2'>
              <span className='rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-white'>
                API {serverStatus}
              </span>
              <span className='rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-white'>
                Stripe {serverBootstrap?.payments?.stripeEnabled ? 'on' : 'off'}
              </span>
              <span className='rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-white'>
                Razorpay {serverBootstrap?.payments?.razorpayEnabled ? 'on' : 'off'}
              </span>
              <span className='rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-white'>
                Media {serverBootstrap?.features?.reviewMediaEnabled ? 'on' : 'off'}
              </span>
            </div>
          </div>

          <div className='flex flex-wrap gap-3'>
            <button
              type='button'
              onClick={onRefreshServerStatus}
              className='rounded-2xl border border-slate-600 px-4 py-3 text-sm font-medium text-white'
            >
              Refresh connection
            </button>
            <Link to='/products/new' className='rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-900'>
              Add product
            </Link>
            <Link
              to='/inventory'
              className='rounded-2xl border border-slate-600 px-4 py-3 text-sm font-medium text-white'
            >
              Review inventory
            </Link>
          </div>
        </div>
      </section>

      <section className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
        {summaryCards.map((card) => (
          <article key={card.label} className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
            <p className='text-sm text-slate-500'>{card.label}</p>
            <p className='mt-3 text-3xl font-semibold text-slate-900'>{card.value}</p>
            <p className='mt-2 text-sm text-slate-500'>{card.helper}</p>
          </article>
        ))}
      </section>

      <section className='grid gap-6 xl:grid-cols-[1.4fr_1fr]'>
        <article className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='mb-6 flex items-center justify-between'>
            <div>
              <p className='text-lg font-semibold text-slate-900'>Revenue trend</p>
              <p className='text-sm text-slate-500'>Last 7 days of realized revenue and order volume.</p>
            </div>
            <p className='text-sm text-slate-500'>
              Avg order value: {formatCurrency(metrics.totals.averageOrderValue, metrics.currency)}
            </p>
          </div>
          <div className='grid h-64 grid-cols-7 items-end gap-3'>
            {metrics.revenueSeries.map((item) => (
              <div key={item.key} className='flex flex-col items-center gap-3'>
                <div className='relative w-full flex-1 overflow-hidden rounded-2xl bg-slate-100'>
                  <div
                    className='absolute inset-x-0 bottom-0 rounded-2xl bg-gradient-to-t from-slate-900 via-slate-700 to-slate-500'
                    style={{ height: `${Math.max((item.revenue / revenueMax) * 100, item.revenue > 0 ? 12 : 4)}%` }}
                  ></div>
                </div>
                <div className='text-center'>
                  <p className='text-xs font-medium text-slate-700'>{item.label}</p>
                  <p className='text-[11px] text-slate-500'>{formatCompact(item.revenue)}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='mb-6'>
            <p className='text-lg font-semibold text-slate-900'>Fulfillment pulse</p>
            <p className='text-sm text-slate-500'>How current orders are distributed across the pipeline.</p>
          </div>
          <div className='space-y-4'>
            {metrics.statusBreakdown.map((item) => (
              <div key={item.status}>
                <div className='mb-2 flex items-center justify-between text-sm'>
                  <span className='text-slate-600'>{item.status}</span>
                  <span className='font-medium text-slate-900'>{item.count}</span>
                </div>
                <div className='h-3 overflow-hidden rounded-full bg-slate-100'>
                  <div
                    className='h-full rounded-full bg-gradient-to-r from-slate-900 to-slate-500'
                    style={{ width: `${(item.count / statusMax) * 100}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>

          <div className='mt-8 grid grid-cols-3 gap-3'>
            <div className='rounded-2xl bg-emerald-50 px-4 py-3'>
              <p className='text-xs uppercase tracking-[0.2em] text-emerald-700'>Healthy</p>
              <p className='mt-2 text-2xl font-semibold text-emerald-900'>{metrics.inventoryHealth.healthy}</p>
            </div>
            <div className='rounded-2xl bg-amber-50 px-4 py-3'>
              <p className='text-xs uppercase tracking-[0.2em] text-amber-700'>Low</p>
              <p className='mt-2 text-2xl font-semibold text-amber-900'>{metrics.inventoryHealth.lowStock}</p>
            </div>
            <div className='rounded-2xl bg-rose-50 px-4 py-3'>
              <p className='text-xs uppercase tracking-[0.2em] text-rose-700'>Out</p>
              <p className='mt-2 text-2xl font-semibold text-rose-900'>{metrics.inventoryHealth.outOfStock}</p>
            </div>
          </div>
        </article>
      </section>

      <section className='grid gap-6 xl:grid-cols-[1.2fr_1fr]'>
        <article className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='mb-5 flex items-center justify-between'>
            <div>
              <p className='text-lg font-semibold text-slate-900'>Low-stock alerts</p>
              <p className='text-sm text-slate-500'>Products closest to stock risk right now.</p>
            </div>
            <Link to='/inventory' className='text-sm font-medium text-slate-900'>
              Open inventory
            </Link>
          </div>
          <div className='space-y-3'>
            {metrics.lowStockProducts.length === 0 ? (
              <div className='rounded-2xl bg-emerald-50 px-4 py-5 text-sm text-emerald-900'>
                No low-stock alerts right now. Inventory health is stable.
              </div>
            ) : (
              metrics.lowStockProducts.map((product) => (
                <div
                  key={product.id}
                  className='grid gap-3 rounded-2xl border border-slate-200 px-4 py-4 md:grid-cols-[2fr_1fr_1fr_auto]'
                >
                  <div>
                    <p className='font-medium text-slate-900'>{product.name}</p>
                    <p className='text-sm text-slate-500'>
                      {product.category}
                      {product.sku ? ` / ${product.sku}` : ''}
                    </p>
                  </div>
                  <div>
                    <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Stock</p>
                    <p className='text-lg font-semibold text-slate-900'>{product.stock}</p>
                  </div>
                  <div>
                    <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Threshold</p>
                    <p className='text-lg font-semibold text-slate-900'>{product.lowStockThreshold}</p>
                  </div>
                  <div className='self-center'>
                    <span className='rounded-full bg-amber-100 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-amber-800'>
                      {product.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>

        <article className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='mb-5'>
            <p className='text-lg font-semibold text-slate-900'>Top products</p>
            <p className='text-sm text-slate-500'>Most ordered items across all tracked orders.</p>
          </div>
          {metrics.topProducts.length === 0 ? (
            <div className='rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500'>
              Product performance will appear here as orders start coming in.
            </div>
          ) : (
            <div className='space-y-4'>
              {metrics.topProducts.map((product, index) => (
                <div key={product.productId} className='flex items-center justify-between gap-4'>
                  <div className='flex items-center gap-4'>
                    <div className='flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-900'>
                      {index + 1}
                    </div>
                    <div>
                      <p className='font-medium text-slate-900'>{product.name}</p>
                      <p className='text-sm text-slate-500'>{product.quantitySold} units ordered</p>
                    </div>
                  </div>
                  <p className='text-sm font-medium text-slate-900'>
                    {formatCurrency(product.revenue, metrics.currency)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className='grid gap-6 xl:grid-cols-[1.15fr_1fr]'>
        <article className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='mb-5'>
            <p className='text-lg font-semibold text-slate-900'>Recent orders</p>
            <p className='text-sm text-slate-500'>Latest order activity coming directly from the server.</p>
          </div>
          {metrics.recentOrders.length === 0 ? (
            <div className='rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500'>
              Recent orders will appear once the first purchases land.
            </div>
          ) : (
            <div className='space-y-3'>
              {metrics.recentOrders.map((order) => (
                <div
                  key={order.orderId}
                  className='grid gap-3 rounded-2xl border border-slate-200 px-4 py-4 lg:grid-cols-[2fr_1fr_1fr_auto]'
                >
                  <div>
                    <p className='font-medium text-slate-900'>{order.customerName || 'Customer'}</p>
                    <p className='text-sm text-slate-500'>#{order.orderId.slice(-6).toUpperCase()}</p>
                  </div>
                  <div>
                    <p className='text-sm text-slate-500'>Amount</p>
                    <p className='font-medium text-slate-900'>
                      {formatCurrency(order.amount, metrics.currency)}
                    </p>
                  </div>
                  <div>
                    <p className='text-sm text-slate-500'>Payment</p>
                    <p className='font-medium text-slate-900'>{order.paymentMethod}</p>
                  </div>
                  <div className='self-center'>
                    <span className='rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-slate-700'>
                      {order.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='mb-5'>
            <p className='text-lg font-semibold text-slate-900'>Payment mix</p>
            <p className='text-sm text-slate-500'>Current split across COD and online payment methods.</p>
          </div>
          <div className='space-y-4'>
            {metrics.paymentMethodBreakdown.map((item) => {
              const totalCount = metrics.totals.orders || 1;
              const width = `${(item.count / totalCount) * 100}%`;

              return (
                <div key={item.method}>
                  <div className='mb-2 flex items-center justify-between text-sm'>
                    <span className='text-slate-600'>{item.method}</span>
                    <span className='font-medium text-slate-900'>{item.count}</span>
                  </div>
                  <div className='h-3 overflow-hidden rounded-full bg-slate-100'>
                    <div className='h-full rounded-full bg-slate-900' style={{ width }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </section>

      <section className='grid gap-6 xl:grid-cols-[1fr_1fr]'>
        <article className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='mb-6'>
            <p className='text-lg font-semibold text-slate-900'>Catalog health</p>
            <p className='text-sm text-slate-500'>Publishing mix across active, draft, and archived inventory.</p>
          </div>

          <div className='grid grid-cols-2 gap-3'>
            {catalogHighlights.map((item) => (
              <div key={item.label} className={`rounded-2xl px-4 py-4 ${item.tone}`}>
                <p className='text-xs uppercase tracking-[0.2em]'>{item.label}</p>
                <p className='mt-2 text-2xl font-semibold'>{item.value}</p>
              </div>
            ))}
          </div>

          <div className='mt-8 space-y-4'>
            {(metrics.catalogStatusBreakdown || []).map((item) => {
              const totalProducts = metrics.totals.products || 1;
              const width = `${(item.count / totalProducts) * 100}%`;

              return (
                <div key={item.status}>
                  <div className='mb-2 flex items-center justify-between text-sm'>
                    <span className='capitalize text-slate-600'>{item.status}</span>
                    <span className='font-medium text-slate-900'>{item.count}</span>
                  </div>
                  <div className='h-3 overflow-hidden rounded-full bg-slate-100'>
                    <div className='h-full rounded-full bg-slate-900' style={{ width }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='mb-6'>
            <p className='text-lg font-semibold text-slate-900'>Customer radar</p>
            <p className='text-sm text-slate-500'>Newest customers and their order activity so far.</p>
          </div>

          {metrics.recentCustomers.length === 0 ? (
            <div className='rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500'>
              Customer insights will appear once accounts start getting created.
            </div>
          ) : (
            <div className='space-y-3'>
              {metrics.recentCustomers.map((customer) => (
                <div
                  key={customer.id}
                  className='grid gap-3 rounded-2xl border border-slate-200 px-4 py-4 md:grid-cols-[1.4fr_0.8fr_0.8fr]'
                >
                  <div>
                    <p className='font-medium text-slate-900'>{customer.name}</p>
                    <p className='text-sm text-slate-500'>{customer.email}</p>
                    <p className='mt-1 text-xs uppercase tracking-[0.2em] text-slate-400'>
                      Joined {formatDate(customer.joinedAt)}
                    </p>
                  </div>
                  <div>
                    <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Orders</p>
                    <p className='mt-2 text-lg font-semibold text-slate-900'>{customer.orderCount}</p>
                  </div>
                  <div>
                    <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Spent</p>
                    <p className='mt-2 text-lg font-semibold text-slate-900'>
                      {formatCurrency(customer.totalSpent, metrics.currency)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </div>
  );
};

export default Dashboard;
