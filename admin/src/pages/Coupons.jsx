import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';
import {
  PageHeader,
  MetricGrid,
  MetricCard,
  Toolbar,
  Tabs,
  DataTable,
  ConfirmDialog,
  StatusBadge,
  Drawer,
  formatDate,
  formatMoney,
} from '../components/ui';
import {
  useAdminQuery,
  useDebouncedValue,
  useTableSelection,
  usePersistedState,
} from '../hooks';

/* ── helpers ───────────────────────────────────────────── */

const toDateTimeLocalValue = (value) => {
  if (!value) return '';
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
    coupon.maxDiscountAmount == null ? '' : String(coupon.maxDiscountAmount),
  usageLimit: coupon.usageLimit == null ? '' : String(coupon.usageLimit),
  perUserLimit: coupon.perUserLimit == null ? '' : String(coupon.perUserLimit),
  startsAt: toDateTimeLocalValue(coupon.startsAt),
  endsAt: toDateTimeLocalValue(coupon.endsAt),
  isActive: Boolean(coupon.isActive),
});

const getLifecycleState = (coupon) => {
  const now = new Date();
  if (!coupon.isActive) return 'paused';
  if (coupon.startsAt && new Date(coupon.startsAt) > now) return 'scheduled';
  if (coupon.endsAt && new Date(coupon.endsAt) < now) return 'expired';
  return 'live';
};

const getDiscountLabel = (coupon) => {
  if (coupon.discountType === 'percentage') return `${coupon.discountValue}% off`;
  if (coupon.discountType === 'flat') return formatMoney(coupon.discountValue) + ' off';
  return 'Free shipping';
};

const LIFECYCLE_TAB_IDS = ['all', 'live', 'scheduled', 'paused', 'expired'];

const CLIENT_ORIGIN =
  typeof window !== 'undefined'
    ? window.location.origin.replace(/\/admin\/?$/, '').replace(/:\d+$/, ':5173')
    : '';

/* shared field styles */
const inputCls = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10 transition';
const selectCls = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10 transition';
const labelCls = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500';

/* ── main component ────────────────────────────────────── */

