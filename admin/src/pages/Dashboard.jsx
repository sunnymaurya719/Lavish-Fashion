import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';
import { createAdminOrderRealtimeClient } from '../services/realtimeClient';
import { usePermission } from '../hooks/usePermission';
import {
  PageHeader,
  MetricGrid,
  MetricCard,
  StatusBadge,
  SkeletonCard,
  SkeletonTable,
  ErrorState,
  formatMoney,
  formatNumber,
  formatDate,
} from '../components/ui';

const realtimeEnabled = String(import.meta.env.VITE_REALTIME_ENABLED || 'true').trim().toLowerCase() !== 'false';
const DASHBOARD_REFRESH_DEBOUNCE_MS = 1200;
const DASHBOARD_FALLBACK_REFRESH_MS = 60000;

const formatCompact = (value) =>
  new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0));

const formatSyncTime = (value) => {
  if (!value) return 'Not yet';
  return new Date(value).toLocaleString('en-IN', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatSettingsAuditTime = (value) => {
  if (!value) return 'Not updated yet';
  return new Date(value).toLocaleString('en-IN', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
};

/* ── live-dot indicator ─────────────────────────────────── */

const LiveIndicator = ({ status, message, lastSync, isRefreshing }) => {
  const dotColor =
    status === 'connected' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-500' : 'bg-slate-400';
  const label =
    status === 'connected'
      ? 'Live'
      : status === 'connecting'
        ? 'Syncing'
        : status === 'disabled'
          ? 'Polling'
          : 'Reconnecting';

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500" title={message || ''}>
      <span className={`h-2 w-2 rounded-full ${dotColor} ${status === 'connected' ? 'animate-pulse' : ''}`} />
      {label}
      {isRefreshing ? (
        <span className="text-slate-400"> · refreshing</span>
      ) : lastSync ? (
        <span className="text-slate-400"> · {formatSyncTime(lastSync)}</span>
      ) : null}
    </span>
  );
};

/* ── main component ────────────────────────────────────── */

const Dashboard = ({ token, serverStatus, serverBootstrap, onRefreshServerStatus }) => {
  const [metrics, setMetrics] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [paymentSettings, setPaymentSettings] = useState(null);
  const [isLoadingPaymentSettings, setIsLoadingPaymentSettings] = useState(false);
  const [isUpdatingPaymentSettings, setIsUpdatingPaymentSettings] = useState(false);
  const [lastMetricsSyncAt, setLastMetricsSyncAt] = useState('');
  const [liveUpdatesStatus, setLiveUpdatesStatus] = useState({ status: 'idle', message: '' });
  const hasMetricsRef = useRef(false);
  const scheduledRefreshTimerRef = useRef(null);
  const processedEventIdsRef = useRef(new Set());
  const canViewPaymentSettings = usePermission(['settings.view', 'settings.update'], 'any');
  const canUpdatePaymentSettings = usePermission('settings.update');

  /* ── data fetching ──────────────────────────────────── */

  const fetchDashboard = useCallback(async ({ silent = false, showToastOnError = true } = {}) => {
    const backgroundRefresh = silent || hasMetricsRef.current;

    if (backgroundRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const response = await axios.get(BACKEND_URL + '/api/admin/dashboard', {
        headers: { token },
      });

      if (!response.data.success) {
        if (showToastOnError) toast.error(response.data.message || 'Failed to fetch dashboard metrics');
        return;
      }

      setMetrics(response.data.metrics);
      hasMetricsRef.current = true;
      setLastMetricsSyncAt(new Date().toISOString());
    } catch (error) {
      if (showToastOnError) toast.error(error?.response?.data?.message || error.message);
    } finally {
      if (backgroundRefresh) setIsRefreshing(false);
      else setIsLoading(false);
    }
  }, [token]);

  const scheduleDashboardRefresh = useCallback(({ delayMs = DASHBOARD_REFRESH_DEBOUNCE_MS } = {}) => {
    if (scheduledRefreshTimerRef.current) clearTimeout(scheduledRefreshTimerRef.current);
    scheduledRefreshTimerRef.current = setTimeout(() => {
      scheduledRefreshTimerRef.current = null;
      void fetchDashboard({ silent: true, showToastOnError: false });
    }, delayMs);
  }, [fetchDashboard]);

  const fetchPaymentSettings = useCallback(async ({ silent = false, showToastOnError = true } = {}) => {
    if (!token || !canViewPaymentSettings) {
      setPaymentSettings(null);
      return null;
    }

    if (!silent) {
      setIsLoadingPaymentSettings(true);
    }

    try {
      const response = await axios.get(BACKEND_URL + '/api/system/payments', {
        headers: { token }
      });

      if (!response.data.success) {
        if (showToastOnError) toast.error(response.data.message || 'Failed to fetch payment settings');
        return null;
      }

      setPaymentSettings(response.data.settings || null);
      return response.data.settings || null;
    } catch (error) {
      if (showToastOnError) toast.error(error?.response?.data?.message || error.message || 'Failed to fetch payment settings');
      return null;
    } finally {
      if (!silent) {
        setIsLoadingPaymentSettings(false);
      }
    }
  }, [canViewPaymentSettings, token]);

  const handleManualRefresh = useCallback(async () => {
    await Promise.all([
      Promise.resolve(onRefreshServerStatus?.()),
      fetchDashboard({ silent: false, showToastOnError: true }),
      canViewPaymentSettings ? fetchPaymentSettings({ silent: false, showToastOnError: true }) : Promise.resolve(null),
    ]);
  }, [canViewPaymentSettings, fetchDashboard, fetchPaymentSettings, onRefreshServerStatus]);

  const handleToggleCod = useCallback(async () => {
    if (!canUpdatePaymentSettings || isUpdatingPaymentSettings) {
      return;
    }

    const currentCodEnabled = paymentSettings?.codEnabled ?? serverBootstrap?.payments?.codEnabled !== false;
    const nextCodEnabled = !Boolean(currentCodEnabled);

    setIsUpdatingPaymentSettings(true);

    try {
      const response = await axios.patch(
        BACKEND_URL + '/api/system/payments',
        { codEnabled: nextCodEnabled },
        { headers: { token } }
      );

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to update payment settings');
        return;
      }

      setPaymentSettings(response.data.settings || null);
      await Promise.resolve(onRefreshServerStatus?.());
      toast.success(
        nextCodEnabled
          ? 'Cash on Delivery is now available in checkout'
          : 'Cash on Delivery has been disabled for checkout'
      );
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message || 'Failed to update payment settings');
    } finally {
      setIsUpdatingPaymentSettings(false);
    }
  }, [
    canUpdatePaymentSettings,
    isUpdatingPaymentSettings,
    onRefreshServerStatus,
    paymentSettings?.codEnabled,
    serverBootstrap?.payments?.codEnabled,
    token
  ]);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    if (!canViewPaymentSettings) {
      setPaymentSettings(null);
      return;
    }

    void fetchPaymentSettings({ silent: true, showToastOnError: false });
  }, [canViewPaymentSettings, fetchPaymentSettings]);

  /* realtime */
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
          if (processedEventIdsRef.current.has(eventId)) return;
          processedEventIdsRef.current.add(eventId);
          if (processedEventIdsRef.current.size > 500) {
            const oldest = processedEventIdsRef.current.values().next().value;
            if (oldest) processedEventIdsRef.current.delete(oldest);
          }
        }
        if (!eventPayload?.order?._id) return;
        scheduleDashboardRefresh();
      },
    });

    return () => {
      disconnect?.();
      processedEventIdsRef.current.clear();
    };
  }, [scheduleDashboardRefresh, token]);

  /* fallback poll */
  useEffect(() => {
    if (!token) return undefined;
    const intervalId = setInterval(() => {
      void fetchDashboard({ silent: true, showToastOnError: false });
    }, DASHBOARD_FALLBACK_REFRESH_MS);
    return () => clearInterval(intervalId);
  }, [fetchDashboard, token]);

  /* cleanup */
  useEffect(() => () => {
    if (scheduledRefreshTimerRef.current) {
      clearTimeout(scheduledRefreshTimerRef.current);
      scheduledRefreshTimerRef.current = null;
    }
  }, []);

  /* ── derived data ───────────────────────────────────── */

  const actionCenterItems = useMemo(() => {
    if (!metrics) return [];
    return [
      {
        label: 'Awaiting fulfillment',
        value: (metrics.statusBreakdown || [])
          .filter((s) => ['Order Placed', 'Packing'].includes(s.status))
          .reduce((sum, s) => sum + s.count, 0),
        to: '/orders?status=Order Placed,Packing',
        tone: 'info',
      },
      {
        label: 'Pending reviews',
        value: (metrics.statusBreakdown || []).find((s) => s.status === 'pending')?.count || metrics.totals?.pendingReviews || 0,
        to: '/reviews?status=pending',
        tone: 'warning',
      },
      {
        label: 'Low-stock SKUs',
        value: metrics.totals?.lowStockProducts || metrics.inventoryHealth?.lowStock || 0,
        to: '/inventory?filter=low_stock',
        tone: 'danger',
      },
      {
        label: 'Failed dispatches',
        value: metrics.totals?.failedDispatches || 0,
        to: '/marketing?status=failed',
        tone: 'muted',
      },
    ];
  }, [metrics]);

  const revenueMax = metrics ? Math.max(...metrics.revenueSeries.map((i) => i.revenue), 1) : 1;
  const statusMax = metrics ? Math.max(...metrics.statusBreakdown.map((i) => i.count), 1) : 1;
  const codEnabled = paymentSettings?.codEnabled ?? serverBootstrap?.payments?.codEnabled !== false;
  const paymentSettingsSourceLabel =
    paymentSettings?.source === 'database' ? 'Runtime override' : 'Env default';

  const catalogHighlights = useMemo(() => {
    if (!metrics) return [];
    const find = (status) => metrics.catalogStatusBreakdown?.find((i) => i.status === status)?.count || 0;
    return [
      { label: 'Active', value: find('active'), tone: 'bg-emerald-50 text-emerald-900' },
      { label: 'Draft', value: find('draft'), tone: 'bg-amber-50 text-amber-900' },
      { label: 'Archived', value: find('archived'), tone: 'bg-slate-100 text-slate-800' },
      { label: 'Featured', value: (metrics.totals.featuredProducts || 0), tone: 'bg-sky-50 text-sky-900' },
    ];
  }, [metrics]);

  /* ── loading state ──────────────────────────────────── */

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-10 w-64 rounded-xl bg-slate-100 animate-pulse" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <SkeletonTable rows={5} columns={4} />
      </div>
    );
  }

  if (!metrics) {
    return (
      <ErrorState
        title="Dashboard unavailable"
        message="Could not load dashboard metrics."
        onRetry={fetchDashboard}
      />
    );
  }

  /* ── render ─────────────────────────────────────────── */

  return (
    <div className="flex flex-col gap-6">
      {/* header + action center */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-slate-900">Operations overview</h1>
              <LiveIndicator
                status={liveUpdatesStatus.status}
                message={liveUpdatesStatus.message}
                lastSync={lastMetricsSyncAt}
                isRefreshing={isRefreshing}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusBadge tone={serverStatus === 'healthy' ? 'success' : 'warning'} size="sm" withDot={false}>
                API {serverStatus}
              </StatusBadge>
              <StatusBadge tone="neutral" size="sm" withDot={false}>
                Razorpay {serverBootstrap?.payments?.razorpayEnabled ? 'on' : 'off'}
              </StatusBadge>
              <StatusBadge tone={codEnabled ? 'success' : 'warning'} size="sm" withDot={false}>
                COD {codEnabled ? 'on' : 'off'}
              </StatusBadge>
              <StatusBadge tone="neutral" size="sm" withDot={false}>
                Media {serverBootstrap?.features?.reviewMediaEnabled ? 'on' : 'off'}
              </StatusBadge>
            </div>
          </div>

          {/* action center */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {actionCenterItems.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className="flex flex-col items-center rounded-xl border border-slate-200 px-4 py-3 text-center transition hover:bg-slate-50"
              >
                <span className="text-2xl font-semibold tabular-nums text-slate-900">{item.value}</span>
                <span className="mt-1 text-xs text-slate-500">{item.label}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh live data'}
          </button>
          <Link to="/products/new" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Add product
          </Link>
          <Link to="/inventory" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Review inventory
          </Link>
        </div>
      </div>

      {/* summary cards — each links to its drill-down page */}
      {canViewPaymentSettings ? (
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-base font-semibold text-slate-900">Checkout payment controls</p>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
                    codEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  COD {codEnabled ? 'enabled' : 'disabled'}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Turning COD off hides it from checkout and blocks new COD orders at the API. Existing COD orders stay unchanged.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-slate-100 px-3 py-1">Source: {paymentSettingsSourceLabel}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  Updated: {formatSettingsAuditTime(paymentSettings?.updatedAt)}
                </span>
                {paymentSettings?.updatedBy?.email ? (
                  <span className="rounded-full bg-slate-100 px-3 py-1">By: {paymentSettings.updatedBy.email}</span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleToggleCod}
                disabled={!canUpdatePaymentSettings || isUpdatingPaymentSettings}
                className={`rounded-xl px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 ${
                  codEnabled ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-700 hover:bg-emerald-600'
                }`}
              >
                {isUpdatingPaymentSettings
                  ? 'Saving...'
                  : codEnabled
                    ? 'Disable COD'
                    : 'Enable COD'}
              </button>
              <button
                type="button"
                onClick={() => fetchPaymentSettings({ silent: false, showToastOnError: true })}
                disabled={isLoadingPaymentSettings || isUpdatingPaymentSettings}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {isLoadingPaymentSettings ? 'Refreshing...' : 'Refresh payment settings'}
              </button>
            </div>
          </div>
        </article>
      ) : null}

      <MetricGrid>
        <Link to="/orders" className="contents">
          <MetricCard
            label="Realized revenue"
            value={formatMoney(metrics.totals.revenue)}
            helper={`${metrics.totals.paidOrders} paid orders`}
          />
        </Link>
        <Link to="/orders" className="contents">
          <MetricCard
            label="Total orders"
            value={formatCompact(metrics.totals.orders)}
            helper={`${metrics.totals.pendingOrders} still in motion`}
          />
        </Link>
        <Link to="/customers" className="contents">
          <MetricCard
            label="Customers"
            value={formatCompact(metrics.totals.customers)}
            helper={`${metrics.totals.newCustomersLast30Days} joined in 30 days`}
          />
        </Link>
        <Link to="/inventory" className="contents">
          <MetricCard
            label="Inventory units"
            value={formatCompact(metrics.totals.inventoryUnits)}
            helper={`${metrics.totals.lowStockProducts} products need attention`}
          />
        </Link>
      </MetricGrid>

      {/* charts row */}
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        {/* revenue trend */}
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-base font-semibold text-slate-900">Revenue trend</p>
              <p className="text-sm text-slate-500">Last 7 days of realized revenue.</p>
            </div>
            <p className="text-sm text-slate-500">
              AOV: {formatMoney(metrics.totals.averageOrderValue)}
            </p>
          </div>
          <div className="grid h-56 grid-cols-7 items-end gap-3">
            {metrics.revenueSeries.map((item) => (
              <div key={item.key} className="flex flex-col items-center gap-2">
                <div className="relative w-full flex-1 overflow-hidden rounded-xl bg-slate-100">
                  <div
                    className="absolute inset-x-0 bottom-0 rounded-xl bg-gradient-to-t from-slate-800 to-slate-500"
                    style={{ height: `${Math.max((item.revenue / revenueMax) * 100, item.revenue > 0 ? 12 : 4)}%` }}
                  />
                </div>
                <div className="text-center">
                  <p className="text-xs font-medium text-slate-700">{item.label}</p>
                  <p className="text-[11px] text-slate-500">{formatCompact(item.revenue)}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        {/* fulfillment pulse */}
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6">
            <p className="text-base font-semibold text-slate-900">Fulfillment pulse</p>
            <p className="text-sm text-slate-500">Order pipeline distribution.</p>
          </div>
          <div className="space-y-4">
            {metrics.statusBreakdown.map((item) => (
              <div key={item.status}>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="text-slate-600">{item.status}</span>
                  <span className="font-medium text-slate-900 tabular-nums">{item.count}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-slate-700"
                    style={{ width: `${(item.count / statusMax) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-emerald-50 px-3 py-2.5 text-center">
              <p className="text-xs text-emerald-700">Healthy</p>
              <p className="mt-1 text-xl font-semibold text-emerald-900 tabular-nums">{metrics.inventoryHealth.healthy}</p>
            </div>
            <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-center">
              <p className="text-xs text-amber-700">Low</p>
              <p className="mt-1 text-xl font-semibold text-amber-900 tabular-nums">{metrics.inventoryHealth.lowStock}</p>
            </div>
            <div className="rounded-xl bg-rose-50 px-3 py-2.5 text-center">
              <p className="text-xs text-rose-700">Out</p>
              <p className="mt-1 text-xl font-semibold text-rose-900 tabular-nums">{metrics.inventoryHealth.outOfStock}</p>
            </div>
          </div>
        </article>
      </div>

      {/* low stock + top products */}
      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-base font-semibold text-slate-900">Low-stock alerts</p>
              <p className="text-sm text-slate-500">Products closest to stock risk right now.</p>
            </div>
            <Link to="/inventory" className="text-sm font-medium text-slate-700 hover:underline">
              Open inventory
            </Link>
          </div>
          <div className="space-y-3">
            {metrics.lowStockProducts.length === 0 ? (
              <div className="rounded-xl bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
                No low-stock alerts. Inventory health is stable.
              </div>
            ) : (
              metrics.lowStockProducts.map((product) => (
                <div
                  key={product.id}
                  className="grid items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 md:grid-cols-[2fr_1fr_1fr_auto]"
                >
                  <div>
                    <p className="font-medium text-slate-900">{product.name}</p>
                    <p className="text-sm text-slate-500">
                      {product.category}
                      {product.sku ? ` / ${product.sku}` : ''}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Stock</p>
                    <p className="text-lg font-semibold text-slate-900 tabular-nums">{product.stock}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Threshold</p>
                    <p className="text-lg font-semibold text-slate-900 tabular-nums">{product.lowStockThreshold}</p>
                  </div>
                  <StatusBadge status={product.status} size="sm" />
                </div>
              ))
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <p className="text-base font-semibold text-slate-900">Top products</p>
            <p className="text-sm text-slate-500">Most ordered items across all tracked orders.</p>
          </div>
          {metrics.topProducts.length === 0 ? (
            <div className="rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Product performance will appear as orders start coming in.
            </div>
          ) : (
            <div className="space-y-3">
              {metrics.topProducts.map((product, index) => (
                <div key={product.productId} className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-700">
                      {index + 1}
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">{product.name}</p>
                      <p className="text-xs text-slate-500">{product.quantitySold} units</p>
                    </div>
                  </div>
                  <p className="text-sm font-medium text-slate-900 tabular-nums">
                    {formatMoney(product.revenue)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      {/* recent orders + payment mix */}
      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <p className="text-base font-semibold text-slate-900">Recent orders</p>
            <p className="text-sm text-slate-500">Latest order activity from the server.</p>
          </div>
          {metrics.recentOrders.length === 0 ? (
            <div className="rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Recent orders will appear once the first purchases land.
            </div>
          ) : (
            <div className="space-y-3">
              {metrics.recentOrders.map((order) => (
                <div
                  key={order.orderId}
                  className="grid items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 lg:grid-cols-[2fr_1fr_1fr_auto]"
                >
                  <div>
                    <p className="font-medium text-slate-900">{order.customerName || 'Customer'}</p>
                    <p className="text-sm text-slate-500">#{order.orderId.slice(-6).toUpperCase()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Amount</p>
                    <p className="font-medium text-slate-900 tabular-nums">
                      {formatMoney(order.amount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Payment</p>
                    <p className="font-medium text-slate-900">{order.paymentMethod}</p>
                  </div>
                  <StatusBadge status={order.status} size="sm" />
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <p className="text-base font-semibold text-slate-900">Payment mix</p>
            <p className="text-sm text-slate-500">Current split across COD and online methods.</p>
          </div>
          <div className="space-y-4">
            {metrics.paymentMethodBreakdown.map((item) => {
              const totalCount = metrics.totals.orders || 1;
              const pct = ((item.count / totalCount) * 100).toFixed(1);
              return (
                <div key={item.method}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="text-slate-600">{item.method}</span>
                    <span className="font-medium text-slate-900 tabular-nums">{item.count} ({pct}%)</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-slate-700"
                      style={{ width: `${(item.count / totalCount) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </div>

      {/* catalog health + customer radar */}
      <div className="grid gap-6 xl:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <p className="text-base font-semibold text-slate-900">Catalog health</p>
            <p className="text-sm text-slate-500">Publishing mix across active, draft, and archived inventory.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {catalogHighlights.map((item) => (
              <div key={item.label} className={`rounded-xl px-4 py-3 ${item.tone}`}>
                <p className="text-xs uppercase tracking-wide">{item.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 space-y-3">
            {(metrics.catalogStatusBreakdown || []).map((item) => {
              const totalProducts = metrics.totals.products || 1;
              const pct = ((item.count / totalProducts) * 100).toFixed(1);
              return (
                <div key={item.status}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="capitalize text-slate-600">{item.status}</span>
                    <span className="font-medium text-slate-900 tabular-nums">{item.count} ({pct}%)</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-slate-700"
                      style={{ width: `${(item.count / totalProducts) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <p className="text-base font-semibold text-slate-900">Customer radar</p>
            <p className="text-sm text-slate-500">Newest customers and their order activity.</p>
          </div>

          {metrics.recentCustomers.length === 0 ? (
            <div className="rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Customer insights will appear once accounts start getting created.
            </div>
          ) : (
            <div className="space-y-3">
              {metrics.recentCustomers.map((customer) => (
                <Link
                  key={customer.id}
                  to={`/customers?id=${customer.id}`}
                  className="grid gap-3 rounded-xl border border-slate-200 px-4 py-3 transition hover:bg-slate-50 md:grid-cols-[1.4fr_0.8fr_0.8fr]"
                >
                  <div>
                    <p className="font-medium text-slate-900">{customer.name}</p>
                    <p className="text-sm text-slate-500">{customer.email}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Joined {formatDate(customer.joinedAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Orders</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">{customer.orderCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Spent</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
                      {formatMoney(customer.totalSpent)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </article>
      </div>
    </div>
  );
};

export default Dashboard;
