import React, { useCallback, useMemo, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';
import {
  PageHeader,
  MetricGrid,
  MetricCard,
  Toolbar,
  Tabs,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
  Drawer,
  formatNumber,
  formatRelativeTime,
  formatDateTime,
} from '../components/ui';
import { useAdminQuery, useDebouncedValue, usePersistedState } from '../hooks';

/* ── helpers ─────────────────────────────────────────────── */

const TRANSACTION_LABELS = {
  order_delivered: 'Order delivered reward',
  referral_referrer: 'Referral conversion reward',
  referral_new_customer: 'New customer referral bonus',
  review_published: 'Published review reward',
  manual_adjustment: 'Manual adjustment',
};

const TRANSACTION_TYPE_OPTIONS = [
  { value: 'all', label: 'All event types' },
  { value: 'order_delivered', label: 'Order delivered' },
  { value: 'referral_referrer', label: 'Referral conversion' },
  { value: 'referral_new_customer', label: 'New referral bonus' },
  { value: 'review_published', label: 'Review published' },
  { value: 'manual_adjustment', label: 'Manual adjustment' },
];

const TIER_TONES = {
  Platinum: 'bg-slate-900 text-white',
  Gold: 'bg-amber-100 text-amber-900',
  Silver: 'bg-slate-200 text-slate-800',
  Bronze: 'bg-amber-50 text-amber-700',
};

/* ── manual adjustment dialog ────────────────────────────── */

const ManualAdjustmentDialog = ({ open, onClose, onSubmit, isSubmitting }) => {
  const [userId, setUserId] = useState('');
  const [points, setPoints] = useState('');
  const [description, setDescription] = useState('');

  const reset = () => {
    setUserId('');
    setPoints('');
    setDescription('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const ok = await onSubmit({
      userId: userId.trim(),
      points: Number(points),
      description: description.trim(),
    });
    if (ok) {
      reset();
    }
  };

  const numericPoints = Number(points);
  const valid =
    /^[a-f\d]{24}$/i.test(userId.trim()) &&
    Number.isFinite(numericPoints) &&
    numericPoints !== 0 &&
    description.trim().length >= 3 &&
    description.trim().length <= 180;

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="Adjust loyalty points"
      description="Manually credit or debit a customer's rewards balance. The change is logged in the loyalty ledger as a manual_adjustment event."
      width="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl border border-[var(--color-border-strong)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] ui-focus-ring"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="manual-adjustment-form"
            disabled={!valid || isSubmitting}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ui-focus-ring"
          >
            {isSubmitting ? 'Adjusting…' : 'Apply adjustment'}
          </button>
        </div>
      }
    >
      <form id="manual-adjustment-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="adj-user-id" className="text-sm font-medium text-[var(--color-text-primary)]">
            Customer ID
          </label>
          <input
            id="adj-user-id"
            type="text"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="24-character Mongo id"
            autoComplete="off"
            className="mt-1 w-full rounded-xl border border-[var(--color-border-strong)] bg-white px-3 py-2 font-mono text-sm text-[var(--color-text-primary)]"
            required
          />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Find this on the Customers page; click any customer and copy the id from the detail header.
          </p>
        </div>

        <div>
          <label htmlFor="adj-points" className="text-sm font-medium text-[var(--color-text-primary)]">
            Points delta
          </label>
          <input
            id="adj-points"
            type="number"
            value={points}
            onChange={(event) => setPoints(event.target.value)}
            placeholder="e.g. 250 to credit, -100 to deduct"
            className="mt-1 w-full rounded-xl border border-[var(--color-border-strong)] bg-white px-3 py-2 text-sm text-[var(--color-text-primary)]"
            required
          />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Negative numbers deduct; the API rejects deductions that would push the balance below zero.
          </p>
        </div>

        <div>
          <label htmlFor="adj-description" className="text-sm font-medium text-[var(--color-text-primary)]">
            Reason (visible in the audit ledger)
          </label>
          <textarea
            id="adj-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            minLength={3}
            maxLength={180}
            placeholder="e.g. Goodwill credit for delayed shipment on order #1234"
            className="mt-1 w-full rounded-xl border border-[var(--color-border-strong)] bg-white px-3 py-2 text-sm text-[var(--color-text-primary)]"
            required
          />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {description.trim().length}/180 characters · Minimum 3
          </p>
        </div>
      </form>
    </Drawer>
  );
};

/* ── customer detail drawer ──────────────────────────────── */