const Coupons = ({ token }) => {
  /* data */
  const {
    data: couponsRaw,
    isLoading,
    error: fetchError,
    refetch: fetchCoupons,
  } = useAdminQuery(
    'coupons',
    ({ token: t, signal }) =>
      axios.get(BACKEND_URL + '/api/coupon/admin', { headers: { token: t }, signal }).then((r) => r.data?.coupons || []),
    { token },
  );
  const coupons = couponsRaw || [];

  /* persisted filters */
  const [statusFilter, setStatusFilter] = usePersistedState('coupons.statusFilter', 'all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);

  /* form */
  const [formMode, setFormMode] = useState('create'); // create | edit | clone
  const [selectedCouponId, setSelectedCouponId] = useState('');
  const [formData, setFormData] = useState(createEmptyFormState());
  const [drawerOpen, setDrawerOpen] = useState(false);

  /* confirm dialogs */
  const [bulkPauseOpen, setBulkPauseOpen] = useState(false);
  const [activateExpiredOpen, setActivateExpiredOpen] = useState(false);
  const [pendingActivateCoupon, setPendingActivateCoupon] = useState(null);

  /* derived */
  const visibleCoupons = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    return coupons.filter((c) => {
      const lifecycle = getLifecycleState(c);
      if (statusFilter !== 'all' && lifecycle !== statusFilter) return false;
      if (q && !`${c.code} ${c.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [coupons, debouncedSearch, statusFilter]);

  const lifecycleCounts = useMemo(() => {
    const counts = { all: coupons.length, live: 0, scheduled: 0, paused: 0, expired: 0 };
    coupons.forEach((c) => {
      const s = getLifecycleState(c);
      if (counts[s] !== undefined) counts[s]++;
    });
    return counts;
  }, [coupons]);

  const tabs = useMemo(
    () =>
      LIFECYCLE_TAB_IDS.map((id) => ({
        id,
        label: id === 'all' ? 'All' : id.charAt(0).toUpperCase() + id.slice(1),
        count: lifecycleCounts[id],
      })),
    [lifecycleCounts],
  );

  const totalRedemptions = useMemo(
    () => coupons.reduce((sum, c) => sum + Number(c.usageCount || 0), 0),
    [coupons],
  );

  /* selection */
  const { selectedIds, toggle, selectAll, clear, setSelectedIds } = useTableSelection(visibleCoupons, '_id');

  /* mutations */
  const [isSaving, setIsSaving] = useState(false);
  const [isBulkPausing, setIsBulkPausing] = useState(false);

  /* form helpers */
  const openCreate = () => {
    setFormMode('create');
    setSelectedCouponId('');
    setFormData(createEmptyFormState());
    setDrawerOpen(true);
  };

  const openEdit = (coupon) => {
    setFormMode('edit');
    setSelectedCouponId(coupon._id);
    setFormData(buildFormStateFromCoupon(coupon));
    setDrawerOpen(true);
  };

  const openClone = (coupon) => {
    const cloned = buildFormStateFromCoupon(coupon);
    cloned.code = coupon.code ? `${coupon.code}-COPY` : '';
    cloned.isActive = false;
    setFormMode('clone');
    setSelectedCouponId('');
    setFormData(cloned);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setFormMode('create');
    setSelectedCouponId('');
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

  const handleSaveCoupon = async (event) => {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    try {
      const isEdit = formMode === 'edit';
      const endpoint = isEdit ? '/api/coupon/admin/update' : '/api/coupon/admin/create';
      const method = isEdit ? 'put' : 'post';
      const payload = isEdit ? { couponId: selectedCouponId, ...buildPayload() } : buildPayload();
      const response = await axios[method](BACKEND_URL + endpoint, payload, { headers: { token } });
      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to save coupon');
        return;
      }
      toast.success(response.data.message || 'Coupon saved');
      fetchCoupons();
      closeDrawer();
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsSaving(false);
    }
  };

  /* status toggle with expired-activation guard */
  const handleToggleStatus = (coupon) => {
    const isActivating = !coupon.isActive;
    const isExpired = coupon.endsAt && new Date(coupon.endsAt) < new Date();

    if (isActivating && isExpired) {
      setPendingActivateCoupon(coupon);
      setActivateExpiredOpen(true);
      return;
    }

    performToggleStatus(coupon);
  };

  const performToggleStatus = async (coupon) => {
    try {
      const response = await axios.patch(
        BACKEND_URL + '/api/coupon/admin/status',
        { couponId: coupon._id, isActive: !coupon.isActive },
        { headers: { token } },
      );
      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to update status');
        return;
      }
      toast.success(response.data.message || 'Status updated');
      fetchCoupons();
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    }
  };

  const confirmActivateExpired = () => {
    if (pendingActivateCoupon) performToggleStatus(pendingActivateCoupon);
    setActivateExpiredOpen(false);
    setPendingActivateCoupon(null);
  };

  /* bulk pause */
  const handleBulkPause = async () => {
    setIsBulkPausing(true);
    try {
      const ids = selectedIds;
      const results = await Promise.allSettled(
        ids.map((id) =>
          axios.patch(
            BACKEND_URL + '/api/coupon/admin/status',
            { couponId: id, isActive: false },
            { headers: { token } },
          ),
        ),
      );
      const failures = results.filter((r) => r.status === 'rejected');
      if (failures.length) {
        toast.error(`${failures.length} of ${ids.length} failed to pause`);
      }
      toast.success(`Paused ${ids.length - failures.length} coupon(s)`);
      fetchCoupons();
      clear();
      setBulkPauseOpen(false);
    } finally {
      setIsBulkPausing(false);
    }
  };

  /* columns */
  const columns = useMemo(
    () => [
      {
        key: 'code',
        header: 'Code',
        render: (row) => (
          <span className="font-semibold text-slate-900">{row.code}</span>
        ),
      },
      {
        key: 'lifecycle',
        header: 'Status',
        render: (row) => <StatusBadge status={getLifecycleState(row)} size="sm" />,
      },
      {
        key: 'discount',
        header: 'Offer',
        render: (row) => (
          <span className="text-sm text-slate-700">{getDiscountLabel(row)}</span>
        ),
      },
      {
        key: 'usageCount',
        header: 'Redemptions',
        sortable: true,
        align: 'right',
        render: (row) => (
          <span className="tabular-nums">
            {row.usageCount || 0}
            {row.usageLimit ? ` / ${row.usageLimit}` : ''}
          </span>
        ),
      },
      {
        key: 'minOrderAmount',
        header: 'Min order',
        sortable: true,
        align: 'right',
        render: (row) => formatMoney(row.minOrderAmount),
      },
      {
        key: 'endsAt',
        header: 'Ends',
        sortable: true,
        render: (row) => (
          <span className="text-sm text-slate-500">
            {row.endsAt ? formatDate(row.endsAt) : 'Open-ended'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        width: '140px',
        render: (row) => (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openEdit(row); }}
              className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openClone(row); }}
              className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Clone
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleToggleStatus(row); }}
              className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              {row.isActive ? 'Pause' : 'Activate'}
            </button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* sort */
  const [sortKey, setSortKey] = usePersistedState('coupons.sortKey', '');
  const [sortDirection, setSortDirection] = usePersistedState('coupons.sortDir', 'asc');

  const handleSortChange = (key, dir) => {
    setSortKey(key);
    setSortDirection(dir);
  };

  const sortedCoupons = useMemo(() => {
    if (!sortKey) return visibleCoupons;
    const sorted = [...visibleCoupons].sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === 'endsAt') {
        av = av ? new Date(av).getTime() : Infinity;
        bv = bv ? new Date(bv).getTime() : Infinity;
      }
      if (typeof av === 'string') return av.localeCompare(bv);
      return (Number(av) || 0) - (Number(bv) || 0);
    });
    return sortDirection === 'desc' ? sorted.reverse() : sorted;
  }, [visibleCoupons, sortKey, sortDirection]);

  /* test-in-cart link */
  const getTestInCartUrl = (code) =>
    `${CLIENT_ORIGIN}/cart?promo=${encodeURIComponent(code)}`;

  /* ── render ──────────────────────────────────────────── */

  return (
    <div className="flex flex-col gap-6">
      {/* header */}
      <PageHeader
        title="Promotion control center"
        description="Create launch offers, schedule campaign windows, and pause or reactivate coupons."
        actions={
          <>
            <button
              type="button"
              onClick={fetchCoupons}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
            >
              + New coupon
            </button>
          </>
        }
      />

      {/* metrics */}
      <MetricGrid>
        <MetricCard label="Total coupons" value={coupons.length} />
        <MetricCard label="Live" value={lifecycleCounts.live} />
        <MetricCard label="Scheduled" value={lifecycleCounts.scheduled} />
        <MetricCard label="Total redemptions" value={totalRedemptions} />
      </MetricGrid>

      {/* tabs */}
      <Tabs tabs={tabs} value={statusFilter} onChange={setStatusFilter} />

      {/* toolbar */}
      <Toolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by code or description…"
        actions={
          <button
            type="button"
            onClick={openCreate}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
          >
            + New coupon
          </button>
        }
      />

      {/* bulk bar */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <span className="text-sm font-medium text-slate-700">
            {selectedIds.length} selected
          </span>
          <button
            type="button"
            onClick={() => setBulkPauseOpen(true)}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
          >
            Pause selected
          </button>
          <button
            type="button"
            onClick={clear}
            className="ml-auto text-xs text-slate-500 hover:text-slate-700"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* table */}
      <DataTable
        columns={columns}
        rows={sortedCoupons}
        rowKey="_id"
        loading={isLoading}
        error={fetchError}
        onRetry={fetchCoupons}
        emptyTitle="No coupons found"
        emptyDescription="Create a coupon to get started, or adjust your filters."
        emptyAction={
          <button
            type="button"
            onClick={openCreate}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
          >
            + Create your first coupon
          </button>
        }
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
        onRowClick={openEdit}
      />

      {/* form drawer */}
      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        title={formMode === 'edit' ? 'Edit coupon' : formMode === 'clone' ? 'Clone coupon' : 'Create coupon'}
        description="Changes are saved to the coupon API."
        width="lg"
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={closeDrawer}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="coupon-form"
              disabled={isSaving}
              className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : formMode === 'edit' ? 'Update coupon' : 'Create coupon'}
            </button>
          </div>
        }
      >
        {/* selected coupon mini-card (edit mode only) */}
        {formMode === 'edit' && (() => {
          const sel = coupons.find((c) => c._id === selectedCouponId);
          if (!sel) return null;
          return (
            <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{sel.code}</p>
                  <StatusBadge status={getLifecycleState(sel)} size="sm" className="mt-1" />
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-slate-900 tabular-nums">{sel.usageCount || 0}</p>
                  <p className="text-xs text-slate-500">redemptions</p>
                </div>
              </div>
              <a
                href={getTestInCartUrl(sel.code)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-xs font-medium text-blue-600 hover:underline"
              >
                Test in cart &rarr;
              </a>
            </div>
          );
        })()}

        <form id="coupon-form" onSubmit={handleSaveCoupon} className="grid gap-5">

          {/* Row 1: Code + Type */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="coupon-code" className={labelCls}>Coupon code</label>
              <input
                id="coupon-code"
                value={formData.code}
                onChange={(e) => setFormData((s) => ({ ...s, code: e.target.value.toUpperCase() }))}
                className={inputCls + ' uppercase tracking-widest font-semibold'}
                placeholder="WELCOME10"
                maxLength="30"
                required
                autoComplete="off"
                spellCheck="false"
              />
            </div>
            <div>
              <label htmlFor="coupon-discount-type" className={labelCls}>Discount type</label>
              <select
                id="coupon-discount-type"
                value={formData.discountType}
                onChange={(e) =>
                  setFormData((s) => ({
                    ...s,
                    discountType: e.target.value,
                    discountValue: e.target.value === 'free_shipping' ? '0' : s.discountValue,
                  }))
                }
                className={selectCls}
              >
                <option value="percentage">Percentage (%)</option>
                <option value="flat">Flat amount (₹)</option>
                <option value="free_shipping">Free shipping</option>
              </select>
            </div>
          </div>

          {/* Row 2: Description */}
          <div>
            <label htmlFor="coupon-desc" className={labelCls}>Description <span className="normal-case tracking-normal text-slate-400 font-normal">— optional, shown to support team only</span></label>
            <input
              id="coupon-desc"
              value={formData.description}
              onChange={(e) => setFormData((s) => ({ ...s, description: e.target.value }))}
              className={inputCls}
              placeholder="e.g. Launch incentive for first-time shoppers"
              maxLength="200"
            />
          </div>

          {/* Row 3: Discount value + Min order */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="coupon-value" className={labelCls}>
                {formData.discountType === 'percentage' ? 'Discount %' : formData.discountType === 'flat' ? 'Discount amount (₹)' : 'Discount value'}
              </label>
              <input
                id="coupon-value"
                value={formData.discountValue}
                onChange={(e) => setFormData((s) => ({ ...s, discountValue: e.target.value }))}
                className={inputCls + (formData.discountType === 'free_shipping' ? ' opacity-40 cursor-not-allowed' : '')}
                type="number"
                min="0"
                max={formData.discountType === 'percentage' ? '100' : undefined}
                step="0.01"
                disabled={formData.discountType === 'free_shipping'}
                required
              />
              {formData.discountType === 'percentage' && Number(formData.discountValue) > 0 && (
                <p className="mt-1 text-xs text-slate-500">{formData.discountValue}% off the cart total</p>
              )}
            </div>
            <div>
              <label htmlFor="coupon-min-order" className={labelCls}>Min order amount (₹)</label>
              <input
                id="coupon-min-order"
                value={formData.minOrderAmount}
                onChange={(e) => setFormData((s) => ({ ...s, minOrderAmount: e.target.value }))}
                className={inputCls}
                type="number"
                min="0"
                step="0.01"
                placeholder="0 = no minimum"
              />
            </div>
          </div>

          {/* Row 4: Limits */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="coupon-max-disc" className={labelCls}>Max discount cap (₹)</label>
              <input
                id="coupon-max-disc"
                value={formData.maxDiscountAmount}
                onChange={(e) => setFormData((s) => ({ ...s, maxDiscountAmount: e.target.value }))}
                className={inputCls}
                type="number"
                min="0"
                step="0.01"
                placeholder="No cap"
              />
            </div>
            <div>
              <label htmlFor="coupon-usage-limit" className={labelCls}>Total uses</label>
              <input
                id="coupon-usage-limit"
                value={formData.usageLimit}
                onChange={(e) => setFormData((s) => ({ ...s, usageLimit: e.target.value }))}
                className={inputCls}
                type="number"
                min="1"
                step="1"
                placeholder="Unlimited"
              />
            </div>
            <div>
              <label htmlFor="coupon-per-user" className={labelCls}>Per-user limit</label>
              <input
                id="coupon-per-user"
                value={formData.perUserLimit}
                onChange={(e) => setFormData((s) => ({ ...s, perUserLimit: e.target.value }))}
                className={inputCls}
                type="number"
                min="1"
                step="1"
                placeholder="Unlimited"
              />
            </div>
          </div>

          {/* Row 5: Validity window */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Validity window</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="coupon-starts" className={labelCls}>Starts at <span className="normal-case tracking-normal font-normal text-slate-400">(IST)</span></label>
                <input
                  id="coupon-starts"
                  value={formData.startsAt}
                  onChange={(e) => setFormData((s) => ({ ...s, startsAt: e.target.value }))}
                  className={inputCls}
                  type="datetime-local"
                />
              </div>
              <div>
                <label htmlFor="coupon-ends" className={labelCls}>Ends at <span className="normal-case tracking-normal font-normal text-slate-400">(IST)</span></label>
                <input
                  id="coupon-ends"
                  value={formData.endsAt}
                  onChange={(e) => setFormData((s) => ({ ...s, endsAt: e.target.value }))}
                  className={inputCls}
                  type="datetime-local"
                />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">Leave both empty for an open-ended coupon. Customers see their local timezone.</p>
          </div>

          {/* Row 6: Active toggle */}
          <label htmlFor="coupon-active-toggle" className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50 transition">
            <div>
              <p className="text-sm font-semibold text-slate-900">Coupon active</p>
              <p className="text-xs text-slate-500 mt-0.5">Turn off to pause redemption without deleting the coupon.</p>
            </div>
            <div className={`relative h-6 w-11 rounded-full transition-colors ${formData.isActive ? 'bg-slate-900' : 'bg-slate-300'}`}>
              <input
                id="coupon-active-toggle"
                checked={formData.isActive}
                onChange={(e) => setFormData((s) => ({ ...s, isActive: e.target.checked }))}
                type="checkbox"
                className="sr-only"
              />
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${formData.isActive ? 'translate-x-5' : 'translate-x-0'}`} />
            </div>
          </label>
        </form>
      </Drawer>

      {/* bulk pause confirm */}
      <ConfirmDialog
        open={bulkPauseOpen}
        title="Pause selected coupons"
        description={`This will deactivate ${selectedIds.length} coupon(s). They can be reactivated individually later.`}
        confirmLabel="Pause all"
        onConfirm={handleBulkPause}
        onCancel={() => setBulkPauseOpen(false)}
        busy={isBulkPausing}
      />

      {/* activate-expired confirm */}
      <ConfirmDialog
        open={activateExpiredOpen}
        title="Activate expired coupon?"
        description={`This coupon's end date (${pendingActivateCoupon?.endsAt ? formatDate(pendingActivateCoupon.endsAt) : 'N/A'}) has already passed. Activating it will make it redeemable until you update the end date or pause it.`}
        confirmLabel="Activate anyway"
        onConfirm={confirmActivateExpired}
        onCancel={() => {
          setActivateExpiredOpen(false);
          setPendingActivateCoupon(null);
        }}
      />
    </div>
  );
};

export default Coupons;
