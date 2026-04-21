import React, { useCallback, useMemo, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import {
  PageHeader,
  MetricGrid,
  MetricCard,
  Tabs,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
  formatRelativeTime,
  formatDateTime,
} from '../components/ui';
import { useAdminQuery, usePersistedState } from '../hooks';
import { BACKEND_URL } from '../config/api';

/* ── helpers ─────────────────────────────────────────────── */

const formatCompact = (value) =>
  new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0));

const formatPercent = (value) => `${Math.round(Number(value || 0) * 100)}%`;

const TONE_BY_KEY = {
  manual: 'from-slate-900 to-slate-500',
  camera: 'from-sky-700 to-sky-400',
  hybrid: 'from-amber-700 to-amber-400',
  model_backed: 'from-cyan-700 to-cyan-400',
  ml_heuristic_fallback: 'from-indigo-700 to-indigo-400',
  rule_engine: 'from-stone-700 to-stone-400',
  unknown: 'from-slate-400 to-slate-200',
  high: 'from-emerald-600 to-emerald-400',
  medium: 'from-amber-600 to-amber-400',
  low: 'from-rose-600 to-rose-400',
  perfect: 'from-emerald-600 to-emerald-400',
  too_small: 'from-amber-600 to-amber-400',
  too_large: 'from-rose-600 to-rose-400',
};

const RANGE_OPTIONS = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: 'all', label: 'All time', days: null },
];