const CustomerDetailDrawer = ({ open, onClose, member }) => {
  if (!member) {
    return null;
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={member.name || 'Loyalty member'}
      description={member.email}
      width="md"
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${TIER_TONES[member.loyaltyTier] || TIER_TONES.Bronze}`}
          >
            {member.loyaltyTier || 'Bronze'}
          </span>
          <Link
            to={`/customers?id=${encodeURIComponent(member._id)}`}
            className="text-sm font-medium text-slate-900 underline-offset-4 hover:underline"
          >
            Open in Customers
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-[var(--color-surface-muted)] px-3 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">Available</p>
            <p className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">
              {formatNumber(member.loyaltyPoints)}
            </p>
          </div>
          <div className="rounded-2xl bg-[var(--color-surface-muted)] px-3 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">Lifetime</p>
            <p className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">
              {formatNumber(member.lifetimeLoyaltyPoints)}
            </p>
          </div>
          <div className="rounded-2xl bg-[var(--color-surface-muted)] px-3 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">Referrals</p>
            <p className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">
              {formatNumber(member.successfulReferralCount)}
            </p>
          </div>
        </div>

        {member.referralCode ? (
          <div className="rounded-2xl border border-[var(--color-border)] bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">Referral code</p>
            <p className="mt-1 font-mono text-sm text-[var(--color-text-primary)]">{member.referralCode}</p>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
};

/* ── main component ──────────────────────────────────────── */

const Loyalty = ({ token }) => {
  const {
    data: metrics,
    isLoading,
    error: fetchError,
    refetch: fetchLoyalty,
  } = useAdminQuery(
    'loyalty',
    ({ token: t, signal }) =>
      axios
        .get(BACKEND_URL + '/api/loyalty/admin', { headers: { token: t }, signal })
        .then((response) => {
          if (!response.data?.success) {
            throw new Error(response.data?.message || 'Failed to fetch loyalty insights');
          }
          return response.data.metrics;
        }),
    { token },
  );

  const [transactionSearch, setTransactionSearch] = useState('');
  const debouncedSearch = useDebouncedValue(transactionSearch, 200);
  const [transactionType, setTransactionType] = usePersistedState('loyalty.txnType', 'all');
  const [activeSection, setActiveSection] = usePersistedState('loyalty.section', 'overview');

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [memberDrawer, setMemberDrawer] = useState(null);

  const handleManualAdjust = useCallback(
    async ({ userId, points, description }) => {
      setIsAdjusting(true);
      try {
        const response = await axios.post(
          BACKEND_URL + '/api/loyalty/admin/adjust',
          { userId, points, description },
          { headers: { token } },
        );
        if (!response.data?.success) {
          toast.error(response.data?.message || 'Failed to adjust points');
          return false;
        }
        toast.success(response.data.message || 'Points adjusted');
        setAdjustOpen(false);
        fetchLoyalty();
        return true;
      } catch (error) {
        toast.error(error?.response?.data?.message || error.message);
        return false;
      } finally {
        setIsAdjusting(false);
      }
    },
    [fetchLoyalty, token],
  );

  /* Derived data */
  const summaryCards = useMemo(() => {
    if (!metrics) return [];
    const platinum = metrics.tierBreakdown?.find((tier) => tier.tier === 'Platinum')?.count || 0;
    return [
      { label: 'Active members', value: formatNumber(metrics.activeMembers) },
      { label: 'Points issued', value: formatNumber(metrics.totalPointsIssued) },
      { label: 'Successful referrals', value: formatNumber(metrics.successfulReferrals) },
      { label: 'Platinum members', value: formatNumber(platinum) },
    ];
  }, [metrics]);

  const totalTierMembers = useMemo(
    () => (metrics?.tierBreakdown || []).reduce((sum, tier) => sum + Number(tier.count || 0), 0),
    [metrics],
  );

  const filteredTransactions = useMemo(() => {
    if (!metrics?.recentTransactions) return [];
    const query = debouncedSearch.trim().toLowerCase();
    return metrics.recentTransactions.filter((transaction) => {
      if (transactionType !== 'all' && transaction.type !== transactionType) {
        return false;
      }
      if (!query) return true;
      const haystack = [
        transaction.customer?.name,
        transaction.customer?.email,
        transaction.description,
        transaction.type,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [metrics, debouncedSearch, transactionType]);

  const sectionTabs = useMemo(
    () => [
      { id: 'overview', label: 'Overview' },
      { id: 'members', label: 'Top members', count: metrics?.topMembers?.length || 0 },
      { id: 'referrers', label: 'Top referrers', count: metrics?.topReferrers?.length || 0 },
      { id: 'transactions', label: 'Activity', count: metrics?.recentTransactions?.length || 0 },
    ],
    [metrics],
  );

  /* ── render ────────────────────────────────────────── */

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow="Loyalty"
          title="Retention & referral command center"
          description="Track loyalty momentum, referral performance, and the latest points events across the customer base."
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
          eyebrow="Loyalty"
          title="Retention & referral command center"
          description="Track loyalty momentum, referral performance, and the latest points events across the customer base."
        />
        <ErrorState
          title="Loyalty insights are unavailable"
          description="We could not load the loyalty dashboard. Please retry or check that the loyalty API is reachable."
          onRetry={fetchLoyalty}
          detail={fetchError?.message}
        />
      </div>
    );
  }

  const renderTierBars = () => (
    <article className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-[var(--color-text-primary)]">Tier distribution</p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            How {formatNumber(totalTierMembers)} customers are spread across the loyalty ladder.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {(metrics.tierBreakdown || []).map((tier) => {
          const count = Number(tier.count || 0);
          const percent = totalTierMembers > 0 ? (count / totalTierMembers) * 100 : 0;
          return (
            <div key={tier.tier}>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-[var(--color-text-primary)]">{tier.tier}</span>
                <span className="text-[var(--color-text-secondary)]">
                  {formatNumber(count)} · {percent.toFixed(percent >= 10 ? 0 : 1)}%
                </span>
              </div>
              <div
                className="h-3 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
                role="progressbar"
                aria-label={`${tier.tier} share`}
                aria-valuenow={Math.round(percent)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-slate-900 to-slate-500"
                  style={{ width: `${Math.max(percent, count > 0 ? 4 : 0)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );

  const renderMembers = () => (
    <article className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-[var(--color-text-primary)]">Top loyalty members</p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Customers with the strongest rewards engagement. Click a row for the full ledger view.
          </p>
        </div>
      </div>

      {(metrics.topMembers || []).length === 0 ? (
        <EmptyState
          title="No members yet"
          description="Loyalty activity will appear once customers earn their first points."
        />
      ) : (
        <div className="space-y-3">
          {metrics.topMembers.map((member) => (
            <button
              key={member._id}
              type="button"
              onClick={() => setMemberDrawer(member)}
              className="block w-full rounded-3xl border border-[var(--color-border)] bg-white p-4 text-left transition hover:border-slate-300 hover:bg-[var(--color-surface-muted)] ui-focus-ring"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--color-text-primary)]">{member.name}</p>
                  <p className="truncate text-sm text-[var(--color-text-secondary)]">{member.email}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${TIER_TONES[member.loyaltyTier] || TIER_TONES.Bronze}`}
                >
                  {member.loyaltyTier}
                </span>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-[var(--color-surface-muted)] px-3 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">Available</p>
                  <p className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">
                    {formatNumber(member.loyaltyPoints)}
                  </p>
                </div>
                <div className="rounded-2xl bg-[var(--color-surface-muted)] px-3 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">Lifetime</p>
                  <p className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">
                    {formatNumber(member.lifetimeLoyaltyPoints)}
                  </p>
                </div>
                <div className="rounded-2xl bg-[var(--color-surface-muted)] px-3 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">Referrals</p>
                  <p className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">
                    {formatNumber(member.successfulReferralCount)}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </article>
  );

  const renderReferrers = () => (
    <article className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
      <div className="mb-5">
        <p className="text-lg font-semibold text-[var(--color-text-primary)]">Top referrers</p>
        <p className="text-sm text-[var(--color-text-secondary)]">
          The customers bringing in the most successful new conversions.
        </p>
      </div>

      {(metrics.topReferrers || []).length === 0 ? (
        <EmptyState
          title="No referral activity yet"
          description="Successful referrals will appear here once customers start sharing their codes."
        />
      ) : (
        <div className="space-y-3">
          {metrics.topReferrers.map((referrer) => (
            <div key={referrer._id} className="rounded-3xl border border-[var(--color-border)] bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--color-text-primary)]">{referrer.name}</p>
                  <p className="truncate text-sm text-[var(--color-text-secondary)]">{referrer.email}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-[var(--color-text-primary)]">
                    {formatNumber(referrer.successfulReferralCount)}
                  </p>
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)]">
                    successful referrals
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-[var(--color-surface-muted)] px-3 py-3 text-sm text-[var(--color-text-secondary)]">
                <span>
                  Referral code:{' '}
                  <span className="font-semibold text-[var(--color-text-primary)]">
                    {referrer.referralCode || 'Not set'}
                  </span>
                </span>
                <Link
                  to={`/customers?id=${encodeURIComponent(referrer._id)}`}
                  className="ml-auto text-xs font-medium text-slate-900 underline-offset-4 hover:underline"
                >
                  Open in Customers →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );

  const renderTransactions = () => (
    <article className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-[var(--color-text-primary)]">Recent points activity</p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Latest transactions flowing through the loyalty ledger. Filter by event type or search by
            customer.
          </p>
        </div>
      </div>

      <Toolbar
        searchValue={transactionSearch}
        onSearchChange={setTransactionSearch}
        searchPlaceholder="Search by customer name, email, or description…"
        filters={
          <>
            <label htmlFor="loyalty-txn-type" className="sr-only">
              Filter by transaction type
            </label>
            <select
              id="loyalty-txn-type"
              value={transactionType}
              onChange={(event) => setTransactionType(event.target.value)}
              className="rounded-xl border border-[var(--color-border-strong)] bg-white px-3 py-2 text-sm text-[var(--color-text-primary)]"
            >
              {TRANSACTION_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {(transactionSearch || transactionType !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setTransactionSearch('');
                  setTransactionType('all');
                }}
                className="text-xs font-medium text-[var(--color-text-muted)] underline-offset-4 hover:text-[var(--color-text-primary)] hover:underline"
              >
                Clear filters
              </button>
            )}
          </>
        }
        className="mb-4"
      />

      {filteredTransactions.length === 0 ? (
        <EmptyState
          title="No matching transactions"
          description="Try a different search or clear the type filter."
        />
      ) : (
        <ul className="space-y-3">
          {filteredTransactions.map((transaction) => {
            const points = Number(transaction.points || 0);
            const isCredit = points >= 0;
            return (
              <li
                key={transaction._id}
                className="rounded-3xl border border-[var(--color-border)] bg-white p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-[var(--color-text-primary)]">
                        {TRANSACTION_LABELS[transaction.type] || 'Rewards event'}
                      </p>
                      <StatusBadge tone="neutral" size="sm" withDot={false}>
                        {transaction.type?.replaceAll('_', ' ') || 'event'}
                      </StatusBadge>
                    </div>
                    {transaction.customer ? (
                      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                        {transaction.customer.name || 'Customer'} · {transaction.customer.email || 'No email'}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-[var(--color-text-subtle)]">Customer no longer available</p>
                    )}
                    {transaction.description ? (
                      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                        {transaction.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-xl font-semibold ${isCredit ? 'text-emerald-700' : 'text-rose-700'}`}
                    >
                      {isCredit ? '+' : ''}
                      {formatNumber(points)}
                    </p>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      Balance {formatNumber(transaction.balanceAfter)}
                    </p>
                  </div>
                </div>
                <p
                  className="mt-3 text-xs uppercase tracking-[0.2em] text-[var(--color-text-subtle)]"
                  title={formatDateTime(transaction.createdAt)}
                >
                  {formatRelativeTime(transaction.createdAt)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Loyalty"
        title="Retention & referral command center"
        description="Track loyalty momentum, referral performance, and the latest points events across the customer base."
        actions={
          <>
            <button
              type="button"
              onClick={() => setAdjustOpen(true)}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 ui-focus-ring"
            >
              Adjust points
            </button>
            <button
              type="button"
              onClick={fetchLoyalty}
              className="rounded-xl border border-[var(--color-border-strong)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] ui-focus-ring"
            >
              Refresh
            </button>
          </>
        }
      />

      <MetricGrid>
        {summaryCards.map((card) => (
          <MetricCard key={card.label} label={card.label} value={card.value} />
        ))}
      </MetricGrid>

      <Tabs tabs={sectionTabs} value={activeSection} onChange={setActiveSection} />

      {activeSection === 'overview' && (
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          {renderTierBars()}
          {renderMembers()}
        </div>
      )}

      {activeSection === 'members' && renderMembers()}
      {activeSection === 'referrers' && renderReferrers()}
      {activeSection === 'transactions' && renderTransactions()}

      <ManualAdjustmentDialog
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        onSubmit={handleManualAdjust}
        isSubmitting={isAdjusting}
      />

      <CustomerDetailDrawer
        open={Boolean(memberDrawer)}
        onClose={() => setMemberDrawer(null)}
        member={memberDrawer}
      />
    </div>
  );
};

export default Loyalty;
