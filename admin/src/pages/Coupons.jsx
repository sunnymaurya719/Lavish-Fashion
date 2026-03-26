import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const formatDate = (value) => {
  if (!value) {
    return 'Open ended';
  }

  return new Date(value).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const toDateTimeLocalValue = (value) => {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const createEmptyFormState = () => ({
  code: '',
  description: '',
  discountType: 'percentage',
  discountValue: '10',
  minOrderAmount: '0',
  maxDiscountAmount: '',
  usageLimit: '',
  perUserLimit: '1',
  startsAt: '',
  endsAt: '',
  isActive: true,
});

const buildFormStateFromCoupon = (coupon) => ({
  code: coupon.code || '',
  description: coupon.description || '',
  discountType: coupon.discountType || 'percentage',
  discountValue: String(coupon.discountType === 'free_shipping' ? 0 : coupon.discountValue ?? 0),
  minOrderAmount: String(coupon.minOrderAmount ?? 0),
  maxDiscountAmount:
    coupon.maxDiscountAmount === null || coupon.maxDiscountAmount === undefined ? '' : String(coupon.maxDiscountAmount),
  usageLimit: coupon.usageLimit === null || coupon.usageLimit === undefined ? '' : String(coupon.usageLimit),
  perUserLimit: coupon.perUserLimit === null || coupon.perUserLimit === undefined ? '' : String(coupon.perUserLimit),
  startsAt: toDateTimeLocalValue(coupon.startsAt),
  endsAt: toDateTimeLocalValue(coupon.endsAt),
  isActive: Boolean(coupon.isActive),
});

const getLifecycleState = (coupon) => {
  const now = new Date();
  const startsAt = coupon.startsAt ? new Date(coupon.startsAt) : null;
  const endsAt = coupon.endsAt ? new Date(coupon.endsAt) : null;

  if (!coupon.isActive) {
    return 'paused';
  }

  if (startsAt && startsAt > now) {
    return 'scheduled';
  }

  if (endsAt && endsAt < now) {
    return 'expired';
  }

  return 'live';
};

const getDiscountLabel = (coupon) => {
  if (coupon.discountType === 'percentage') {
    return `${coupon.discountValue}% off`;
  }

  if (coupon.discountType === 'flat') {
    return `${formatCurrency(coupon.discountValue)} off`;
  }

  return 'Free shipping';
};

const Coupons = ({ token }) => {
  const [coupons, setCoupons] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedCouponId, setSelectedCouponId] = useState('');
  const [formMode, setFormMode] = useState('create');
  const [formData, setFormData] = useState(createEmptyFormState());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [statusLoadingId, setStatusLoadingId] = useState('');

  const fetchCoupons = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await axios.get(BACKEND_URL + '/api/coupon/admin', {
        headers: { token },
      });

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to fetch coupons');
        return;
      }

      setCoupons(response.data.coupons || []);
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchCoupons();
  }, [fetchCoupons]);

  const visibleCoupons = useMemo(() => {
    return coupons.filter((coupon) => {
      const lifecycleState = getLifecycleState(coupon);
      const haystack = `${coupon.code} ${coupon.description}`.toLowerCase();
      const matchesSearch = haystack.includes(search.toLowerCase().trim());

      if (!matchesSearch) {
        return false;
      }

      if (statusFilter !== 'all' && lifecycleState !== statusFilter) {
        return false;
      }

      return true;
    });
  }, [coupons, search, statusFilter]);

  const summaryCards = useMemo(() => {
    return [
      {
        label: 'Total coupons',
        value: coupons.length,
      },
      {
        label: 'Live',
        value: coupons.filter((coupon) => getLifecycleState(coupon) === 'live').length,
      },
      {
        label: 'Scheduled',
        value: coupons.filter((coupon) => getLifecycleState(coupon) === 'scheduled').length,
      },
      {
        label: 'Total redemptions',
        value: coupons.reduce((sum, coupon) => sum + Number(coupon.usageCount || 0), 0),
      },
    ];
  }, [coupons]);

  const setEditingCoupon = (coupon) => {
    setSelectedCouponId(coupon._id);
    setFormMode('edit');
    setFormData(buildFormStateFromCoupon(coupon));
  };

  const resetForm = () => {
    setSelectedCouponId('');
    setFormMode('create');
    setFormData(createEmptyFormState());
  };

  const buildPayload = () => ({
    code: formData.code,
    description: formData.description,
    discountType: formData.discountType,
    discountValue: formData.discountType === 'free_shipping' ? 0 : Number(formData.discountValue || 0),
    minOrderAmount: Number(formData.minOrderAmount || 0),
    maxDiscountAmount: formData.maxDiscountAmount === '' ? null : Number(formData.maxDiscountAmount),
    usageLimit: formData.usageLimit === '' ? null : Number(formData.usageLimit),
    perUserLimit: formData.perUserLimit === '' ? null : Number(formData.perUserLimit),
    startsAt: formData.startsAt || null,
    endsAt: formData.endsAt || null,
    isActive: formData.isActive,
  });

  const saveCoupon = async (event) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      const endpoint = formMode === 'edit' ? '/api/coupon/admin/update' : '/api/coupon/admin/create';
      const method = formMode === 'edit' ? 'put' : 'post';
      const payload = formMode === 'edit' ? { couponId: selectedCouponId, ...buildPayload() } : buildPayload();

      const response = await axios[method](BACKEND_URL + endpoint, payload, {
        headers: { token },
      });

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to save coupon');
        return;
      }

      toast.success(response.data.message || 'Coupon saved');
      await fetchCoupons();
      resetForm();
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const updateCouponStatus = async (coupon) => {
    setStatusLoadingId(coupon._id);

    try {
      const response = await axios.patch(
        BACKEND_URL + '/api/coupon/admin/status',
        { couponId: coupon._id, isActive: !coupon.isActive },
        { headers: { token } }
      );

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to update coupon status');
        return;
      }

      setCoupons((currentCoupons) =>
        currentCoupons.map((item) => (item._id === coupon._id ? { ...item, ...response.data.coupon } : item))
      );
      toast.success(response.data.message || 'Coupon updated');
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setStatusLoadingId('');
    }
  };

  return (
    <div className='flex flex-col gap-6'>
      <section className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
        <div className='flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between'>
          <div>
            <p className='text-lg font-semibold text-slate-900'>Promotion control center</p>
            <p className='text-sm text-slate-500'>
              Create launch offers, schedule campaign windows, and pause or reactivate coupons without leaving admin.
            </p>
          </div>

          <div className='flex flex-wrap gap-3'>
            <button
              type='button'
              onClick={fetchCoupons}
              className='rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700'
            >
              Refresh coupons
            </button>
            <button
              type='button'
              onClick={resetForm}
              className='rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white'
            >
              New coupon
            </button>
          </div>
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

      <section className='grid gap-6 xl:grid-cols-[0.95fr_1.35fr]'>
        <form onSubmit={saveCoupon} className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='flex items-center justify-between gap-4'>
            <div>
              <p className='text-lg font-semibold text-slate-900'>
                {formMode === 'edit' ? 'Edit coupon' : 'Create coupon'}
              </p>
              <p className='text-sm text-slate-500'>Every change here writes back to the coupon API.</p>
            </div>
            {formMode === 'edit' ? (
              <button
                type='button'
                onClick={resetForm}
                className='rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700'
              >
                Cancel edit
              </button>
            ) : null}
          </div>

          <div className='mt-5 grid gap-4'>
            <div className='grid gap-4 lg:grid-cols-2'>
              <div>
                <p className='mb-2 text-sm text-slate-600'>Coupon code</p>
                <input
                  value={formData.code}
                  onChange={(event) => setFormData((current) => ({ ...current, code: event.target.value.toUpperCase() }))}
                  className='w-full rounded-2xl border border-slate-300 px-4 py-3 uppercase'
                  type='text'
                  placeholder='WELCOME10'
                  maxLength='30'
                  required
                />
              </div>
              <div>
                <p className='mb-2 text-sm text-slate-600'>Discount type</p>
                <select
                  value={formData.discountType}
                  onChange={(event) =>
                    setFormData((current) => ({
                      ...current,
                      discountType: event.target.value,
                      discountValue: event.target.value === 'free_shipping' ? '0' : current.discountValue,
                    }))
                  }
                  className='w-full rounded-2xl border border-slate-300 bg-white px-4 py-3'
                >
                  <option value='percentage'>Percentage</option>
                  <option value='flat'>Flat amount</option>
                  <option value='free_shipping'>Free shipping</option>
                </select>
              </div>
            </div>

            <div>
              <p className='mb-2 text-sm text-slate-600'>Description</p>
              <input
                value={formData.description}
                onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))}
                className='w-full rounded-2xl border border-slate-300 px-4 py-3'
                type='text'
                placeholder='Launch incentive for first-time shoppers'
                maxLength='200'
              />
            </div>

            <div className='grid gap-4 lg:grid-cols-2'>
              <div>
                <p className='mb-2 text-sm text-slate-600'>
                  {formData.discountType === 'percentage' ? 'Discount percentage' : 'Discount value'}
                </p>
                <input
                  value={formData.discountValue}
                  onChange={(event) => setFormData((current) => ({ ...current, discountValue: event.target.value }))}
                  className='w-full rounded-2xl border border-slate-300 px-4 py-3'
                  type='number'
                  min='0'
                  step='0.01'
                  disabled={formData.discountType === 'free_shipping'}
                  required
                />
              </div>
              <div>
                <p className='mb-2 text-sm text-slate-600'>Minimum order amount</p>
                <input
                  value={formData.minOrderAmount}
                  onChange={(event) => setFormData((current) => ({ ...current, minOrderAmount: event.target.value }))}
                  className='w-full rounded-2xl border border-slate-300 px-4 py-3'
                  type='number'
                  min='0'
                  step='0.01'
                />
              </div>
            </div>

            <div className='grid gap-4 lg:grid-cols-3'>
              <div>
                <p className='mb-2 text-sm text-slate-600'>Max discount</p>
                <input
                  value={formData.maxDiscountAmount}
                  onChange={(event) => setFormData((current) => ({ ...current, maxDiscountAmount: event.target.value }))}
                  className='w-full rounded-2xl border border-slate-300 px-4 py-3'
                  type='number'
                  min='0'
                  step='0.01'
                  placeholder='Optional'
                />
              </div>
              <div>
                <p className='mb-2 text-sm text-slate-600'>Usage limit</p>
                <input
                  value={formData.usageLimit}
                  onChange={(event) => setFormData((current) => ({ ...current, usageLimit: event.target.value }))}
                  className='w-full rounded-2xl border border-slate-300 px-4 py-3'
                  type='number'
                  min='1'
                  step='1'
                  placeholder='Optional'
                />
              </div>
              <div>
                <p className='mb-2 text-sm text-slate-600'>Per user limit</p>
                <input
                  value={formData.perUserLimit}
                  onChange={(event) => setFormData((current) => ({ ...current, perUserLimit: event.target.value }))}
                  className='w-full rounded-2xl border border-slate-300 px-4 py-3'
                  type='number'
                  min='1'
                  step='1'
                />
              </div>
            </div>

            <div className='grid gap-4 lg:grid-cols-2'>
              <div>
                <p className='mb-2 text-sm text-slate-600'>Starts at</p>
                <input
                  value={formData.startsAt}
                  onChange={(event) => setFormData((current) => ({ ...current, startsAt: event.target.value }))}
                  className='w-full rounded-2xl border border-slate-300 px-4 py-3'
                  type='datetime-local'
                />
              </div>
              <div>
                <p className='mb-2 text-sm text-slate-600'>Ends at</p>
                <input
                  value={formData.endsAt}
                  onChange={(event) => setFormData((current) => ({ ...current, endsAt: event.target.value }))}
                  className='w-full rounded-2xl border border-slate-300 px-4 py-3'
                  type='datetime-local'
                />
              </div>
            </div>

            <label className='flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4'>
              <div>
                <p className='font-medium text-slate-900'>Coupon active</p>
                <p className='text-sm text-slate-500'>Turn this off to pause redemption without deleting the campaign.</p>
              </div>
              <input
                checked={formData.isActive}
                onChange={(event) => setFormData((current) => ({ ...current, isActive: event.target.checked }))}
                type='checkbox'
                className='h-5 w-5'
              />
            </label>
          </div>

          <button
            type='submit'
            disabled={isSaving}
            className='mt-6 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-60'
          >
            {isSaving ? 'Saving coupon...' : formMode === 'edit' ? 'Update coupon' : 'Create coupon'}
          </button>
        </form>

        <div className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='grid gap-3 lg:grid-cols-[1.4fr_0.8fr]'>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className='rounded-2xl border border-slate-300 px-4 py-3'
              type='text'
              placeholder='Search by coupon code or description'
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className='rounded-2xl border border-slate-300 bg-white px-4 py-3'
            >
              <option value='all'>All states</option>
              <option value='live'>Live</option>
              <option value='scheduled'>Scheduled</option>
              <option value='paused'>Paused</option>
              <option value='expired'>Expired</option>
            </select>
          </div>

          <div className='mt-5 space-y-4'>
            {isLoading ? (
              <div className='ui-loading-state'>Loading coupons...</div>
            ) : visibleCoupons.length === 0 ? (
              <div className='rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500'>
                No coupons matched the current filters.
              </div>
            ) : (
              visibleCoupons.map((coupon) => {
                const lifecycleState = getLifecycleState(coupon);
                const isEditing = selectedCouponId === coupon._id;

                return (
                  <article
                    key={coupon._id}
                    className={`rounded-[28px] border p-5 shadow-sm transition ${
                      isEditing ? 'border-slate-900 bg-slate-950 text-white' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
                      <div>
                        <div className='flex flex-wrap items-center gap-2'>
                          <p className={`text-xl font-semibold ${isEditing ? 'text-white' : 'text-slate-900'}`}>{coupon.code}</p>
                          <span
                            className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${
                              isEditing ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {lifecycleState}
                          </span>
                        </div>
                        <p className={`mt-2 text-sm ${isEditing ? 'text-slate-300' : 'text-slate-500'}`}>
                          {coupon.description || 'No description provided'}
                        </p>
                      </div>

                      <div className='flex flex-wrap gap-3'>
                        <button
                          type='button'
                          onClick={() => setEditingCoupon(coupon)}
                          className={`rounded-2xl px-4 py-3 text-sm font-medium ${
                            isEditing ? 'bg-white text-slate-950' : 'bg-slate-950 text-white'
                          }`}
                        >
                          Edit
                        </button>
                        <button
                          type='button'
                          onClick={() => updateCouponStatus(coupon)}
                          disabled={statusLoadingId === coupon._id}
                          className={`rounded-2xl border px-4 py-3 text-sm font-medium ${
                            isEditing ? 'border-white/20 text-white' : 'border-slate-300 text-slate-700'
                          } disabled:opacity-60`}
                        >
                          {statusLoadingId === coupon._id ? 'Updating...' : coupon.isActive ? 'Pause' : 'Activate'}
                        </button>
                      </div>
                    </div>

                    <div className='mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
                      <div className={`rounded-2xl px-4 py-3 ${isEditing ? 'bg-white/8' : 'bg-slate-50'}`}>
                        <p className={`text-xs uppercase tracking-[0.2em] ${isEditing ? 'text-slate-300' : 'text-slate-400'}`}>Offer</p>
                        <p className={`mt-2 text-lg font-semibold ${isEditing ? 'text-white' : 'text-slate-900'}`}>
                          {getDiscountLabel(coupon)}
                        </p>
                      </div>
                      <div className={`rounded-2xl px-4 py-3 ${isEditing ? 'bg-white/8' : 'bg-slate-50'}`}>
                        <p className={`text-xs uppercase tracking-[0.2em] ${isEditing ? 'text-slate-300' : 'text-slate-400'}`}>Usage</p>
                        <p className={`mt-2 text-lg font-semibold ${isEditing ? 'text-white' : 'text-slate-900'}`}>
                          {coupon.usageCount}
                          {coupon.usageLimit ? ` / ${coupon.usageLimit}` : ''}
                        </p>
                      </div>
                      <div className={`rounded-2xl px-4 py-3 ${isEditing ? 'bg-white/8' : 'bg-slate-50'}`}>
                        <p className={`text-xs uppercase tracking-[0.2em] ${isEditing ? 'text-slate-300' : 'text-slate-400'}`}>Minimum order</p>
                        <p className={`mt-2 text-lg font-semibold ${isEditing ? 'text-white' : 'text-slate-900'}`}>
                          {formatCurrency(coupon.minOrderAmount)}
                        </p>
                      </div>
                      <div className={`rounded-2xl px-4 py-3 ${isEditing ? 'bg-white/8' : 'bg-slate-50'}`}>
                        <p className={`text-xs uppercase tracking-[0.2em] ${isEditing ? 'text-slate-300' : 'text-slate-400'}`}>Per user</p>
                        <p className={`mt-2 text-lg font-semibold ${isEditing ? 'text-white' : 'text-slate-900'}`}>
                          {coupon.perUserLimit || 'Unlimited'}
                        </p>
                      </div>
                    </div>

                    <div className='mt-4 grid gap-3 sm:grid-cols-2'>
                      <div className={`rounded-2xl px-4 py-3 ${isEditing ? 'bg-white/8' : 'bg-slate-50'}`}>
                        <p className={`text-xs uppercase tracking-[0.2em] ${isEditing ? 'text-slate-300' : 'text-slate-400'}`}>Starts</p>
                        <p className={`mt-2 font-medium ${isEditing ? 'text-white' : 'text-slate-900'}`}>
                          {formatDate(coupon.startsAt)}
                        </p>
                      </div>
                      <div className={`rounded-2xl px-4 py-3 ${isEditing ? 'bg-white/8' : 'bg-slate-50'}`}>
                        <p className={`text-xs uppercase tracking-[0.2em] ${isEditing ? 'text-slate-300' : 'text-slate-400'}`}>Ends</p>
                        <p className={`mt-2 font-medium ${isEditing ? 'text-white' : 'text-slate-900'}`}>
                          {formatDate(coupon.endsAt)}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default Coupons;
