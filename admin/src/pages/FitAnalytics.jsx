import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';

const formatCompact = (value) =>
  new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0));

const formatPercent = (value) => `${Math.round(Number(value || 0) * 100)}%`;

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

const toneByKey = {
  manual: 'from-slate-900 to-slate-500',
  camera: 'from-sky-700 to-sky-400',
  hybrid: 'from-amber-700 to-amber-400',
  model_backed: 'from-cyan-700 to-cyan-400',
  rule_engine: 'from-stone-700 to-stone-400',
  unknown: 'from-slate-400 to-slate-200',
  high: 'from-emerald-600 to-emerald-400',
  medium: 'from-amber-600 to-amber-400',
  low: 'from-rose-600 to-rose-400',
  perfect: 'from-emerald-600 to-emerald-400',
  too_small: 'from-amber-600 to-amber-400',
  too_large: 'from-rose-600 to-rose-400',
};

const BreakdownCard = ({ title, description, items, totalOverride = null, emptyMessage }) => {
  const total = totalOverride ?? items.reduce((sum, item) => sum + Number(item.count || 0), 0);

  return (
    <article className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
      <div className='mb-5'>
        <p className='text-lg font-semibold text-slate-900'>{title}</p>
        <p className='text-sm text-slate-500'>{description}</p>
      </div>

      {total === 0 ? (
        <div className='rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500'>{emptyMessage}</div>
      ) : (
        <div className='space-y-4'>
          {items.map((item) => {
            const count = Number(item.count || 0);
            const width = total > 0 ? Math.max((count / total) * 100, count > 0 ? 8 : 0) : 0;

            return (
              <div key={item.key}>
                <div className='mb-2 flex items-center justify-between gap-3 text-sm'>
                  <span className='font-medium text-slate-700'>{item.label}</span>
                  <span className='text-slate-500'>
                    {formatCompact(count)} | {formatPercent(total > 0 ? count / total : 0)}
                  </span>
                </div>
                <div className='h-3 overflow-hidden rounded-full bg-slate-100'>
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${toneByKey[item.key] || 'from-slate-800 to-slate-400'}`}
                    style={{ width: `${width}%` }}
                  ></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
};

const FitAnalytics = ({ token, serverStatus, onRefreshServerStatus }) => {
  const [metrics, setMetrics] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchFitAnalytics = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await axios.get(BACKEND_URL + '/api/fit/admin/analytics', {
        headers: { token },
      });

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to fetch fit analytics');
        return;
      }

      setMetrics(response.data.metrics || null);
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchFitAnalytics();
  }, [fetchFitAnalytics]);

  const summaryCards = useMemo(() => {
    if (!metrics) {
      return [];
    }

    return [
      {
        label: 'Ready products',
        value: formatCompact(metrics.summary.readyProducts),
        helper: `${metrics.summary.fitEnabledProducts} fit-enabled across ${metrics.summary.totalCatalogProducts} catalog products`,
      },
      {
        label: 'Assisted order items',
        value: formatCompact(metrics.summary.assistedOrderItems),
        helper: `${metrics.summary.deliveredAssistedItems} delivered with fit metadata`,
      },
      {
        label: 'Feedback coverage',
        value: formatPercent(metrics.summary.feedbackCoverageRate),
        helper: `${metrics.summary.feedbackEntries} feedback entries on ${metrics.summary.feedbackEligibleDeliveredItems} delivered assisted items`,
      },
      {
        label: 'Perfect fit rate',
        value: formatPercent(metrics.summary.perfectFeedbackRate),
        helper: `${formatPercent(metrics.summary.overrideRate)} override rate across assisted order items`,
      },
    ];
  }, [metrics]);

  const rolloutCards = useMemo(() => {
    if (!metrics) {
      return [];
    }

    return [
      {
        label: 'Fit enabled',
        value: metrics.summary.fitEnabledProducts,
        tone: 'bg-slate-100 text-slate-900',
      },
      {
        label: 'Active + ready',
        value: metrics.summary.activeReadyProducts,
        tone: 'bg-emerald-50 text-emerald-900',
      },
      {
        label: 'Needs data',
        value: metrics.summary.incompleteFitProducts,
        tone: 'bg-amber-50 text-amber-900',
      },
      {
        label: 'Rule engine share',
        value: formatPercent(metrics.summary.ruleEngineRate),
        tone: 'bg-rose-50 text-rose-900',
      },
      {
        label: 'Camera-assisted share',
        value: formatPercent(metrics.summary.cameraAssistedRate),
        tone: 'bg-sky-50 text-sky-900',
      },
      {
        label: 'Confidence floor',
        value: formatPercent(metrics.runtime.fitConfidenceMin),
        tone: 'bg-stone-100 text-stone-900',
      },
    ];
  }, [metrics]);

  const trendMax = metrics
    ? Math.max(
        ...metrics.trend.map((entry) => Math.max(Number(entry.assistedItems || 0), Number(entry.feedbackEntries || 0))),
        1
      )
    : 1;

  if (isLoading) {
    return <div className='ui-loading-state'>Loading fit analytics...</div>;
  }

  if (!metrics) {
    return (
      <div className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
        <p className='font-medium text-slate-700'>Fit analytics are unavailable right now.</p>
        <button
          type='button'
          onClick={fetchFitAnalytics}
          className='mt-4 rounded-xl bg-slate-900 px-4 py-2 text-white'
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-6'>
      <section className='relative overflow-hidden rounded-[32px] border border-[#d6c8bc] bg-gradient-to-br from-[#241a16] via-[#433129] to-[#8b7355] p-8 text-white shadow-lg'>
        <div className='relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between'>
          <div className='max-w-3xl'>
            <p className='text-xs uppercase tracking-[0.35em] text-[#e8dccf]'>Fit intelligence</p>
            <h1 className='mt-3 text-3xl font-semibold leading-tight'>
              Rollout health, recommendation confidence, and shopper fit feedback in one place.
            </h1>
            <p className='mt-3 max-w-2xl text-sm text-[#f2e9e1]'>
              This view combines product readiness, assisted order activity, confidence bands, and post-delivery
              feedback so we can tune the fit assistant without guessing.
            </p>
            <div className='mt-4 flex flex-wrap gap-2'>
              <span className='rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-white'>
                API {serverStatus}
              </span>
              <span className='rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-white'>
                Assistant {metrics.runtime.fitAssistantEnabled ? 'on' : 'off'}
              </span>
              <span className='rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-white'>
                Camera {metrics.runtime.fitCameraEnabled ? 'on' : 'off'}
              </span>
              <span className='rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-white'>
                Rollout {metrics.runtime.fitRolloutPercent}%
              </span>
              <span className='rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-white'>
                ML {metrics.runtime.mlServiceConfigured ? 'on' : 'off'}
              </span>
              <span className='rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-white'>
                Redis {metrics.runtime.redisConfigured ? 'on' : 'off'}
              </span>
            </div>
          </div>

          <div className='flex flex-wrap gap-3'>
            <button
              type='button'
              onClick={fetchFitAnalytics}
              className='rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-900'
            >
              Refresh analytics
            </button>
            <button
              type='button'
              onClick={onRefreshServerStatus}
              className='rounded-2xl border border-white/20 px-4 py-3 text-sm font-medium text-white'
            >
              Refresh connection
            </button>
            <Link to='/products' className='rounded-2xl border border-white/20 px-4 py-3 text-sm font-medium text-white'>
              Review catalog
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

      <section className='grid gap-6 xl:grid-cols-[1.35fr_1fr]'>
        <article className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='mb-6 flex items-center justify-between gap-4'>
            <div>
              <p className='text-lg font-semibold text-slate-900'>Adoption trend</p>
              <p className='text-sm text-slate-500'>Last 7 days of assisted order items and fit feedback submissions.</p>
            </div>
            <p className='text-sm text-slate-500'>Updated {formatDate(metrics.generatedAt)}</p>
          </div>

          <div className='grid h-64 grid-cols-7 items-end gap-3'>
            {metrics.trend.map((entry) => (
              <div key={entry.key} className='flex flex-col items-center gap-3'>
                <div className='flex h-full w-full items-end justify-center gap-1 rounded-2xl bg-slate-50 px-2 py-3'>
                  <div
                    className='w-3 rounded-full bg-gradient-to-t from-slate-900 to-slate-500'
                    style={{
                      height: `${Math.max((Number(entry.assistedItems || 0) / trendMax) * 100, entry.assistedItems ? 10 : 4)}%`,
                    }}
                    title={`${entry.assistedItems} assisted`}
                  ></div>
                  <div
                    className='w-3 rounded-full bg-gradient-to-t from-emerald-600 to-emerald-300'
                    style={{
                      height: `${Math.max((Number(entry.feedbackEntries || 0) / trendMax) * 100, entry.feedbackEntries ? 10 : 4)}%`,
                    }}
                    title={`${entry.feedbackEntries} feedback`}
                  ></div>
                </div>
                <div className='text-center'>
                  <p className='text-xs font-medium text-slate-700'>{entry.label}</p>
                  <p className='text-[11px] text-slate-500'>
                    {entry.assistedItems}/{entry.feedbackEntries}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className='mt-5 flex flex-wrap gap-4 text-sm text-slate-500'>
            <span className='inline-flex items-center gap-2'>
              <span className='h-3 w-3 rounded-full bg-slate-800'></span>
              Assisted order items
            </span>
            <span className='inline-flex items-center gap-2'>
              <span className='h-3 w-3 rounded-full bg-emerald-500'></span>
              Feedback entries
            </span>
          </div>
        </article>

        <article className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='mb-6'>
            <p className='text-lg font-semibold text-slate-900'>Rollout pulse</p>
            <p className='text-sm text-slate-500'>Catalog readiness and recommendation operating posture.</p>
          </div>

          <div className='grid grid-cols-2 gap-3'>
            {rolloutCards.map((card) => (
              <div key={card.label} className={`rounded-2xl px-4 py-4 ${card.tone}`}>
                <p className='text-xs uppercase tracking-[0.2em]'>{card.label}</p>
                <p className='mt-2 text-2xl font-semibold'>{card.value}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className='grid gap-6 xl:grid-cols-[1fr_1fr]'>
        <BreakdownCard
          title='Recommendation engine mix'
          description='Stored model version tags on assisted order items.'
          items={metrics.breakdowns.engine}
          emptyMessage='Engine mix will appear after assisted orders start flowing through checkout.'
        />
        <BreakdownCard
          title='Confidence distribution'
          description='Recommendation confidence bands using the active store threshold.'
          items={metrics.breakdowns.confidence}
          emptyMessage='Confidence distribution will appear once assisted recommendations are attached to orders.'
        />
      </section>

      <section className='grid gap-6 xl:grid-cols-[1fr_1fr]'>
        <BreakdownCard
          title='Recommendation source mix'
          description='How shoppers reached a fit recommendation: manual, camera, or hybrid.'
          items={metrics.breakdowns.recommendationSource}
          emptyMessage='Source mix will appear after the first assisted order item is placed.'
        />
        <BreakdownCard
          title='Feedback outcomes'
          description='How delivered shoppers reported the final fit after purchase.'
          items={metrics.breakdowns.feedback}
          emptyMessage='Feedback outcomes will appear once delivered shoppers start submitting fit feedback.'
        />
      </section>

      <section className='grid gap-6 xl:grid-cols-[1.15fr_1fr]'>
        <article className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='mb-5 flex items-center justify-between gap-4'>
            <div>
              <p className='text-lg font-semibold text-slate-900'>Top fit-assisted products</p>
              <p className='text-sm text-slate-500'>Products generating the most assisted order activity right now.</p>
            </div>
            <Link to='/products' className='text-sm font-medium text-slate-900'>
              Open catalog
            </Link>
          </div>

          {metrics.topProducts.length === 0 ? (
            <div className='rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500'>
              Product-level fit activity will appear after the first assisted orders land.
            </div>
          ) : (
            <div className='space-y-3'>
              {metrics.topProducts.map((product, index) => (
                <div
                  key={product.productId}
                  className='grid gap-3 rounded-2xl border border-slate-200 px-4 py-4 lg:grid-cols-[1.8fr_0.7fr_0.7fr_0.7fr_auto]'
                >
                  <div>
                    <div className='flex items-center gap-3'>
                      <div className='flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-900'>
                        {index + 1}
                      </div>
                      <div>
                        <Link to={`/products/${product.productId}/edit`} className='font-medium text-slate-900 hover:underline'>
                          {product.name}
                        </Link>
                        <p className='text-sm text-slate-500'>{product.category}</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Assisted</p>
                    <p className='mt-2 text-lg font-semibold text-slate-900'>{product.assistedItems}</p>
                  </div>
                  <div>
                    <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Feedback</p>
                    <p className='mt-2 text-lg font-semibold text-slate-900'>{product.feedbackEntries}</p>
                  </div>
                  <div>
                    <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Perfect</p>
                    <p className='mt-2 text-lg font-semibold text-slate-900'>{formatPercent(product.perfectFeedbackRate)}</p>
                  </div>
                  <div className='self-center'>
                    <span className='rounded-full bg-amber-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-amber-800'>
                      {formatPercent(product.overrideRate)} override
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='mb-5'>
            <p className='text-lg font-semibold text-slate-900'>Products needing fit data</p>
            <p className='text-sm text-slate-500'>Fit-enabled products that still do not meet rollout readiness.</p>
          </div>

          {metrics.incompleteProducts.length === 0 ? (
            <div className='rounded-2xl bg-emerald-50 px-4 py-5 text-sm text-emerald-900'>
              No fit-enabled products are blocked by incomplete measurement data right now.
            </div>
          ) : (
            <div className='space-y-3'>
              {metrics.incompleteProducts.map((product) => (
                <div key={product.productId} className='rounded-2xl border border-slate-200 px-4 py-4'>
                  <div className='flex items-start justify-between gap-4'>
                    <div>
                      <Link to={`/products/${product.productId}/edit`} className='font-medium text-slate-900 hover:underline'>
                        {product.name}
                      </Link>
                      <p className='text-sm text-slate-500'>
                        {product.category} | {product.measurementTemplate}
                      </p>
                    </div>
                    <span className='rounded-full bg-amber-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-amber-800'>
                      {product.readinessPercent}% ready
                    </span>
                  </div>
                  <div className='mt-3 h-2 overflow-hidden rounded-full bg-slate-100'>
                    <div className='h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-300' style={{ width: `${Math.max(product.readinessPercent, 6)}%` }}></div>
                  </div>
                  <p className='mt-3 text-sm text-slate-500'>
                    Completed sizes: {product.completedSizes}/{product.totalSizes} | Status: {product.status}
                  </p>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
        <div className='mb-5'>
          <p className='text-lg font-semibold text-slate-900'>Recent fit feedback</p>
          <p className='text-sm text-slate-500'>Latest shopper-reported outcomes from delivered assisted purchases.</p>
        </div>

        {metrics.recentFeedback.length === 0 ? (
          <div className='rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500'>
            Recent feedback will appear once delivered shoppers start submitting fit responses.
          </div>
        ) : (
          <div className='space-y-3'>
            {metrics.recentFeedback.map((entry) => (
              <div
                key={entry.id}
                className='grid gap-3 rounded-2xl border border-slate-200 px-4 py-4 lg:grid-cols-[1.5fr_0.8fr_0.9fr_auto]'
              >
                <div>
                  <p className='font-medium text-slate-900'>{entry.productName}</p>
                  <p className='text-sm text-slate-500'>Recorded {formatDate(entry.createdAt)}</p>
                </div>
                <div>
                  <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Sizes</p>
                  <p className='mt-2 text-sm font-medium text-slate-900'>
                    Bought {entry.selectedSize} | Rec {entry.recommendedSize}
                  </p>
                </div>
                <div>
                  <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Source</p>
                  <p className='mt-2 text-sm font-medium text-slate-900'>{entry.source || 'manual'}</p>
                </div>
                <div className='self-center'>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] ${
                      entry.feedback === 'perfect'
                        ? 'bg-emerald-50 text-emerald-800'
                        : entry.feedback === 'too_small'
                          ? 'bg-amber-50 text-amber-800'
                          : 'bg-rose-50 text-rose-800'
                    }`}
                  >
                    {entry.feedback.replaceAll('_', ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default FitAnalytics;
