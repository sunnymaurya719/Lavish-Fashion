import React, { useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Title from '../components/Title';
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

const Rewards = () => {
  const { BACKEND_URL, navigate, toast, token } = useContext(ShopContext);
  const [summary, setSummary] = useState(defaultSummary);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    const fetchRewardsSummary = async () => {
      setIsLoading(true);

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
      }
    };

    fetchRewardsSummary();
  }, [BACKEND_URL, toast, token]);

  const progressPercentage = useMemo(() => {
    if (!summary.nextTierThreshold) {
      return 100;
    }

    const completed = Math.max(
      0,
      Number(summary.nextTierThreshold || 0) - Number(summary.pointsToNextTier || 0)
    );
    return Math.min(100, Math.round((completed / Number(summary.nextTierThreshold || 1)) * 100));
  }, [summary.nextTierThreshold, summary.pointsToNextTier]);

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

  if (!token) {
    return (
      <div className='min-h-[70vh] flex flex-col items-center justify-center text-center px-4 border-t'>
        <h2 className='text-2xl font-semibold mb-2'>Login Required</h2>
        <p className='text-gray-600 mb-6'>Please login to unlock your rewards balance, referral code, and activity history.</p>
        <button
          onClick={() => navigate('/login')}
          className='bg-black text-white px-8 py-3 text-sm rounded hover:bg-gray-800 transition'
        >
          LOGIN TO CONTINUE
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className='border-t pt-16'>
        <p className='text-sm text-slate-500'>Loading your rewards hub...</p>
      </div>
    );
  }

  return (
    <div className='border-t pt-12'>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <Title text1='REWARDS' text2='HUB' />
          <p className='mt-3 max-w-2xl text-sm text-slate-500'>
            Track loyalty progress, share your referral code, and see every reward event tied to your account.
          </p>
        </div>

        <button
          type='button'
          onClick={copyReferralCode}
          className='rounded-2xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700'
        >
          Copy referral code
        </button>
      </div>

      <section className='mt-8 rounded-[36px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-8 text-white shadow-lg'>
        <div className='grid gap-6 xl:grid-cols-[1.2fr_0.8fr]'>
          <div>
            <p className='text-xs uppercase tracking-[0.35em] text-slate-300'>Loyalty status</p>
            <h2 className='mt-3 text-3xl font-semibold'>{summary.currentTier} member</h2>
            <p className='mt-3 max-w-xl text-sm text-slate-300'>
              You currently have {summary.availableLoyaltyPoints} available points, {summary.reservedLoyaltyPoints} reserved
              points, and {summary.lifetimeLoyaltyPoints} lifetime points.
            </p>

            <div className='mt-6'>
              <div className='mb-2 flex items-center justify-between text-sm text-slate-300'>
                <span>Progress to {summary.nextTier || 'top tier'}</span>
                <span>
                  {summary.nextTier ? `${summary.pointsToNextTier} points to go` : 'Top tier unlocked'}
                </span>
              </div>
              <div className='h-3 overflow-hidden rounded-full bg-white/10'>
                <div
                  className='h-full rounded-full bg-gradient-to-r from-amber-300 via-emerald-300 to-sky-300'
                  style={{ width: `${progressPercentage}%` }}
                ></div>
              </div>
            </div>
          </div>

          <div className='rounded-[28px] border border-white/10 bg-white/5 p-5'>
            <p className='text-xs uppercase tracking-[0.3em] text-slate-300'>Referral code</p>
            <p className='mt-3 text-3xl font-semibold tracking-[0.22em]'>{summary.referralCode || 'PREPARING'}</p>
            <p className='mt-3 text-sm text-slate-300'>
              Invite friends to Lavish Fashion. Referral bonuses unlock after their first delivered order.
            </p>
          </div>
        </div>
      </section>

      <section className='mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5'>
        <article className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
          <p className='text-sm text-slate-500'>Available points</p>
          <p className='mt-3 text-3xl font-semibold text-slate-900'>{summary.availableLoyaltyPoints}</p>
        </article>
        <article className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
          <p className='text-sm text-slate-500'>Reserved points</p>
          <p className='mt-3 text-3xl font-semibold text-slate-900'>{summary.reservedLoyaltyPoints}</p>
        </article>
        <article className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
          <p className='text-sm text-slate-500'>Lifetime points</p>
          <p className='mt-3 text-3xl font-semibold text-slate-900'>{summary.lifetimeLoyaltyPoints}</p>
        </article>
        <article className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
          <p className='text-sm text-slate-500'>Successful referrals</p>
          <p className='mt-3 text-3xl font-semibold text-slate-900'>{summary.successfulReferralCount}</p>
        </article>
        <article className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
          <p className='text-sm text-slate-500'>Pending referral unlocks</p>
          <p className='mt-3 text-3xl font-semibold text-slate-900'>{summary.pendingReferralCount}</p>
        </article>
      </section>

      <section className='mt-8 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]'>
        <article className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          <p className='text-lg font-semibold text-slate-900'>How rewards grow</p>
            <div className='mt-5 space-y-4 text-sm text-slate-600'>
              <div className='rounded-2xl bg-slate-50 px-4 py-4'>
                Delivered orders award loyalty points automatically after fulfillment is confirmed.
              </div>
              <div className='rounded-2xl bg-slate-50 px-4 py-4'>
                Redeemed points are reserved at checkout and converted into a finalized deduction once payment or delivery is confirmed.
              </div>
              <div className='rounded-2xl bg-slate-50 px-4 py-4'>
                Referral rewards activate when the invited customer completes their first delivered order.
              </div>
            <div className='rounded-2xl bg-slate-50 px-4 py-4'>
              Published verified reviews can earn extra points once approved by the admin team.
            </div>
          </div>
        </article>

        <article className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='flex items-center justify-between gap-4'>
            <div>
              <p className='text-lg font-semibold text-slate-900'>Recent rewards activity</p>
              <p className='text-sm text-slate-500'>Every points event on your account is tracked here.</p>
            </div>
          </div>

          {summary.recentTransactions.length === 0 ? (
            <div className='mt-5 rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500'>
              Your rewards activity will appear here after your first qualifying event.
            </div>
          ) : (
            <div className='mt-5 space-y-3'>
              {summary.recentTransactions.map((transaction) => (
                <div key={transaction._id} className='rounded-[28px] border border-slate-200 p-4'>
                  <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
                    <div>
                      <div className='flex flex-wrap items-center gap-2'>
                        <p className='font-semibold text-slate-900'>
                          {transactionLabels[transaction.type] || 'Rewards event'}
                        </p>
                        <span
                          className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${
                            transactionTone[transaction.type] || 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {transaction.type.replaceAll('_', ' ')}
                        </span>
                      </div>
                      <p className='mt-2 text-sm text-slate-500'>{transaction.description}</p>
                    </div>

                    <div className='text-right'>
                      <p className='text-xl font-semibold text-slate-900'>
                        {Number(transaction.points || 0) > 0 ? '+' : ''}
                        {transaction.points}
                      </p>
                      <p className='text-sm text-slate-500'>Balance {transaction.balanceAfter}</p>
                    </div>
                  </div>

                  <p className='mt-3 text-xs uppercase tracking-[0.2em] text-slate-400'>
                    {formatDate(transaction.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </div>
  );
};

export default Rewards;
