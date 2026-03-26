import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';

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

const formatNumber = (value) => new Intl.NumberFormat('en-IN').format(Number(value || 0));

const transactionLabels = {
  order_delivered: 'Order delivered reward',
  referral_referrer: 'Referral conversion reward',
  referral_new_customer: 'New customer referral bonus',
  review_published: 'Published review reward',
  manual_adjustment: 'Manual adjustment',
};

const Loyalty = ({ token }) => {
  const [metrics, setMetrics] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchLoyaltyInsights = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await axios.get(BACKEND_URL + '/api/loyalty/admin', {
        headers: { token },
      });

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to fetch loyalty insights');
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
    fetchLoyaltyInsights();
  }, [fetchLoyaltyInsights]);

  const summaryCards = useMemo(() => {
    if (!metrics) {
      return [];
    }

    return [
      {
        label: 'Active members',
        value: formatNumber(metrics.activeMembers),
      },
      {
        label: 'Points issued',
        value: formatNumber(metrics.totalPointsIssued),
      },
      {
        label: 'Successful referrals',
        value: formatNumber(metrics.successfulReferrals),
      },
      {
        label: 'Platinum members',
        value: formatNumber(metrics.tierBreakdown?.find((tier) => tier.tier === 'Platinum')?.count || 0),
      },
    ];
  }, [metrics]);

  if (isLoading) {
    return <div className='ui-loading-state'>Loading loyalty insights...</div>;
  }

  if (!metrics) {
    return (
      <div className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
        <p className='font-medium text-slate-700'>Loyalty insights are unavailable right now.</p>
        <button
          type='button'
          onClick={fetchLoyaltyInsights}
          className='mt-4 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white'
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-6'>
      <section className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
        <div className='flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between'>
          <div>
            <p className='text-lg font-semibold text-slate-900'>Retention and referral command center</p>
            <p className='text-sm text-slate-500'>
              Track loyalty momentum, referral performance, and the latest points events across the customer base.
            </p>
          </div>

          <button
            type='button'
            onClick={fetchLoyaltyInsights}
            className='rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700'
          >
            Refresh loyalty data
          </button>
        </div>
      </section>

      <section className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
        {summaryCards.map((card) => (
          <article key={card.label} className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
            <p className='text-sm text-slate-500'>{card.label}</p>
            <p className='mt-3 text-3xl font-semibold text-slate-900'>{card.value}</p>
          </article>
        ))}
      </section>

      <section className='grid gap-6 xl:grid-cols-[0.9fr_1.1fr]'>
        <article className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='mb-5'>
            <p className='text-lg font-semibold text-slate-900'>Tier distribution</p>
            <p className='text-sm text-slate-500'>How customers are spread across the current loyalty ladder.</p>
          </div>

          <div className='space-y-4'>
            {(metrics.tierBreakdown || []).map((tier) => {
              const maxTierCount = Math.max(...(metrics.tierBreakdown || []).map((item) => Number(item.count || 0)), 1);
              return (
                <div key={tier.tier}>
                  <div className='mb-2 flex items-center justify-between text-sm'>
                    <span className='text-slate-600'>{tier.tier}</span>
                    <span className='font-medium text-slate-900'>{tier.count}</span>
                  </div>
                  <div className='h-3 overflow-hidden rounded-full bg-slate-100'>
                    <div
                      className='h-full rounded-full bg-gradient-to-r from-slate-900 to-slate-500'
                      style={{ width: `${(Number(tier.count || 0) / maxTierCount) * 100}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='mb-5'>
            <p className='text-lg font-semibold text-slate-900'>Top loyalty members</p>
            <p className='text-sm text-slate-500'>Customers with the strongest rewards engagement and balance.</p>
          </div>

          <div className='space-y-3'>
            {(metrics.topMembers || []).map((member) => (
              <div key={member._id} className='rounded-[28px] border border-slate-200 p-4'>
                <div className='flex items-start justify-between gap-4'>
                  <div>
                    <p className='font-semibold text-slate-900'>{member.name}</p>
                    <p className='text-sm text-slate-500'>{member.email}</p>
                  </div>
                  <span className='rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-700'>
                    {member.loyaltyTier}
                  </span>
                </div>

                <div className='mt-4 grid gap-3 sm:grid-cols-3'>
                  <div className='rounded-2xl bg-slate-50 px-3 py-3'>
                    <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Available</p>
                    <p className='mt-2 text-lg font-semibold text-slate-900'>{formatNumber(member.loyaltyPoints)}</p>
                  </div>
                  <div className='rounded-2xl bg-slate-50 px-3 py-3'>
                    <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Lifetime</p>
                    <p className='mt-2 text-lg font-semibold text-slate-900'>
                      {formatNumber(member.lifetimeLoyaltyPoints)}
                    </p>
                  </div>
                  <div className='rounded-2xl bg-slate-50 px-3 py-3'>
                    <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Referrals</p>
                    <p className='mt-2 text-lg font-semibold text-slate-900'>
                      {formatNumber(member.successfulReferralCount)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className='grid gap-6 xl:grid-cols-[0.9fr_1.1fr]'>
        <article className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='mb-5'>
            <p className='text-lg font-semibold text-slate-900'>Top referrers</p>
            <p className='text-sm text-slate-500'>The customers bringing in the most successful new conversions.</p>
          </div>

          <div className='space-y-3'>
            {(metrics.topReferrers || []).map((referrer) => (
              <div key={referrer._id} className='rounded-[28px] border border-slate-200 p-4'>
                <div className='flex items-start justify-between gap-4'>
                  <div>
                    <p className='font-semibold text-slate-900'>{referrer.name}</p>
                    <p className='text-sm text-slate-500'>{referrer.email}</p>
                  </div>
                  <div className='text-right'>
                    <p className='text-lg font-semibold text-slate-900'>
                      {formatNumber(referrer.successfulReferralCount)}
                    </p>
                    <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>successful referrals</p>
                  </div>
                </div>
                <p className='mt-3 rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-600'>
                  Referral code: <span className='font-semibold text-slate-900'>{referrer.referralCode || 'Not set'}</span>
                </p>
              </div>
            ))}
          </div>
        </article>

        <article className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='mb-5'>
            <p className='text-lg font-semibold text-slate-900'>Recent points activity</p>
            <p className='text-sm text-slate-500'>Latest transactions flowing through the loyalty ledger.</p>
          </div>

          <div className='space-y-3'>
            {(metrics.recentTransactions || []).map((transaction) => (
              <div key={transaction._id} className='rounded-[28px] border border-slate-200 p-4'>
                <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
                  <div>
                    <p className='font-semibold text-slate-900'>
                      {transactionLabels[transaction.type] || 'Rewards event'}
                    </p>
                    <p className='mt-1 text-sm text-slate-500'>
                      {transaction.customer?.name || 'Customer'} • {transaction.customer?.email || 'No email'}
                    </p>
                    <p className='mt-2 text-sm text-slate-600'>{transaction.description}</p>
                  </div>
                  <div className='text-right'>
                    <p className='text-xl font-semibold text-slate-900'>+{formatNumber(transaction.points)}</p>
                    <p className='text-sm text-slate-500'>Balance {formatNumber(transaction.balanceAfter)}</p>
                  </div>
                </div>
                <p className='mt-3 text-xs uppercase tracking-[0.2em] text-slate-400'>
                  {formatDate(transaction.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
};

export default Loyalty;
