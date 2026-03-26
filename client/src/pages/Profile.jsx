import React, { useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ShopContext } from '../context/ShopContext';

const defaultMarketingPreferences = {
  emailSubscribed: true,
  promotionalCampaigns: true,
  loyaltyUpdates: true,
  reviewReminders: true,
};

const formatDate = (value) => {
  if (!value) {
    return 'Recently joined';
  }

  return new Date(value).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const preferenceItems = [
  {
    key: 'emailSubscribed',
    title: 'Email subscription',
    description: 'Master switch for account email communication.',
  },
  {
    key: 'promotionalCampaigns',
    title: 'Promotional campaigns',
    description: 'Launch offers, seasonal drops, and promotion broadcasts.',
  },
  {
    key: 'loyaltyUpdates',
    title: 'Loyalty updates',
    description: 'Rewards balance changes, referral unlocks, and milestone emails.',
  },
  {
    key: 'reviewReminders',
    title: 'Review reminders',
    description: 'Post-delivery reminders to leave verified product reviews.',
  },
];

const Profile = () => {
  const { BACKEND_URL, getWishlistCount, navigate, toast, token } = useContext(ShopContext);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
  });
  const [profileMeta, setProfileMeta] = useState({
    referralCode: '',
    loyaltyPoints: 0,
    availableLoyaltyPoints: 0,
    reservedLoyaltyPoints: 0,
    lifetimeLoyaltyPoints: 0,
    loyaltyTier: 'Bronze',
    successfulReferralCount: 0,
    createdAt: null,
  });
  const [marketingPreferences, setMarketingPreferences] = useState(defaultMarketingPreferences);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    const fetchProfile = async () => {
      setIsLoading(true);

      try {
        const response = await axios.get(BACKEND_URL + '/api/user/profile', { headers: { token } });

        if (!response.data.success) {
          toast.error(response.data.message || 'Unable to load profile');
          return;
        }

        const profile = response.data.profile || {};
        setFormData({
          name: profile.name || '',
          email: profile.email || '',
          phone: profile.phone || '',
        });
        setProfileMeta({
          referralCode: profile.referralCode || '',
          loyaltyPoints: Number(profile.loyaltyPoints || 0),
          availableLoyaltyPoints: Number(profile.availableLoyaltyPoints || profile.loyaltyPoints || 0),
          reservedLoyaltyPoints: Number(profile.reservedLoyaltyPoints || 0),
          lifetimeLoyaltyPoints: Number(profile.lifetimeLoyaltyPoints || 0),
          loyaltyTier: profile.loyaltyTier || 'Bronze',
          successfulReferralCount: Number(profile.successfulReferralCount || 0),
          createdAt: profile.createdAt || null,
        });
        setMarketingPreferences({
          ...defaultMarketingPreferences,
          ...(profile.marketingPreferences || {}),
        });
      } catch (error) {
        toast.error(error?.response?.data?.message || error.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProfile();
  }, [BACKEND_URL, toast, token]);

  const summaryCards = useMemo(
    () => [
      {
        label: 'Tier',
        value: profileMeta.loyaltyTier,
      },
      {
        label: 'Available points',
        value: profileMeta.availableLoyaltyPoints,
      },
      {
        label: 'Reserved points',
        value: profileMeta.reservedLoyaltyPoints,
      },
      {
        label: 'Lifetime points',
        value: profileMeta.lifetimeLoyaltyPoints,
      },
    ],
    [profileMeta]
  );
  const avatarInitial = (formData.name || 'L').trim().charAt(0).toUpperCase();

  const onChangeHandler = (event) => {
    const { name, value } = event.target;
    setFormData((currentData) => ({ ...currentData, [name]: value }));
  };

  const saveProfile = async (event) => {
    event.preventDefault();

    if (isSavingProfile) {
      return;
    }

    setIsSavingProfile(true);

    try {
      const response = await axios.put(
        BACKEND_URL + '/api/user/profile',
        {
          name: formData.name,
          phone: formData.phone,
        },
        { headers: { token } }
      );

      if (!response.data.success) {
        toast.error(response.data.message || 'Unable to update profile');
        return;
      }

      const profile = response.data.profile || {};
      setFormData((currentData) => ({
        ...currentData,
        name: profile.name || '',
        phone: profile.phone || '',
      }));
      setProfileMeta((currentMeta) => ({
        ...currentMeta,
        referralCode: profile.referralCode || currentMeta.referralCode,
        loyaltyPoints: Number(profile.loyaltyPoints || currentMeta.loyaltyPoints || 0),
        availableLoyaltyPoints: Number(
          profile.availableLoyaltyPoints || profile.loyaltyPoints || currentMeta.availableLoyaltyPoints || 0
        ),
        reservedLoyaltyPoints: Number(profile.reservedLoyaltyPoints || currentMeta.reservedLoyaltyPoints || 0),
        lifetimeLoyaltyPoints: Number(profile.lifetimeLoyaltyPoints || currentMeta.lifetimeLoyaltyPoints || 0),
        loyaltyTier: profile.loyaltyTier || currentMeta.loyaltyTier,
        successfulReferralCount: Number(
          profile.successfulReferralCount || currentMeta.successfulReferralCount || 0
        ),
      }));
      toast.success('Profile updated successfully');
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const saveMarketingPreferences = async () => {
    if (isSavingPreferences) {
      return;
    }

    setIsSavingPreferences(true);

    try {
      const response = await axios.patch(
        BACKEND_URL + '/api/user/marketing-preferences',
        marketingPreferences,
        { headers: { token } }
      );

      if (!response.data.success) {
        toast.error(response.data.message || 'Unable to update preferences');
        return;
      }

      setMarketingPreferences({
        ...defaultMarketingPreferences,
        ...(response.data.marketingPreferences || {}),
      });
      toast.success('Preferences updated successfully');
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsSavingPreferences(false);
    }
  };

  const copyReferralCode = async () => {
    if (!profileMeta.referralCode) {
      toast.info('Referral code is still being prepared');
      return;
    }

    try {
      await navigator.clipboard.writeText(profileMeta.referralCode);
      toast.success('Referral code copied');
    } catch {
      toast.info(`Referral code: ${profileMeta.referralCode}`);
    }
  };

  if (!token) {
    return (
      <div className='min-h-[70vh] flex flex-col items-center justify-center text-center px-4'>
        <h2 className='text-2xl font-semibold mb-2'>Login Required</h2>
        <p className='text-gray-600 mb-6'>Please login to view and update your profile.</p>
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
      <div className='profile-shell pt-6 sm:pt-8 space-y-4 sm:space-y-6'>
        <div className='profile-entrance flex items-center gap-4 px-1'>
          <div className='lf-shimmer h-14 w-14 rounded-full'></div>
          <div className='space-y-2'>
            <div className='lf-shimmer h-9 w-40 rounded-xl'></div>
            <div className='lf-shimmer h-4 w-32 rounded-full'></div>
            <div className='lf-shimmer h-3 w-44 rounded-full'></div>
          </div>
        </div>

        <div className='profile-entrance profile-delay-1 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]'>
          <div className='rounded-[28px] bg-white p-4 sm:p-6 shadow-[0_10px_30px_rgba(15,23,42,0.06)] space-y-4'>
            <div className='lf-shimmer h-8 w-48 rounded-xl'></div>
            <div className='lf-shimmer h-4 w-64 rounded-full'></div>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='lf-shimmer h-14 rounded-xl'></div>
              <div className='lf-shimmer h-14 rounded-xl'></div>
            </div>
            <div className='lf-shimmer h-14 rounded-xl'></div>
            <div className='lf-shimmer h-12 rounded-full'></div>
          </div>

          <div className='space-y-4'>
            <div className='rounded-[28px] bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] space-y-4'>
              <div className='lf-shimmer h-4 w-36 rounded-full'></div>
              <div className='lf-shimmer h-10 w-40 rounded-xl'></div>
              <div className='grid grid-cols-2 gap-3'>
                <div className='lf-shimmer h-20 rounded-2xl'></div>
                <div className='lf-shimmer h-20 rounded-2xl'></div>
                <div className='lf-shimmer h-20 rounded-2xl'></div>
                <div className='lf-shimmer h-20 rounded-2xl'></div>
              </div>
            </div>

            <div className='rounded-[28px] bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)]'>
              <div className='lf-shimmer h-4 w-28 rounded-full'></div>
              <div className='lf-shimmer mt-3 h-16 rounded-2xl'></div>
            </div>
          </div>
        </div>

        <div className='profile-entrance profile-delay-2 rounded-[28px] bg-white p-4 sm:p-6 shadow-[0_10px_30px_rgba(15,23,42,0.06)] space-y-4'>
          <div className='lf-shimmer h-8 w-72 rounded-xl'></div>
          <div className='lf-shimmer h-4 w-56 rounded-full'></div>
          <div className='lf-shimmer h-16 rounded-2xl'></div>
          <div className='lf-shimmer h-16 rounded-2xl'></div>
          <div className='lf-shimmer h-12 rounded-full'></div>
        </div>
      </div>
    );
  }

  return (
    <div className='profile-shell pt-6 sm:pt-8 space-y-4 sm:space-y-6'>
      <header className='profile-entrance flex items-center gap-4 px-1'>
        <div className='flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xl font-semibold text-white'>
          {avatarInitial}
        </div>
        <div>
          <h1 className='text-[1.9rem] max-[380px]:text-[1.65rem] sm:text-[2.3rem] font-semibold tracking-[-0.015em] text-[#111] leading-none'>
            Profile
          </h1>
          <p className='mt-1 text-sm text-[#777]'>Manage your account</p>
          <p className='mt-1 text-xs text-slate-500'>{formData.email}</p>
        </div>
      </header>

      <section className='profile-entrance profile-delay-1 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]'>
        <form onSubmit={saveProfile} className='rounded-[28px] bg-white p-4 sm:p-6 shadow-[0_10px_30px_rgba(15,23,42,0.06)]'>
          <div>
            <p className='text-[1.45rem] max-[380px]:text-[1.3rem] sm:text-2xl font-semibold text-slate-900'>Account details</p>
            <p className='mt-2 text-sm text-slate-500'>Keep your personal and contact information current.</p>
          </div>

          <div className='mt-5 grid gap-4 sm:grid-cols-2'>
            <div>
              <p className='mb-2 text-sm text-slate-600'>Full name</p>
              <input
                name='name'
                value={formData.name}
                onChange={onChangeHandler}
                className='w-full rounded-xl bg-[#f5f5f5] px-4 py-3 text-[#111] outline-none'
                type='text'
                required
              />
            </div>
            <div>
              <p className='mb-2 text-sm text-slate-600'>Phone number</p>
              <input
                name='phone'
                value={formData.phone}
                onChange={onChangeHandler}
                className='w-full rounded-xl bg-[#f5f5f5] px-4 py-3 text-[#111] outline-none'
                type='tel'
                placeholder='Optional'
              />
            </div>
          </div>

          <div className='mt-4'>
            <p className='mb-2 text-sm text-slate-600'>Email address</p>
            <input
              value={formData.email}
              className='w-full rounded-xl bg-slate-100 px-4 py-3 text-slate-500'
              type='email'
              disabled
            />
            <p className='mt-2 text-xs text-slate-500'>Email changes are disabled in this version.</p>
          </div>

          <button
            type='submit'
            disabled={isSavingProfile}
            className='mt-5 w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-medium uppercase tracking-[0.14em] text-white disabled:opacity-60'
          >
            {isSavingProfile ? 'Saving...' : 'Save profile'}
          </button>
        </form>

        <div className='space-y-4'>
          <div className='rounded-[28px] bg-gradient-to-br from-[#020617] via-[#0f172a] to-[#1e293b] p-5 text-white shadow-[0_14px_36px_rgba(2,6,23,0.25)]'>
            <p className='text-[11px] uppercase tracking-[0.24em] text-slate-300'>Account summary</p>
            <p className='mt-3 text-[2rem] max-[380px]:text-[1.75rem] sm:text-3xl font-semibold'>{formData.name || 'Lavish member'}</p>
            <p className='mt-2 text-sm text-slate-300'>Member since {formatDate(profileMeta.createdAt)}</p>

            <div className='mt-4 grid grid-cols-2 gap-3'>
              {summaryCards.map((card) => (
                <div key={card.label} className='rounded-2xl bg-white/10 px-3 py-3'>
                  <p className='text-[10px] uppercase tracking-[0.18em] text-slate-300'>{card.label}</p>
                  <p className='mt-1 text-2xl font-semibold text-white'>{card.value}</p>
                </div>
              ))}
            </div>

            <div className='mt-4 grid grid-cols-2 gap-3'>
              <button
                type='button'
                onClick={() => navigate('/orders')}
                className='rounded-full bg-white px-4 py-3 text-sm font-medium text-slate-950'
              >
                View orders
              </button>
              <button
                type='button'
                onClick={() => navigate('/rewards')}
                className='rounded-full border border-white/35 px-4 py-3 text-sm font-medium text-white'
              >
                Rewards Hub
              </button>
            </div>
          </div>

          <div className='rounded-[28px] bg-white p-4 sm:p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)]'>
            <div className='flex items-start justify-between gap-3'>
              <div>
                <p className='text-xl font-semibold text-slate-900'>Referral code</p>
                <p className='mt-1 text-sm text-slate-500'>Share with new shoppers to unlock rewards.</p>
              </div>
              <button
                type='button'
                onClick={copyReferralCode}
                className='rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700'
              >
                Copy
              </button>
            </div>

            <div className='mt-4 rounded-2xl bg-slate-950 px-4 py-4 text-white'>
              <p className='text-[10px] uppercase tracking-[0.22em] text-slate-300'>Your code</p>
              <p className='mt-2 text-4xl font-semibold tracking-[0.18em]'>{profileMeta.referralCode || 'PREPARING'}</p>
            </div>

            <div className='mt-3 flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600'>
              <span>Wishlist items</span>
              <span className='font-semibold text-slate-900'>{getWishlistCount()}</span>
            </div>
          </div>
        </div>
      </section>

      <section className='profile-entrance profile-delay-2 rounded-[28px] bg-white p-4 sm:p-6 shadow-[0_10px_30px_rgba(15,23,42,0.06)]'>
        <div>
          <p className='text-[1.45rem] max-[380px]:text-[1.3rem] sm:text-2xl font-semibold text-slate-900'>Email and automation preferences</p>
          <p className='mt-2 text-sm text-slate-500'>Control campaign, rewards, and review update notifications.</p>
        </div>

        <div className='mt-4 divide-y divide-slate-100'>
          {preferenceItems.map((preference) => {
            const enabled = Boolean(marketingPreferences[preference.key]);

            return (
              <div key={preference.key} className='py-4 flex items-center justify-between gap-4'>
                <div>
                  <p className='text-base sm:text-lg font-semibold text-slate-900'>{preference.title}</p>
                  <p className='mt-1 text-sm text-slate-500'>{preference.description}</p>
                </div>

                <button
                  type='button'
                  role='switch'
                  aria-checked={enabled}
                  onClick={() =>
                    setMarketingPreferences((current) => ({
                      ...current,
                      [preference.key]: !enabled,
                    }))
                  }
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${
                    enabled ? 'bg-slate-900' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                      enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  ></span>
                </button>
              </div>
            );
          })}
        </div>

        <button
          type='button'
          onClick={saveMarketingPreferences}
          disabled={isSavingPreferences}
          className='mt-4 w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-medium uppercase tracking-[0.14em] text-white disabled:opacity-60'
        >
          {isSavingPreferences ? 'Saving...' : 'Save preferences'}
        </button>
      </section>
    </div>
  );
};

export default Profile;