const downloadCSV = (filename, rows) => {
  const escape = (value) => {
    const string = value === null || value === undefined ? '' : String(value);
    if (/[",\n]/.test(string)) {
      return `"${string.replace(/"/g, '""')}"`;
    }
    return string;
  };
  const csv = rows.map((row) => row.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/* ── breakdown card ──────────────────────────────────────── */

const BreakdownCard = ({ title, description, items, totalOverride = null, emptyMessage, exportName }) => {
  const total = totalOverride ?? items.reduce((sum, item) => sum + Number(item.count || 0), 0);

  const handleExport = () => {
    const rows = [
      ['key', 'label', 'count', 'percent_of_total'],
      ...items.map((item) => {
        const count = Number(item.count || 0);
        const pct = total > 0 ? count / total : 0;
        return [item.key, item.label, count, pct.toFixed(4)];
      }),
    ];
    downloadCSV(`${exportName || title.toLowerCase().replace(/\s+/g, '-')}.csv`, rows);
  };

  return (
    <article className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-[var(--color-text-primary)]">{title}</p>
          <p className="text-sm text-[var(--color-text-secondary)]">{description}</p>
        </div>
        {items.length > 0 && total > 0 ? (
          <button
            type="button"
            onClick={handleExport}
            className="shrink-0 rounded-lg border border-[var(--color-border-strong)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] ui-focus-ring"
            aria-label={`Export ${title} as CSV`}
          >
            Export CSV
          </button>
        ) : null}
      </div>

      {total === 0 ? (
        <div className="rounded-2xl bg-[var(--color-surface-muted)] px-4 py-5 text-sm text-[var(--color-text-secondary)]">
          {emptyMessage}
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const count = Number(item.count || 0);
            const percent = total > 0 ? count / total : 0;
            const width = total > 0 ? Math.max(percent * 100, count > 0 ? 8 : 0) : 0;

            return (
              <div key={item.key}>
                <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-[var(--color-text-primary)]">{item.label}</span>
                  <span
                    className="text-[var(--color-text-secondary)] tabular-nums"
                    title={`${count} of ${total}`}
                  >
                    {formatCompact(count)} · {formatPercent(percent)}
                  </span>
                </div>
                <div
                  className="h-3 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
                  role="progressbar"
                  aria-label={`${item.label} share`}
                  aria-valuenow={Math.round(percent * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${TONE_BY_KEY[item.key] || 'from-slate-800 to-slate-400'}`}
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
};

/* ── main component ──────────────────────────────────────── */

const FitAnalytics = ({ token, serverStatus, onRefreshServerStatus }) => {
  const [range, setRange] = usePersistedState('fitAnalytics.range', 'all');

  const {
    data: metrics,
    isLoading,
    error: fetchError,
    refetch: fetchFitAnalytics,
  } = useAdminQuery(
    'fit-analytics',
    ({ token: t, signal }) =>
      axios
        .get(BACKEND_URL + '/api/fit/admin/analytics', { headers: { token: t }, signal })
        .then((response) => {
          if (!response.data?.success) {
            throw new Error(response.data?.message || 'Failed to fetch fit analytics');
          }
          return response.data.metrics;
        }),
    { token },
  );

  const exportFeedbackCsv = useCallback(() => {
    if (!metrics?.recentFeedback?.length) return;
    const rows = [
      ['id', 'productName', 'createdAt', 'selectedSize', 'recommendedSize', 'source', 'feedback'],
      ...metrics.recentFeedback.map((entry) => [
        entry.id,
        entry.productName,
        entry.createdAt,
        entry.selectedSize,
        entry.recommendedSize,
        entry.source || 'manual',
        entry.feedback,
      ]),
    ];
    downloadCSV('fit-feedback-recent.csv', rows);
  }, [metrics]);

  const summaryCards = useMemo(() => {
    if (!metrics) return [];
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
    if (!metrics) return [];
    return [
      { label: 'Fit enabled', value: metrics.summary.fitEnabledProducts, tone: 'bg-slate-100 text-slate-900' },
      { label: 'Active + ready', value: metrics.summary.activeReadyProducts, tone: 'bg-emerald-50 text-emerald-900' },
      { label: 'Needs data', value: metrics.summary.incompleteFitProducts, tone: 'bg-amber-50 text-amber-900' },
      { label: 'Rule engine share', value: formatPercent(metrics.summary.ruleEngineRate), tone: 'bg-rose-50 text-rose-900' },
      { label: 'Camera-assisted share', value: formatPercent(metrics.summary.cameraAssistedRate), tone: 'bg-sky-50 text-sky-900' },
      { label: 'Confidence floor', value: formatPercent(metrics.runtime.fitConfidenceMin), tone: 'bg-stone-100 text-stone-900' },
    ];
  }, [metrics]);

  const filteredTrend = useMemo(() => {
    if (!metrics?.trend) return [];
    const days = RANGE_OPTIONS.find((option) => option.id === range)?.days;
    if (!days) return metrics.trend;
    return metrics.trend.slice(-days);
  }, [metrics, range]);

  const filteredFeedback = useMemo(() => {
    if (!metrics?.recentFeedback) return [];
    const days = RANGE_OPTIONS.find((option) => option.id === range)?.days;
    if (!days) return metrics.recentFeedback;
    const cutoff = Date.now() - days * 86400000;
    return metrics.recentFeedback.filter((entry) => {
      const stamp = entry.createdAt ? new Date(entry.createdAt).getTime() : 0;
      return Number.isFinite(stamp) && stamp >= cutoff;
    });
  }, [metrics, range]);

  const trendMax = useMemo(
    () =>
      filteredTrend.length
        ? Math.max(
            ...filteredTrend.map((entry) =>
              Math.max(Number(entry.assistedItems || 0), Number(entry.feedbackEntries || 0)),
            ),
            1,
          )
        : 1,
    [filteredTrend],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow="Fit intelligence"
          title="Rollout health & shopper fit feedback"
          description="Product readiness, assisted order activity, confidence bands, and post-delivery feedback in one place."
        />
        <MetricGrid>
          {Array.from({ length: 4 }).map((_, idx) => (
            <LoadingState key={idx} />
          ))}
        </MetricGrid>
        <LoadingState variant="list" rows={3} />
      </div>
    );
  }

  if (fetchError || !metrics) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow="Fit intelligence"
          title="Rollout health & shopper fit feedback"
          description="Product readiness, assisted order activity, confidence bands, and post-delivery feedback in one place."
        />
        <ErrorState
          title="Fit analytics are unavailable"
          description="We could not load the fit analytics dashboard. Please retry or check that the fit API is reachable."
          onRetry={fetchFitAnalytics}
          detail={fetchError?.message}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Fit intelligence"
        title="Rollout health & shopper fit feedback"
        description="Product readiness, assisted order activity, confidence bands, and post-delivery feedback in one place."
        actions={
          <>
            <button
              type="button"
              onClick={fetchFitAnalytics}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 ui-focus-ring"
            >
              Refresh analytics
            </button>
            <button
              type="button"
              onClick={onRefreshServerStatus}
              className="rounded-xl border border-[var(--color-border-strong)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] ui-focus-ring"
            >
              Refresh connection
            </button>
            <Link
              to="/products"
              className="rounded-xl border border-[var(--color-border-strong)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] ui-focus-ring"
            >
              Review catalog
            </Link>
          </>
        }
        meta={
          <>
            <StatusBadge tone="info" size="sm" withDot={false}>
              API {serverStatus}
            </StatusBadge>
            <StatusBadge
              tone={metrics.runtime.fitAssistantEnabled ? 'success' : 'muted'}
              size="sm"
              withDot={false}
            >
              Assistant {metrics.runtime.fitAssistantEnabled ? 'on' : 'off'}
            </StatusBadge>
            <StatusBadge
              tone={metrics.runtime.fitCameraEnabled ? 'success' : 'muted'}
              size="sm"
              withDot={false}
            >
              Camera {metrics.runtime.fitCameraEnabled ? 'on' : 'off'}
            </StatusBadge>
            <StatusBadge tone="neutral" size="sm" withDot={false}>
              Rollout {metrics.runtime.fitRolloutPercent}%
            </StatusBadge>
            <StatusBadge
              tone={metrics.runtime.mlServiceConfigured ? 'success' : 'muted'}
              size="sm"
              withDot={false}
            >
              ML {metrics.runtime.mlServiceConfigured ? 'on' : 'off'}
            </StatusBadge>
            <StatusBadge
              tone={metrics.runtime.calibrationActive ? 'success' : 'muted'}
              size="sm"
              withDot={false}
            >
              Calibrated {metrics.runtime.calibrationActive ? 'on' : 'off'}
            </StatusBadge>
            <StatusBadge
              tone={metrics.runtime.redisConfigured ? 'success' : 'muted'}
              size="sm"
              withDot={false}
            >
              Redis {metrics.runtime.redisConfigured ? 'on' : 'off'}
            </StatusBadge>
            <span
              className="ml-auto text-xs text-[var(--color-text-muted)]"
              title={formatDateTime(metrics.generatedAt)}
            >
              Updated {formatRelativeTime(metrics.generatedAt)}
            </span>
          </>
        }
      />

      <Tabs
        tabs={RANGE_OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
        value={range}
        onChange={setRange}
      />

      <MetricGrid>
        {summaryCards.map((card) => (
          <MetricCard key={card.label} label={card.label} value={card.value} helper={card.helper} />
        ))}
      </MetricGrid>

      <section className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <article className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <p className="text-lg font-semibold text-[var(--color-text-primary)]">Adoption trend</p>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Assisted order items vs. feedback submissions for the selected window.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                downloadCSV(
                  `fit-trend-${range}.csv`,
                  [
                    ['date', 'label', 'assistedItems', 'feedbackEntries'],
                    ...filteredTrend.map((entry) => [
                      entry.key,
                      entry.label,
                      entry.assistedItems,
                      entry.feedbackEntries,
                    ]),
                  ],
                )
              }
              disabled={!filteredTrend.length}
              className="rounded-lg border border-[var(--color-border-strong)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50 ui-focus-ring"
            >
              Export CSV
            </button>
          </div>

          {filteredTrend.length === 0 ? (
            <EmptyState title="No trend data" description="There is no adoption activity in this window." />
          ) : (
            <div
              className={`grid h-64 items-end gap-3`}
              style={{ gridTemplateColumns: `repeat(${filteredTrend.length}, minmax(0, 1fr))` }}
            >
              {filteredTrend.map((entry) => {
                const assisted = Number(entry.assistedItems || 0);
                const feedback = Number(entry.feedbackEntries || 0);
                const assistedPct = (assisted / trendMax) * 100;
                const feedbackPct = (feedback / trendMax) * 100;
                const tooltip = `${entry.label}: ${assisted} assisted · ${feedback} feedback`;
                return (
                  <div key={entry.key} className="flex flex-col items-center gap-3" title={tooltip}>
                    <div
                      className="flex h-full w-full items-end justify-center gap-1 rounded-2xl bg-[var(--color-surface-muted)] px-2 py-3"
                      role="img"
                      aria-label={tooltip}
                    >
                      <div
                        className="w-3 rounded-full bg-gradient-to-t from-slate-900 to-slate-500 transition-[height]"
                        style={{ height: `${Math.max(assistedPct, assisted ? 10 : 4)}%` }}
                      />
                      <div
                        className="w-3 rounded-full bg-gradient-to-t from-emerald-600 to-emerald-300 transition-[height]"
                        style={{ height: `${Math.max(feedbackPct, feedback ? 10 : 4)}%` }}
                      />
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-medium text-[var(--color-text-primary)]">{entry.label}</p>
                      <p className="text-[11px] text-[var(--color-text-muted)] tabular-nums">
                        {assisted}/{feedback}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-4 text-sm text-[var(--color-text-secondary)]">
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-slate-800" aria-hidden="true" />
              Assisted order items
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-emerald-500" aria-hidden="true" />
              Feedback entries
            </span>
          </div>
        </article>

        <article className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
          <div className="mb-6">
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">Rollout pulse</p>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Catalog readiness and recommendation operating posture.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {rolloutCards.map((card) => (
              <div key={card.label} className={`rounded-2xl px-4 py-4 ${card.tone}`}>
                <p className="text-xs uppercase tracking-[0.2em]">{card.label}</p>
                <p className="mt-2 text-2xl font-semibold">{card.value}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <BreakdownCard
          title="Recommendation engine mix"
          description="Stored model version tags on assisted order items."
          items={metrics.breakdowns.engine}
          emptyMessage="Engine mix will appear after assisted orders start flowing through checkout."
          exportName="engine-mix"
        />
        <BreakdownCard
          title="Confidence distribution"
          description="Recommendation confidence bands using the active store threshold."
          items={metrics.breakdowns.confidence}
          emptyMessage="Confidence distribution will appear once assisted recommendations are attached to orders."
          exportName="confidence-distribution"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <BreakdownCard
          title="Recommendation source mix"
          description="How shoppers reached a fit recommendation: manual, camera, or hybrid."
          items={metrics.breakdowns.recommendationSource}
          emptyMessage="Source mix will appear after the first assisted order item is placed."
          exportName="source-mix"
        />
        <BreakdownCard
          title="Feedback outcomes"
          description="How delivered shoppers reported the final fit after purchase."
          items={metrics.breakdowns.feedback}
          emptyMessage="Feedback outcomes will appear once delivered shoppers start submitting fit feedback."
          exportName="feedback-outcomes"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
        <article className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-lg font-semibold text-[var(--color-text-primary)]">Top fit-assisted products</p>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Products generating the most assisted order activity right now.
              </p>
            </div>
            <Link to="/products" className="text-sm font-medium text-slate-900 hover:underline">
              Open catalog
            </Link>
          </div>

          {metrics.topProducts.length === 0 ? (
            <EmptyState
              title="No assisted activity yet"
              description="Product-level fit activity will appear after the first assisted orders land."
            />
          ) : (
            <div className="space-y-3">
              {metrics.topProducts.map((product, index) => (
                <div
                  key={product.productId}
                  className="grid gap-3 rounded-2xl border border-[var(--color-border)] px-4 py-4 lg:grid-cols-[1.8fr_0.7fr_0.7fr_0.7fr_auto]"
                >
                  <div>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--color-surface-muted)] text-sm font-semibold text-[var(--color-text-primary)]">
                        {index + 1}
                      </div>
                      <div>
                        <Link
                          to={`/products/${product.productId}/edit`}
                          className="font-medium text-[var(--color-text-primary)] hover:underline"
                        >
                          {product.name}
                        </Link>
                        <p className="text-sm text-[var(--color-text-secondary)]">{product.category}</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">Assisted</p>
                    <p className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">
                      {product.assistedItems}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">Feedback</p>
                    <p className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">
                      {product.feedbackEntries}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">Perfect</p>
                    <p className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">
                      {formatPercent(product.perfectFeedbackRate)}
                    </p>
                  </div>
                  <div className="self-center">
                    <StatusBadge tone="warning" size="sm" withDot={false}>
                      {formatPercent(product.overrideRate)} override
                    </StatusBadge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
          <div className="mb-5">
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">Products needing fit data</p>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Fit-enabled products that still do not meet rollout readiness.
            </p>
          </div>

          {metrics.incompleteProducts.length === 0 ? (
            <div className="rounded-2xl bg-emerald-50 px-4 py-5 text-sm text-emerald-900">
              No fit-enabled products are blocked by incomplete measurement data right now.
            </div>
          ) : (
            <div className="space-y-3">
              {metrics.incompleteProducts.map((product) => (
                <div
                  key={product.productId}
                  className="rounded-2xl border border-[var(--color-border)] px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <Link
                        to={`/products/${product.productId}/edit`}
                        className="font-medium text-[var(--color-text-primary)] hover:underline"
                      >
                        {product.name}
                      </Link>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        {product.category} · {product.measurementTemplate}
                      </p>
                    </div>
                    <StatusBadge tone="warning" size="sm" withDot={false}>
                      {product.readinessPercent}% ready
                    </StatusBadge>
                  </div>
                  <div
                    className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
                    role="progressbar"
                    aria-label={`${product.name} readiness`}
                    aria-valuenow={product.readinessPercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-300"
                      style={{ width: `${Math.max(product.readinessPercent, 6)}%` }}
                    />
                  </div>
                  <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
                    Completed sizes: {product.completedSizes}/{product.totalSizes} · Status: {product.status}
                  </p>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">Recent fit feedback</p>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Latest shopper-reported outcomes from delivered assisted purchases.
            </p>
          </div>
          {filteredFeedback.length > 0 ? (
            <button
              type="button"
              onClick={exportFeedbackCsv}
              className="shrink-0 rounded-lg border border-[var(--color-border-strong)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] ui-focus-ring"
            >
              Export CSV
            </button>
          ) : null}
        </div>

        {filteredFeedback.length === 0 ? (
          <EmptyState
            title="No feedback in this window"
            description="Recent feedback will appear once delivered shoppers start submitting fit responses."
          />
        ) : (
          <div className="space-y-3">
            {filteredFeedback.map((entry) => (
              <div
                key={entry.id}
                className="grid gap-3 rounded-2xl border border-[var(--color-border)] px-4 py-4 lg:grid-cols-[1.5fr_0.8fr_0.9fr_auto]"
              >
                <div>
                  <p className="font-medium text-[var(--color-text-primary)]">{entry.productName}</p>
                  <p
                    className="text-sm text-[var(--color-text-secondary)]"
                    title={formatDateTime(entry.createdAt)}
                  >
                    Recorded {formatRelativeTime(entry.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">Sizes</p>
                  <p className="mt-2 text-sm font-medium text-[var(--color-text-primary)]">
                    Bought {entry.selectedSize} · Rec {entry.recommendedSize}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">Source</p>
                  <p className="mt-2 text-sm font-medium text-[var(--color-text-primary)]">
                    {entry.source || 'manual'}
                  </p>
                </div>
                <div className="self-center">
                  <StatusBadge
                    tone={
                      entry.feedback === 'perfect'
                        ? 'success'
                        : entry.feedback === 'too_small'
                          ? 'warning'
                          : 'danger'
                    }
                    size="sm"
                    withDot={false}
                  >
                    {entry.feedback.replaceAll('_', ' ')}
                  </StatusBadge>
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
