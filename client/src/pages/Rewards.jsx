import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ShopContext } from '../context/ShopContext';

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

const transactionLabels = {
  order_delivered: 'Order delivered reward',
  referral_referrer: 'Referral reward',
  referral_new_customer: 'Welcome referral bonus',
  review_published: 'Review reward',
  manual_adjustment: 'Manual adjustment',
  points_redeemed: 'Checkout redemption',
};

const transactionTone = {
  order_delivered: 'bg-sky-50 text-sky-700',
  referral_referrer: 'bg-emerald-50 text-emerald-700',
  referral_new_customer: 'bg-violet-50 text-violet-700',
  review_published: 'bg-amber-50 text-amber-700',
  manual_adjustment: 'bg-slate-100 text-slate-700',
  points_redeemed: 'bg-rose-50 text-rose-700',
};

const defaultSummary = {
  loyaltyPoints: 0,
  availableLoyaltyPoints: 0,
  reservedLoyaltyPoints: 0,
  lifetimeLoyaltyPoints: 0,
  referralCode: '',
  successfulReferralCount: 0,
  pendingReferralCount: 0,
  currentTier: 'Bronze',
  nextTier: 'Silver',
  pointsToNextTier: 500,
  nextTierThreshold: 500,
  recentTransactions: [],
};

const earnWays = [
  {
    title: 'Place orders',
    description: 'Points unlock automatically after your delivered purchases.',
  },
  {
    title: 'Refer friends',
    description: 'Get referral points once your invite completes a delivered order.',
  },
  {
    title: 'Publish reviews',
    description: 'Verified product reviews can earn bonus points after approval.',
  },
];

const redeemOptions = [
  {
    id: 'reward-100',
    title: 'Rs 100 off coupon',
    pointsCost: 200,
    description: 'Apply at checkout on your next order.',
  },
  {
    id: 'reward-250',
    title: 'Rs 250 off coupon',
    pointsCost: 450,
    description: 'Great for mid-cart purchases.',
  },
  {
    id: 'reward-free-shipping',
    title: 'Free shipping pass',
    pointsCost: 300,
    description: 'Waive delivery fee on one eligible order.',
  },
];

