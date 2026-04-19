import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';
import {
  ConfirmDialog,
  DateTime,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  MetricGrid,
  PageHeader,
  StatusBadge,
  Tabs,
  Toolbar,
} from '../components/ui';
import {
  useDebouncedValue,
  useKeyboardShortcut,
  usePersistedState,
  useTableSelection,
} from '../hooks';

const STATUS_TABS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'published', label: 'Published' },
  { id: 'rejected', label: 'Rejected' },
];

const RATING_FILTER_OPTIONS = [
  { value: 'all', label: 'Any rating' },
  { value: '5', label: '5 stars' },
  { value: '4', label: '4 stars' },
  { value: '3', label: '3 stars' },
  { value: '2', label: '2 stars' },
  { value: '1', label: '1 star' },
];

const Stars = ({ rating, className = '' }) => {
  const value = Number(rating) || 0;
  return (
    <span className={`inline-flex items-center text-amber-500 ${className}`} aria-label={`${value} of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} aria-hidden='true' className={i < value ? 'text-amber-500' : 'text-slate-300'}>
          ★
        </span>
      ))}
    </span>
  );
};

const Lightbox = ({ images, index, onClose, onPrev, onNext }) => {
  useEffect(() => {
    if (index === null) return undefined;
    const handler = (event) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft') onPrev();
      else if (event.key === 'ArrowRight') onNext();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [index, onClose, onPrev, onNext]);

  if (index === null || !images?.[index]) return null;
  const image = images[index];

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6'>
      <button
        type='button'
        aria-label='Close lightbox'
        className='absolute inset-0'
        onClick={onClose}
      />
      <button
        type='button'
        onClick={onPrev}
        aria-label='Previous image'
        className='absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/20'
        disabled={images.length <= 1}
      >
        ‹
      </button>
      <img
        src={image.url}
        alt={`Review media ${index + 1}`}
        className='relative z-10 max-h-[85vh] max-w-[85vw] rounded-2xl object-contain shadow-2xl'
      />
      <button
        type='button'
        onClick={onNext}
        aria-label='Next image'
        className='absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/20'
        disabled={images.length <= 1}
      >
        ›
      </button>
      <button
        type='button'
        onClick={onClose}
        aria-label='Close'
        className='absolute right-4 top-4 z-10 rounded-full bg-white/10 px-3 py-1 text-sm text-white transition hover:bg-white/20'
      >
        Close · Esc
      </button>
    </div>
  );
};

const Reviews = ({ token }) => {
  const [reviews, setReviews] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [selectedReviewId, setSelectedReviewId] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);

  const [statusFilter, setStatusFilter] = usePersistedState('admin.reviews.statusFilter', 'all');
  const [ratingFilter, setRatingFilter] = usePersistedState('admin.reviews.ratingFilter', 'all');
  const [verifiedOnly, setVerifiedOnly] = usePersistedState('admin.reviews.verifiedOnly', false);
  const [photosOnly, setPhotosOnly] = usePersistedState('admin.reviews.photosOnly', false);
  const [hasReplyFilter, setHasReplyFilter] = usePersistedState('admin.reviews.hasReplyFilter', 'all');

  const [adminReplyDraft, setAdminReplyDraft] = useState('');
  const [originalReply, setOriginalReply] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [savingReplyId, setSavingReplyId] = useState('');
  const [pendingStatusId, setPendingStatusId] = useState('');
  const [bulkConfirm, setBulkConfirm] = useState(null); // { status: 'published'|'rejected', ids }
  const [switchConfirm, setSwitchConfirm] = useState(null); // { nextId }
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const replyTextareaRef = useRef(null);

  const fetchReviews = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await axios.get(BACKEND_URL + '/api/review/admin', { headers: { token } });
      if (!response.data.success) {
        throw new Error(response.data.message || 'Failed to fetch reviews');
      }
      setReviews(response.data.reviews || []);
      setMetrics(response.data.metrics || null);
    } catch (error) {
      setLoadError(error?.response?.data?.message || error.message || 'Failed to fetch reviews');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const visibleReviews = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    return reviews.filter((review) => {
      if (statusFilter !== 'all' && review.status !== statusFilter) return false;
      if (ratingFilter !== 'all' && Number(review.rating) !== Number(ratingFilter)) return false;
      if (verifiedOnly && !review.isVerifiedPurchase) return false;
      if (photosOnly && !(Array.isArray(review.media) && review.media.length > 0)) return false;
      if (hasReplyFilter === 'with' && !(review.adminReply || '').trim()) return false;
      if (hasReplyFilter === 'without' && (review.adminReply || '').trim()) return false;
      if (needle) {
        const haystack = `${review.title || ''} ${review.comment || ''} ${review.product?.name || ''} ${
          review.customer?.name || ''
        } ${review.customer?.email || ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [reviews, debouncedSearch, statusFilter, ratingFilter, verifiedOnly, photosOnly, hasReplyFilter]);

  const selectedReview = useMemo(
    () => reviews.find((review) => review._id === selectedReviewId) || null,
    [reviews, selectedReviewId]
  );

  // Adopt the first visible review as the selection when nothing is chosen or
  // when the previous selection has been filtered out.
  useEffect(() => {
    if (visibleReviews.length === 0) {
      if (selectedReviewId) setSelectedReviewId('');
      return;
    }
    if (!visibleReviews.some((review) => review._id === selectedReviewId)) {
      const next = visibleReviews[0];
      setSelectedReviewId(next._id);
    }
  }, [selectedReviewId, visibleReviews]);

  // Sync the reply draft with the selected review whenever the selection or
  // its server-side reply changes.
  useEffect(() => {
    if (!selectedReview) {
      setAdminReplyDraft('');
      setOriginalReply('');
      return;
    }
    setAdminReplyDraft(selectedReview.adminReply || '');
    setOriginalReply(selectedReview.adminReply || '');
  }, [selectedReview?._id, selectedReview?.adminReply]);

  const summaryCards = useMemo(() => {
    if (!metrics) return [];
    return [
      { label: 'Total reviews', value: metrics.totalReviews ?? 0 },
      { label: 'Pending moderation', value: metrics.pendingReviews ?? 0, tone: 'warning' },
      { label: 'Published', value: metrics.publishedReviews ?? 0, tone: 'success' },
      { label: 'Rejected', value: metrics.rejectedReviews ?? 0, tone: 'danger' },
    ];
  }, [metrics]);

  const statusCounts = useMemo(() => {
    const counts = { all: reviews.length, pending: 0, published: 0, rejected: 0 };
    reviews.forEach((review) => {
      counts[review.status] = (counts[review.status] || 0) + 1;
    });
    return counts;
  }, [reviews]);

  const selection = useTableSelection(visibleReviews, '_id');
  const { selectedIds, isSelected, toggle, selectAll, clear, selectedCount } = selection;

  // Optimistic helper — mutate a review in place so the list reflects the
  // pending change while the request is in flight.
  const updateReviewLocal = useCallback((reviewId, patch) => {
    setReviews((prev) =>
      prev.map((review) => (review._id === reviewId ? { ...review, ...patch } : review))
    );
  }, []);

  const callStatusEndpoint = useCallback(
    async ({ reviewId, status, adminReply }) => {
      const response = await axios.patch(
        BACKEND_URL + '/api/review/admin/status',
        { reviewId, status, adminReply: adminReply ?? '' },
        { headers: { token } }
      );
      if (!response.data.success) {
        throw new Error(response.data.message || 'Failed to update review');
      }
      return response.data;
    },
    [token]
  );

  const setReviewStatus = useCallback(
    async (reviewId, nextStatus) => {
      const target = reviews.find((review) => review._id === reviewId);
      if (!target) return;
      const previousStatus = target.status;
      if (previousStatus === nextStatus) return;

      setPendingStatusId(reviewId);
      // Optimistic flip; the existing reply is preserved (matches the
      // current backend behavior of always passing both fields together).
      updateReviewLocal(reviewId, { status: nextStatus });

      try {
        await callStatusEndpoint({
          reviewId,
          status: nextStatus,
          adminReply: target.adminReply || '',
        });
        // Adjust metrics counters locally so summary cards stay accurate
        // until the next refresh.
        setMetrics((prev) => {
          if (!prev) return prev;
          const next = { ...prev };
          const dec = `${previousStatus}Reviews`;
          const inc = `${nextStatus}Reviews`;
          if (typeof next[dec] === 'number') next[dec] = Math.max(0, next[dec] - 1);
          if (typeof next[inc] === 'number') next[inc] = next[inc] + 1;
          return next;
        });
        toast.success(`Review marked as ${nextStatus}`);
      } catch (error) {
        // Rollback
        updateReviewLocal(reviewId, { status: previousStatus });
        toast.error(error?.response?.data?.message || error.message);
      } finally {
        setPendingStatusId('');
      }
    },
    [reviews, callStatusEndpoint, updateReviewLocal]
  );

  const saveAdminReply = useCallback(async () => {
    if (!selectedReview) return;
    if (adminReplyDraft === originalReply) return;
    setSavingReplyId(selectedReview._id);
    const previousReply = selectedReview.adminReply || '';
    updateReviewLocal(selectedReview._id, { adminReply: adminReplyDraft });
    try {
      await callStatusEndpoint({
        reviewId: selectedReview._id,
        status: selectedReview.status,
        adminReply: adminReplyDraft,
      });
      setOriginalReply(adminReplyDraft);
      toast.success('Reply saved');
    } catch (error) {
      updateReviewLocal(selectedReview._id, { adminReply: previousReply });
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setSavingReplyId('');
    }
  }, [selectedReview, adminReplyDraft, originalReply, callStatusEndpoint, updateReviewLocal]);

  const performBulk = useCallback(
    async (status, ids) => {
      const targets = ids
        .map((id) => reviews.find((review) => review._id === id))
        .filter(Boolean);
      const results = await Promise.allSettled(
        targets.map((review) =>
          callStatusEndpoint({
            reviewId: review._id,
            status,
            adminReply: review.adminReply || '',
          })
        )
      );
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.length - succeeded;
      if (succeeded > 0) toast.success(`${succeeded} review${succeeded === 1 ? '' : 's'} marked ${status}`);
      if (failed > 0) toast.error(`${failed} review${failed === 1 ? '' : 's'} failed to update`);
      clear();
      await fetchReviews();
    },
    [reviews, callStatusEndpoint, clear, fetchReviews]
  );

  // Selection of next/previous in the visible list — used by j/k shortcuts.
  const moveSelection = useCallback(
    (delta) => {
      if (visibleReviews.length === 0) return;
      const currentIndex = visibleReviews.findIndex((review) => review._id === selectedReviewId);
      const nextIndex = Math.min(
        Math.max(0, (currentIndex < 0 ? 0 : currentIndex) + delta),
        visibleReviews.length - 1
      );
      const next = visibleReviews[nextIndex];
      if (!next || next._id === selectedReviewId) return;
      const hasUnsaved = adminReplyDraft !== originalReply;
      if (hasUnsaved) {
        setSwitchConfirm({ nextId: next._id });
        return;
      }
      setSelectedReviewId(next._id);
    },
    [visibleReviews, selectedReviewId, adminReplyDraft, originalReply]
  );

  // Keyboard shortcuts — ADMIN_UI_OPTIMIZATION_PLAN §3.9.1.
  useKeyboardShortcut({
    j: () => moveSelection(1),
    k: () => moveSelection(-1),
    a: () => selectedReview && setReviewStatus(selectedReview._id, 'published'),
    r: () => selectedReview && setReviewStatus(selectedReview._id, 'rejected'),
    e: () => replyTextareaRef.current?.focus(),
    s: () => saveAdminReply(),
  });

  const handleSelectReview = (reviewId) => {
    if (reviewId === selectedReviewId) return;
    if (adminReplyDraft !== originalReply) {
      setSwitchConfirm({ nextId: reviewId });
      return;
    }
    setSelectedReviewId(reviewId);
  };

  const lightboxImages = selectedReview?.media || [];

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        eyebrow='Trust & moderation'
        title='Review moderation'
        description='Triage submissions with j/k, approve with a, reject with r. Bulk actions and reply edits live in the right pane.'
        actions={
          <button
            type='button'
            onClick={fetchReviews}
            className='rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 ui-focus-ring'
          >
            Refresh
          </button>
        }
      />

      <MetricGrid columns={4}>
        {summaryCards.map((card) => (
          <MetricCard key={card.label} label={card.label} value={card.value} tone={card.tone} />
        ))}
      </MetricGrid>

      <Toolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder='Search by review, customer, or product…'
        filters={
          <>
            <select
              value={ratingFilter}
              onChange={(event) => setRatingFilter(event.target.value)}
              className='rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm'
              aria-label='Filter by rating'
            >
              {RATING_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              value={hasReplyFilter}
              onChange={(event) => setHasReplyFilter(event.target.value)}
              className='rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm'
              aria-label='Filter by reply status'
            >
              <option value='all'>Any reply state</option>
              <option value='with'>Has reply</option>
              <option value='without'>No reply</option>
            </select>
            <label className='inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700'>
              <input
                type='checkbox'
                checked={verifiedOnly}
                onChange={(event) => setVerifiedOnly(event.target.checked)}
                className='h-4 w-4'
              />
              Verified only
            </label>
            <label className='inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700'>
              <input
                type='checkbox'
                checked={photosOnly}
                onChange={(event) => setPhotosOnly(event.target.checked)}
                className='h-4 w-4'
              />
              With photos
            </label>
          </>
        }
      />

      <Tabs
        tabs={STATUS_TABS.map((tab) => ({ ...tab, count: statusCounts[tab.id] || 0 }))}
        value={statusFilter}
        onChange={setStatusFilter}
      />

      {selectedCount > 0 ? (
        <div
          role='region'
          aria-label='Bulk actions'
          className='flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-white shadow'
        >
          <p className='text-sm font-medium'>
            {selectedCount} selected{' '}
            <button type='button' onClick={clear} className='ml-2 text-slate-300 underline-offset-2 hover:underline'>
              Clear
            </button>
          </p>
          <div className='flex flex-wrap items-center gap-2'>
            <button
              type='button'
              onClick={() => setBulkConfirm({ status: 'published', ids: selectedIds })}
              className='rounded-xl bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-600 ui-focus-ring'
            >
              Approve selected
            </button>
            <button
              type='button'
              onClick={() => setBulkConfirm({ status: 'rejected', ids: selectedIds })}
              className='rounded-xl bg-rose-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-rose-600 ui-focus-ring'
            >
              Reject selected
            </button>
          </div>
        </div>
      ) : null}

      <section className='grid gap-6 xl:grid-cols-[0.95fr_1.05fr]'>
        {/* List pane */}
        <div className='flex flex-col gap-3'>
          {isLoading ? (
            <LoadingState variant='list' rows={4} />
          ) : loadError ? (
            <ErrorState description={loadError} onRetry={fetchReviews} />
          ) : visibleReviews.length === 0 ? (
            <EmptyState
              title='No reviews matched the current filters'
              description='Try clearing one of the filter chips or switch to a different status tab.'
            />
          ) : (
            <>
              <div className='flex items-center justify-between text-xs text-slate-500'>
                <button
                  type='button'
                  onClick={selectAll}
                  className='rounded-md px-2 py-1 hover:bg-slate-100 ui-focus-ring'
                >
                  Select all visible ({visibleReviews.length})
                </button>
                <p>j / k to navigate, a approve, r reject, e reply, s save</p>
              </div>
              {visibleReviews.map((review) => {
                const isActive = review._id === selectedReviewId;
                const checked = isSelected(review._id);
                return (
                  <div
                    key={review._id}
                    className={`group rounded-2xl border p-4 transition ${
                      isActive
                        ? 'border-slate-900 bg-slate-950 text-white shadow-lg'
                        : checked
                          ? 'border-slate-300 bg-slate-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className='flex items-start gap-3'>
                      <input
                        type='checkbox'
                        checked={checked}
                        onChange={() => toggle(review._id)}
                        aria-label={`Select review ${review.title}`}
                        className='mt-1 h-4 w-4'
                        onClick={(event) => event.stopPropagation()}
                      />
                      <button
                        type='button'
                        onClick={() => handleSelectReview(review._id)}
                        className='min-w-0 flex-1 text-left ui-focus-ring'
                      >
                        <div className='flex items-start justify-between gap-3'>
                          <div className='min-w-0'>
                            <p
                              className={`truncate font-semibold ${
                                isActive ? 'text-white' : 'text-slate-900'
                              }`}
                            >
                              {review.title}
                            </p>
                            <p
                              className={`mt-0.5 truncate text-sm ${
                                isActive ? 'text-slate-300' : 'text-slate-500'
                              }`}
                            >
                              {review.product?.name || 'Unknown product'}
                            </p>
                            <p className={`mt-1 truncate text-[11px] uppercase tracking-[0.18em] ${
                              isActive ? 'text-slate-400' : 'text-slate-400'
                            }`}>
                              {review.customer?.name || 'Customer'} ·{' '}
                              <DateTime value={review.createdAt} timeStyle={undefined} />
                            </p>
                          </div>
                          <div className='flex flex-col items-end gap-1'>
                            <Stars rating={review.rating} className='text-base' />
                            <StatusBadge status={review.status} size='sm' />
                          </div>
                        </div>
                        <p
                          className={`mt-3 line-clamp-2 text-sm leading-6 ${
                            isActive ? 'text-slate-200' : 'text-slate-600'
                          }`}
                        >
                          {review.comment}
                        </p>
                        <div className='mt-2 flex flex-wrap items-center gap-2 text-[11px]'>
                          {review.isVerifiedPurchase ? (
                            <span
                              className={`rounded-full px-2 py-0.5 ${
                                isActive
                                  ? 'bg-white/10 text-emerald-200'
                                  : 'bg-emerald-50 text-emerald-700'
                              }`}
                            >
                              Verified
                            </span>
                          ) : null}
                          {Array.isArray(review.media) && review.media.length > 0 ? (
                            <span
                              className={`rounded-full px-2 py-0.5 ${
                                isActive ? 'bg-white/10 text-sky-200' : 'bg-sky-50 text-sky-700'
                              }`}
                            >
                              {review.media.length} photo{review.media.length === 1 ? '' : 's'}
                            </span>
                          ) : null}
                          {(review.adminReply || '').trim() ? (
                            <span
                              className={`rounded-full px-2 py-0.5 ${
                                isActive
                                  ? 'bg-white/10 text-violet-200'
                                  : 'bg-violet-50 text-violet-700'
                              }`}
                            >
                              Replied
                            </span>
                          ) : null}
                        </div>
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Detail pane */}
        <div className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
          {!selectedReview ? (
            <EmptyState title='Select a review' description='Pick a review from the list to inspect or moderate it.' />
          ) : (
            <div className='space-y-5'>
              <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
                <div className='min-w-0'>
                  <p className='text-2xl font-semibold text-slate-900'>{selectedReview.title}</p>
                  <p className='mt-2 text-sm text-slate-500'>
                    {selectedReview.customer?.name || 'Customer'} ·{' '}
                    <span className='font-mono text-[13px]'>
                      {selectedReview.customer?.email || 'No email'}
                    </span>
                  </p>
                  <p className='mt-1 text-sm text-slate-500'>
                    {selectedReview.product?.name || 'Unknown product'} ·{' '}
                    <DateTime value={selectedReview.createdAt} />
                  </p>
                  <div className='mt-3 flex flex-wrap items-center gap-2'>
                    <Stars rating={selectedReview.rating} />
                    <StatusBadge status={selectedReview.status} />
                    {selectedReview.isVerifiedPurchase ? (
                      <span className='rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-emerald-700'>
                        Verified purchase
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className='flex flex-wrap gap-2'>
                  <button
                    type='button'
                    onClick={() => setReviewStatus(selectedReview._id, 'published')}
                    disabled={pendingStatusId === selectedReview._id || selectedReview.status === 'published'}
                    className='rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 ui-focus-ring'
                    title='Approve (a)'
                  >
                    Approve
                  </button>
                  <button
                    type='button'
                    onClick={() => setReviewStatus(selectedReview._id, 'rejected')}
                    disabled={pendingStatusId === selectedReview._id || selectedReview.status === 'rejected'}
                    className='rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50 ui-focus-ring'
                    title='Reject (r)'
                  >
                    Reject
                  </button>
                  <button
                    type='button'
                    onClick={() => setReviewStatus(selectedReview._id, 'pending')}
                    disabled={pendingStatusId === selectedReview._id || selectedReview.status === 'pending'}
                    className='rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ui-focus-ring'
                  >
                    Mark pending
                  </button>
                </div>
              </div>

              <section className='rounded-2xl border border-slate-200 bg-slate-50 p-5'>
                <p className='text-sm font-semibold text-slate-700'>Review content</p>
                <p className='mt-3 text-sm leading-7 text-slate-700 whitespace-pre-wrap'>
                  {selectedReview.comment}
                </p>
                <p className='mt-3 text-xs text-slate-500'>
                  Reward points granted: {selectedReview.rewardPointsGranted || 0}
                </p>
              </section>

              {Array.isArray(selectedReview.media) && selectedReview.media.length > 0 ? (
                <section className='rounded-2xl border border-slate-200 bg-slate-50 p-5'>
                  <div className='flex items-center justify-between'>
                    <p className='text-sm font-semibold text-slate-700'>
                      Customer media · {selectedReview.media.length}
                    </p>
                  </div>
                  <div className='mt-3 grid gap-3 sm:grid-cols-3'>
                    {selectedReview.media.map((item, index) => (
                      <button
                        key={`${selectedReview._id}-media-${index}`}
                        type='button'
                        onClick={() => setLightboxIndex(index)}
                        className='overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ui-focus-ring'
                        aria-label={`Open photo ${index + 1} in lightbox`}
                      >
                        <img
                          src={item.url}
                          alt={`Review media ${index + 1}`}
                          className='h-32 w-full object-cover'
                          loading='lazy'
                        />
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className='rounded-2xl border border-slate-200 bg-slate-50 p-5'>
                <div className='flex items-center justify-between gap-2'>
                  <label htmlFor='admin-reply' className='text-sm font-semibold text-slate-700'>
                    Admin reply
                  </label>
                  <span
                    className={`text-xs ${
                      adminReplyDraft.length > 480 ? 'text-amber-700' : 'text-slate-500'
                    }`}
                  >
                    {adminReplyDraft.length}/500
                  </span>
                </div>
                <textarea
                  id='admin-reply'
                  ref={replyTextareaRef}
                  value={adminReplyDraft}
                  onChange={(event) => setAdminReplyDraft(event.target.value)}
                  className='mt-2 min-h-32 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm ui-focus-ring'
                  placeholder='Reply to the customer or add context that will appear on the product page.'
                  maxLength={500}
                />
                <div className='mt-3 flex flex-wrap items-center justify-between gap-2'>
                  <p className='text-xs text-slate-500'>
                    {adminReplyDraft === originalReply ? (
                      'No unsaved changes'
                    ) : (
                      <span className='font-medium text-amber-700'>Unsaved changes</span>
                    )}
                  </p>
                  <div className='flex items-center gap-2'>
                    <button
                      type='button'
                      onClick={() => setAdminReplyDraft(originalReply)}
                      disabled={adminReplyDraft === originalReply}
                      className='rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ui-focus-ring'
                    >
                      Discard
                    </button>
                    <button
                      type='button'
                      onClick={saveAdminReply}
                      disabled={
                        adminReplyDraft === originalReply || savingReplyId === selectedReview._id
                      }
                      className='rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ui-focus-ring'
                      title='Save reply (s)'
                    >
                      {savingReplyId === selectedReview._id ? 'Saving…' : 'Save reply'}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      </section>

      <Lightbox
        images={lightboxImages}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onPrev={() =>
          setLightboxIndex((prev) =>
            prev === null || lightboxImages.length === 0
              ? prev
              : (prev - 1 + lightboxImages.length) % lightboxImages.length
          )
        }
        onNext={() =>
          setLightboxIndex((prev) =>
            prev === null || lightboxImages.length === 0 ? prev : (prev + 1) % lightboxImages.length
          )
        }
      />

      <ConfirmDialog
        open={Boolean(bulkConfirm)}
        title={`${bulkConfirm?.status === 'published' ? 'Approve' : 'Reject'} ${
          bulkConfirm?.ids?.length || 0
        } review${bulkConfirm?.ids?.length === 1 ? '' : 's'}?`}
        description='This action will update each selected review using the existing admin endpoint. Failed updates will be reported individually.'
        confirmLabel={bulkConfirm?.status === 'published' ? 'Approve all' : 'Reject all'}
        destructive={bulkConfirm?.status === 'rejected'}
        onCancel={() => setBulkConfirm(null)}
        onConfirm={async () => {
          const payload = bulkConfirm;
          setBulkConfirm(null);
          if (payload) await performBulk(payload.status, payload.ids);
        }}
      />

      <ConfirmDialog
        open={Boolean(switchConfirm)}
        title='Discard unsaved reply?'
        description='You have unsaved changes to the admin reply. Switching reviews will discard them.'
        confirmLabel='Discard and switch'
        cancelLabel='Stay on this review'
        destructive
        onCancel={() => setSwitchConfirm(null)}
        onConfirm={() => {
          if (switchConfirm?.nextId) setSelectedReviewId(switchConfirm.nextId);
          setSwitchConfirm(null);
        }}
      />
    </div>
  );
};

export default Reviews;
