import React, { useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Title from '../components/Title';
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
        label: 'Successful referrals',
        value: profileMeta.successfulReferralCount,
      },
    ],
    [profileMeta]
  );

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
      <div className='min-h-[70vh] flex flex-col items-center justify-center text-center px-4 border-t'>
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
      <div className='border-t pt-16'>
        <p className='text-sm text-gray-500'>Loading your profile...</p>
      </div>
    );
  }

  return (
    <div className='border-t pt-12'>
      <div className='mb-8'>
        <Title text1='MY' text2='PROFILE' />
      </div>

      <section className='grid gap-6 xl:grid-cols-[1.1fr_0.9fr]'>
        <form onSubmit={saveProfile} className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='flex items-start justify-between gap-4'>
            <div>
              <p className='text-lg font-semibold text-slate-900'>Account details</p>
              <p className='text-sm text-slate-500'>Keep your personal information and contact details current.</p>
            </div>
            <button
              type='submit'
              disabled={isSavingProfile}
              className='rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-60'
            >
              {isSavingProfile ? 'Saving...' : 'Save profile'}
            </button>
          </div>

          <div className='mt-6 grid gap-4 sm:grid-cols-2'>
            <div>
              <p className='mb-2 text-sm text-slate-600'>Full name</p>
              <input
                name='name'
                value={formData.name}
                onChange={onChangeHandler}
                className='w-full rounded-2xl border border-slate-300 px-4 py-3'
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
                className='w-full rounded-2xl border border-slate-300 px-4 py-3'
                type='tel'
                placeholder='Optional'
              />
            </div>
          </div>

          <div className='mt-4'>
            <p className='mb-2 text-sm text-slate-600'>Email address</p>
            <input
              value={formData.email}
              className='w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-500'
              type='email'
              disabled
            />
            <p className='mt-2 text-xs text-slate-500'>Email changes are disabled in this version.</p>
          </div>
        </form>

        <div className='space-y-6'>
          <div className='rounded-[32px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-6 text-white shadow-lg'>
            <p className='text-xs uppercase tracking-[0.3em] text-slate-300'>Account summary</p>
            <p className='mt-3 text-2xl font-semibold'>{formData.name || 'Lavish member'}</p>
            <p className='mt-2 text-sm text-slate-300'>Member since {formatDate(profileMeta.createdAt)}</p>
            <p className='mt-2 text-sm text-slate-300'>
              {profileMeta.availableLoyaltyPoints} points are ready to redeem and {profileMeta.reservedLoyaltyPoints} are
              currently tied to open checkouts.
            </p>

            <div className='mt-6 grid grid-cols-2 gap-3'>
              {summaryCards.map((card) => (
                <div key={card.label} className='rounded-2xl bg-white/8 px-4 py-4'>
                  <p className='text-xs uppercase tracking-[0.2em] text-slate-300'>{card.label}</p>
                  <p className='mt-2 text-2xl font-semibold text-white'>{card.value}</p>
                </div>
              ))}
            </div>

            <div className='mt-4 rounded-2xl bg-white/8 px-4 py-4'>
              <p className='text-xs uppercase tracking-[0.2em] text-slate-300'>Lifetime points</p>
              <p className='mt-2 text-2xl font-semibold text-white'>{profileMeta.lifetimeLoyaltyPoints}</p>
            </div>

            <div className='mt-5 grid gap-3 sm:grid-cols-2'>
              <button
                type='button'
                onClick={() => navigate('/orders')}
                className='rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-950'
              >
                View orders
              </button>
              <button
                type='button'
                onClick={() => navigate('/rewards')}
                className='rounded-2xl border border-white/15 px-4 py-3 text-sm font-medium text-white'
              >
                Open rewards hub
              </button>
            </div>
          </div>

          <div className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
            <div className='flex items-start justify-between gap-4'>
              <div>
                <p className='text-lg font-semibold text-slate-900'>Referral code</p>
                <p className='text-sm text-slate-500'>Share this code with new shoppers to unlock referral rewards.</p>
              </div>
              <button
                type='button'
                onClick={copyReferralCode}
                className='rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700'
              >
                Copy
              </button>
            </div>

            <div className='mt-5 rounded-[28px] bg-slate-950 px-5 py-5 text-white'>
              <p className='text-xs uppercase tracking-[0.3em] text-slate-300'>Your code</p>
              <p className='mt-3 text-3xl font-semibold tracking-[0.22em]'>{profileMeta.referralCode || 'PREPARING'}</p>
            </div>

            <div className='mt-5 flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600'>
              <span>Wishlist items</span>
              <span className='font-semibold text-slate-900'>{getWishlistCount()}</span>
            </div>
          </div>
        </div>
      </section>

      <section className='mt-8 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
        <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
          <div>
            <p className='text-lg font-semibold text-slate-900'>Email and automation preferences</p>
            <p className='text-sm text-slate-500'>
              Control which updates you receive for campaigns, rewards, and review follow-ups.
            </p>
          </div>
          <button
            type='button'
            onClick={saveMarketingPreferences}
            disabled={isSavingPreferences}
            className='rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-60'
          >
            {isSavingPreferences ? 'Saving...' : 'Save preferences'}
          </button>
        </div>

        <div className='mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
          {[
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
          ].map((preference) => (
            <label
              key={preference.key}
              className='flex cursor-pointer flex-col justify-between rounded-[28px] border border-slate-200 bg-slate-50 p-5'
            >
              <div>
                <p className='text-base font-semibold text-slate-900'>{preference.title}</p>
                <p className='mt-2 text-sm text-slate-500'>{preference.description}</p>
              </div>

              <div className='mt-5 flex items-center justify-between'>
                <span className='text-sm font-medium text-slate-600'>
                  {marketingPreferences[preference.key] ? 'Enabled' : 'Disabled'}
                </span>
                <input
                  checked={Boolean(marketingPreferences[preference.key])}
                  onChange={(event) =>
                    setMarketingPreferences((current) => ({
                      ...current,
                      [preference.key]: event.target.checked,
                    }))
                  }
                  type='checkbox'
                  className='h-5 w-5'
                />
              </div>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Profile;