const Rewards = () => {
  const { BACKEND_URL, navigate, toast, token } = useContext(ShopContext);
  const [summary, setSummary] = useState(defaultSummary);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchRewardsSummary = useCallback(
    async ({ silent = false } = {}) => {
      if (!token) {
        setSummary(defaultSummary);
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      if (silent) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      try {
        const response = await axios.get(BACKEND_URL + '/api/loyalty/summary', {
          headers: { token },
        });

        if (!response.data.success) {
          toast.error(response.data.message || 'Unable to load rewards');
          return;
        }

        setSummary({ ...defaultSummary, ...(response.data.summary || {}) });
      } catch (error) {
        toast.error(error?.response?.data?.message || error.message);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [BACKEND_URL, toast, token]
  );

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    fetchRewardsSummary();
  }, [fetchRewardsSummary, token]);

  const tierProgress = useMemo(() => {
    const threshold = Math.max(1, Number(summary.nextTierThreshold || 500));
    const completed = Math.max(0, threshold - Number(summary.pointsToNextTier || 0));
    const clampedCompleted = Math.min(threshold, completed);
    const percentage = Math.min(100, Math.round((clampedCompleted / threshold) * 100));

    return {
      threshold,
      completed: clampedCompleted,
      percentage,
    };
  }, [summary.nextTierThreshold, summary.pointsToNextTier]);

  const statItems = [
    {
      key: 'available',
      label: 'Available points',
      value: Number(summary.availableLoyaltyPoints || 0),
      tone: 'bg-emerald-100 text-emerald-700',
    },
    {
      key: 'reserved',
      label: 'Reserved points',
      value: Number(summary.reservedLoyaltyPoints || 0),
      tone: 'bg-amber-100 text-amber-700',
    },
    {
      key: 'lifetime',
      label: 'Lifetime points',
      value: Number(summary.lifetimeLoyaltyPoints || 0),
      tone: 'bg-sky-100 text-sky-700',
    },
    {
      key: 'referrals',
      label: 'Referrals',
      value: Number(summary.successfulReferralCount || 0),
      tone: 'bg-violet-100 text-violet-700',
    },
  ];

  const copyReferralCode = async () => {
    if (!summary.referralCode) {
      toast.info('Your referral code is being prepared');
      return;
    }

    try {
      await navigator.clipboard.writeText(summary.referralCode);
      toast.success('Referral code copied');
    } catch {
      toast.info(`Referral code: ${summary.referralCode}`);
    }
  };

  const shareReferralCode = async () => {
    if (!summary.referralCode) {
      toast.info('Your referral code is being prepared');
      return;
    }

    const shareText = `Use my Lavish Fashion referral code ${summary.referralCode} and unlock rewards.`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Lavish Fashion Rewards',
          text: shareText,
        });
        return;
      }

      await navigator.clipboard.writeText(shareText);
      toast.success('Referral message copied');
    } catch {
      toast.info(`Referral code: ${summary.referralCode}`);
    }
  };

  const scrollToRedeem = () => {
    document.getElementById('redeem-rewards')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!token) {
    return (
      <div className='min-h-[70vh] flex flex-col items-center justify-center text-center px-4 border-t'>
        <h2 className='text-3xl font-semibold text-slate-900'>Rewards</h2>
        <p className='mt-2 text-base text-slate-600'>Earn & redeem points</p>
        <p className='mt-4 max-w-md text-sm text-slate-500'>Please login to unlock your rewards balance, referral code, and activity history.</p>
        <button
          onClick={() => navigate('/login')}
          className='mt-6 rounded-full bg-slate-950 px-8 py-3 text-sm font-medium text-white transition hover:bg-slate-800'
        >
          LOGIN TO CONTINUE
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className='border-t pt-8 sm:pt-10 pb-14 space-y-4'>
        <div className='lf-shimmer h-8 w-40 rounded-full'></div>
        <div className='lf-shimmer h-5 w-52 rounded-full'></div>
        <div className='rounded-[28px] bg-slate-900 p-5 sm:p-6'>
          <div className='lf-shimmer h-5 w-36 rounded-full bg-slate-700'></div>
          <div className='mt-4 lf-shimmer h-14 w-28 rounded-2xl bg-slate-700'></div>
          <div className='mt-5 lf-shimmer h-2.5 w-full rounded-full bg-slate-700'></div>
          <div className='mt-4 grid grid-cols-2 gap-2'>
            <div className='lf-shimmer h-11 rounded-full bg-slate-700'></div>
            <div className='lf-shimmer h-11 rounded-full bg-slate-700'></div>
          </div>
        </div>
        <div className='lf-shimmer h-36 rounded-[24px]'></div>
        <div className='lf-shimmer h-40 rounded-[24px]'></div>
      </div>
    );
  }

  return (
    <div className='rewards-shell border-t pt-8 sm:pt-10 pb-14'>
      <div className='rewards-entrance rewards-delay-0 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <h1 className='text-[2rem] sm:text-[2.35rem] font-semibold tracking-[-0.015em] text-[#111] leading-none'>Rewards</h1>
          <p className='mt-2 text-sm text-slate-500'>Earn & redeem points</p>
        </div>

        <button
          type='button'
          onClick={() => fetchRewardsSummary({ silent: true })}
          disabled={isRefreshing}
          className='w-full sm:w-auto rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 disabled:opacity-60 disabled:cursor-not-allowed'
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh rewards'}
        </button>
      </div>

      {isRefreshing ? (
        <div className='rewards-entrance rewards-delay-1 mt-3 space-y-2'>
          <div className='lf-shimmer h-2.5 w-36 rounded-full'></div>
          <div className='lf-shimmer h-2 w-full rounded-full'></div>
        </div>
      ) : null}

      <section className='rewards-entrance rewards-delay-1 mt-5 rounded-[28px] bg-gradient-to-br from-slate-950 via-[#0b1c4e] to-slate-900 p-5 sm:p-6 text-white shadow-[0_10px_28px_rgba(15,23,42,0.26)]'>
        <div className='grid gap-5 lg:grid-cols-[1fr_auto]'>
          <div>
            <p className='text-xs uppercase tracking-[0.3em] text-slate-300'>Loyalty status</p>
            <h2 className='mt-2 text-[2rem] sm:text-[2.3rem] leading-none font-semibold'>
              {summary.currentTier} member
            </h2>

            <div className='mt-4'>
              <p className='text-xs uppercase tracking-[0.26em] text-slate-300'>Current points</p>
              <p className='mt-1 text-5xl sm:text-6xl font-semibold tracking-[-0.02em]'>
                {Number(summary.availableLoyaltyPoints || 0)}
              </p>
            </div>

            <div className='mt-5'>
              <div className='mb-2 flex items-center justify-between text-xs sm:text-sm text-slate-300'>
                <span>
                  {tierProgress.completed}/{tierProgress.threshold} points
                </span>
                <span>{tierProgress.percentage}%</span>
              </div>
              <div className='h-2.5 overflow-hidden rounded-full bg-white/15'>
                <div
                  className='h-full rounded-full bg-gradient-to-r from-amber-300 via-emerald-300 to-sky-300 transition-all duration-700'
                  style={{ width: `${tierProgress.percentage}%` }}
                ></div>
              </div>
              <p className='mt-2 text-xs text-slate-300'>
                Progress to {summary.nextTier || 'top tier'}
                {summary.nextTier ? ` • ${summary.pointsToNextTier} points to go` : ' • Top tier unlocked'}
              </p>
            </div>
          </div>

          <div className='rounded-3xl border border-white/15 bg-white/10 p-4 min-w-[175px]'>
            <p className='text-[11px] uppercase tracking-[0.2em] text-slate-300'>Tier target</p>
            <p className='mt-2 text-lg font-semibold'>{summary.nextTier || 'Top tier'}</p>
            <p className='mt-1 text-sm text-slate-300'>{summary.pointsToNextTier || 0} points left</p>
          </div>
        </div>

        <div className='mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5'>
          <button
            type='button'
            onClick={() => navigate('/collection')}
            className='rounded-full bg-white px-4 py-3 text-sm font-semibold text-slate-900'
          >
            Earn Points
          </button>
          <button
            type='button'
            onClick={scrollToRedeem}
            className='rounded-full border border-white/40 px-4 py-3 text-sm font-semibold text-white'
          >
            Redeem Rewards
          </button>
        </div>
      </section>

      <section className='rewards-entrance rewards-delay-2 mt-5 rounded-[24px] border border-slate-200/90 bg-white/95 p-2.5 sm:p-3'>
        <div className='grid grid-cols-2 divide-x divide-y divide-slate-100'>
          {statItems.map((item, index) => (
            <div
              key={item.key}
              className='rewards-entrance px-3 py-3 sm:px-4 sm:py-4'
              style={{ animationDelay: `${Math.min(0.2 + index * 0.05, 0.4)}s` }}
            >
              <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${item.tone}`}>
                <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor' className='h-4 w-4'>
                  <path d='M12 2a10 10 0 100 20 10 10 0 000-20zm1 5v4h4v2h-6V7h2z' />
                </svg>
              </span>
              <p className='mt-2 text-xs text-slate-500'>{item.label}</p>
              <p className='mt-1 text-2xl font-semibold tracking-[-0.02em] text-slate-900'>{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className='rewards-entrance rewards-delay-3 mt-5 rounded-[24px] border border-slate-200 bg-white p-4 sm:p-5'>
        <div className='flex items-start justify-between gap-3'>
          <div>
            <p className='text-[11px] uppercase tracking-[0.22em] text-slate-500'>Referral code</p>
            <p className='mt-2 text-[2rem] sm:text-[2.2rem] leading-none font-semibold tracking-[0.14em] text-slate-900'>
              {summary.referralCode || 'PREPARING'}
            </p>
            <p className='mt-2 text-sm text-slate-500'>
              Share with friends. Rewards unlock after their first delivered order.
            </p>
          </div>
          <span className='inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white'>
            <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor' className='h-5 w-5'>
              <path d='M15 8a3 3 0 10-2.83-4H12a3 3 0 003 4zM6 14a3 3 0 10-2.83-4H3a3 3 0 003 4zm9 8a3 3 0 10-2.83-4H12a3 3 0 003 4zM6.59 12.51l5.02 2.49-.9 1.8-5.02-2.49.9-1.8zm9.22-5.02l.9 1.8-5.02 2.49-.9-1.8 5.02-2.49z' />
            </svg>
          </span>
        </div>

        <div className='mt-4 grid grid-cols-2 gap-2'>
          <button
            type='button'
            onClick={copyReferralCode}
            className='rounded-full border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700'
          >
            Copy
          </button>
          <button
            type='button'
            onClick={shareReferralCode}
            className='rounded-full bg-slate-950 px-4 py-2.5 text-sm font-medium text-white'
          >
            Share
          </button>
        </div>
      </section>

      <section className='mt-5 grid gap-4 lg:grid-cols-2'>
        <article className='rewards-entrance rewards-delay-4 rounded-[24px] border border-slate-200 bg-white p-4 sm:p-5'>
          <h2 className='text-lg font-semibold text-slate-900'>How to earn points</h2>
          <ul className='mt-4 space-y-2.5'>
            {earnWays.map((way, index) => (
              <li
                key={way.title}
                className='rewards-entrance flex items-start gap-3 rounded-2xl bg-slate-50 px-3 py-3'
                style={{ animationDelay: `${Math.min(0.3 + index * 0.05, 0.5)}s` }}
              >
                <span className='mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white'>
                  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor' className='h-3.5 w-3.5'>
                    <path d='M9 16.17l-3.88-3.88L3.7 13.7 9 19l12-12-1.41-1.41z' />
                  </svg>
                </span>
                <div>
                  <p className='text-sm font-medium text-slate-900'>{way.title}</p>
                  <p className='mt-0.5 text-xs text-slate-500'>{way.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article id='redeem-rewards' className='rewards-entrance rewards-delay-5 rounded-[24px] border border-slate-200 bg-white p-4 sm:p-5'>
          <h2 className='text-lg font-semibold text-slate-900'>Redeem rewards</h2>
          <p className='mt-1 text-sm text-slate-500'>Use points for instant savings on checkout.</p>

          <div className='mt-4 space-y-2.5'>
            {redeemOptions.map((option, index) => {
              const hasEnoughPoints = Number(summary.availableLoyaltyPoints || 0) >= option.pointsCost;

              return (
                <div
                  key={option.id}
                  className='rewards-entrance rewards-hover-lift rounded-2xl border border-slate-200 p-3'
                  style={{ animationDelay: `${Math.min(0.34 + index * 0.05, 0.54)}s` }}
                >
                  <div className='flex items-start justify-between gap-3'>
                    <div>
                      <p className='text-sm font-semibold text-slate-900'>{option.title}</p>
                      <p className='mt-1 text-xs text-slate-500'>{option.description}</p>
                    </div>
                    <span className='rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700'>
                      {option.pointsCost} pts
                    </span>
                  </div>

                  <button
                    type='button'
                    onClick={() => toast.info('Reward redemption at checkout is coming soon')}
                    disabled={!hasEnoughPoints}
                    className='mt-3 w-full rounded-full px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 bg-slate-950 text-white'
                  >
                    {hasEnoughPoints ? 'Redeem now' : 'Not enough points'}
                  </button>
                </div>
              );
            })}
          </div>
        </article>
      </section>

      <section className='rewards-entrance rewards-delay-5 mt-5 rounded-[24px] border border-slate-200 bg-white p-4 sm:p-5'>
        <div className='flex items-start justify-between gap-4'>
          <div>
            <h2 className='text-lg font-semibold text-slate-900'>Recent rewards activity</h2>
            <p className='text-sm text-slate-500'>Every loyalty event linked to your account appears here.</p>
          </div>
          <span className='rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700'>
            {summary.recentTransactions.length} events
          </span>
        </div>

        {summary.recentTransactions.length === 0 ? (
          <div className='mt-4 rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-500'>
            Your rewards activity will appear here after your first qualifying event.
          </div>
        ) : (
          <div className='mt-4 space-y-2.5'>
            {summary.recentTransactions.map((transaction, index) => (
              <div
                key={transaction._id}
                className='rewards-entrance rewards-hover-lift rounded-2xl border border-slate-200 p-3'
                style={{ animationDelay: `${Math.min(0.38 + index * 0.04, 0.62)}s` }}
              >
                <div className='flex items-start justify-between gap-3'>
                  <div>
                    <div className='flex flex-wrap items-center gap-2'>
                      <p className='text-sm font-semibold text-slate-900'>
                        {transactionLabels[transaction.type] || 'Rewards event'}
                      </p>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] ${
                          transactionTone[transaction.type] || 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {transaction.type.replaceAll('_', ' ')}
                      </span>
                    </div>
                    <p className='mt-1 text-xs text-slate-500'>{transaction.description}</p>
                    <p className='mt-2 text-[11px] uppercase tracking-[0.16em] text-slate-400'>
                      {formatDate(transaction.createdAt)}
                    </p>
                  </div>

                  <div className='text-right'>
                    <p className='text-lg font-semibold text-slate-900'>
                      {Number(transaction.points || 0) > 0 ? '+' : ''}
                      {transaction.points}
                    </p>
                    <p className='text-xs text-slate-500'>Balance {transaction.balanceAfter}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default Rewards;
