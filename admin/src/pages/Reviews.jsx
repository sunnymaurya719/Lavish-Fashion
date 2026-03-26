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

const Reviews = ({ token }) => {
  const [reviews, setReviews] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [selectedReviewId, setSelectedReviewId] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [statusDraft, setStatusDraft] = useState('pending');
  const [adminReplyDraft, setAdminReplyDraft] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchReviews = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await axios.get(BACKEND_URL + '/api/review/admin', {
        headers: { token },
      });

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to fetch reviews');
        return;
      }

      setReviews(response.data.reviews || []);
      setMetrics(response.data.metrics || null);
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const visibleReviews = useMemo(() => {
    return reviews.filter((review) => {
      const haystack = `${review.title} ${review.comment} ${review.product?.name || ''} ${review.customer?.name || ''}`.toLowerCase();
      const matchesSearch = haystack.includes(search.toLowerCase().trim());

      if (!matchesSearch) {
        return false;
      }

      if (statusFilter !== 'all' && review.status !== statusFilter) {
        return false;
      }

      return true;
    });
  }, [reviews, search, statusFilter]);

  const selectedReview = useMemo(
    () => reviews.find((review) => review._id === selectedReviewId) || null,
    [reviews, selectedReviewId]
  );

  useEffect(() => {
    if (visibleReviews.length === 0) {
      setSelectedReviewId('');
      setStatusDraft('pending');
      setAdminReplyDraft('');
      return;
    }

    if (!visibleReviews.some((review) => review._id === selectedReviewId)) {
      const nextReview = visibleReviews[0];
      setSelectedReviewId(nextReview._id);
      setStatusDraft(nextReview.status);
      setAdminReplyDraft(nextReview.adminReply || '');
    }
  }, [selectedReviewId, visibleReviews]);

  useEffect(() => {
    if (!selectedReview) {
      return;
    }

    setStatusDraft(selectedReview.status);
    setAdminReplyDraft(selectedReview.adminReply || '');
  }, [selectedReview]);

  const summaryCards = useMemo(() => {
    if (!metrics) {
      return [];
    }

    return [
      {
        label: 'Total reviews',
        value: metrics.totalReviews,
      },
      {
        label: 'Pending moderation',
        value: metrics.pendingReviews,
      },
      {
        label: 'Published',
        value: metrics.publishedReviews,
      },
      {
        label: 'Rejected',
        value: metrics.rejectedReviews,
      },
    ];
  }, [metrics]);

  const saveReviewStatus = async () => {
    if (!selectedReviewId || isSaving) {
      return;
    }

    setIsSaving(true);

    try {
      const response = await axios.patch(
        BACKEND_URL + '/api/review/admin/status',
        {
          reviewId: selectedReviewId,
          status: statusDraft,
          adminReply: adminReplyDraft,
        },
        { headers: { token } }
      );

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to update review');
        return;
      }

      toast.success(response.data.message || 'Review updated');
      await fetchReviews();
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className='flex flex-col gap-6'>
      <section className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
        <div className='flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between'>
          <div>
            <p className='text-lg font-semibold text-slate-900'>Trust and review moderation</p>
            <p className='text-sm text-slate-500'>
              Review every submission, control what reaches the storefront, and respond directly from admin.
            </p>
          </div>

          <button
            type='button'
            onClick={fetchReviews}
            className='rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700'
          >
            Refresh reviews
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

      <section className='grid gap-6 xl:grid-cols-[0.95fr_1.05fr]'>
        <div className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='grid gap-3 lg:grid-cols-[1.35fr_0.8fr]'>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className='rounded-2xl border border-slate-300 px-4 py-3'
              type='text'
              placeholder='Search by review, customer, or product'
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className='rounded-2xl border border-slate-300 bg-white px-4 py-3'
            >
              <option value='all'>All statuses</option>
              <option value='pending'>Pending</option>
              <option value='published'>Published</option>
              <option value='rejected'>Rejected</option>
            </select>
          </div>

          <div className='mt-5 space-y-3'>
            {isLoading ? (
              <div className='ui-loading-state'>Loading reviews...</div>
            ) : visibleReviews.length === 0 ? (
              <div className='rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500'>
                No reviews matched the current filters.
              </div>
            ) : (
              visibleReviews.map((review) => {
                const isActive = review._id === selectedReviewId;

                return (
                  <button
                    key={review._id}
                    type='button'
                    onClick={() => setSelectedReviewId(review._id)}
                    className={`w-full rounded-[28px] border p-4 text-left transition ${
                      isActive ? 'border-slate-900 bg-slate-950 text-white shadow-lg' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className='flex items-start justify-between gap-4'>
                      <div>
                        <p className={`font-semibold ${isActive ? 'text-white' : 'text-slate-900'}`}>{review.title}</p>
                        <p className={`mt-1 text-sm ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>
                          {review.product?.name || 'Unknown product'}
                        </p>
                        <p className='mt-1 text-xs uppercase tracking-[0.2em] text-slate-400'>
                          {review.customer?.name || 'Customer'} | {formatDate(review.createdAt)}
                        </p>
                      </div>

                      <div className='flex flex-col items-end gap-2'>
                        <span
                          className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${
                            isActive ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {review.status}
                        </span>
                        {Array.isArray(review.media) && review.media.length > 0 ? (
                          <span
                            className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${
                              isActive ? 'bg-white/10 text-white' : 'bg-sky-50 text-sky-700'
                            }`}
                          >
                            {review.media.length} media
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <p className={`mt-4 text-sm leading-6 ${isActive ? 'text-slate-200' : 'text-slate-500'}`}>
                      {review.comment.length > 150 ? `${review.comment.slice(0, 150).trim()}...` : review.comment}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          {!selectedReview ? (
            <div className='rounded-2xl bg-slate-50 px-4 py-8 text-sm text-slate-500'>
              Select a review to inspect and moderate it.
            </div>
          ) : (
            <div className='space-y-6'>
              <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
                <div>
                  <p className='text-2xl font-semibold text-slate-900'>{selectedReview.title}</p>
                  <p className='mt-2 text-sm text-slate-500'>
                    {selectedReview.customer?.name || 'Customer'} | {selectedReview.customer?.email || 'No email'}
                  </p>
                  <p className='mt-1 text-sm text-slate-500'>
                    {selectedReview.product?.name || 'Unknown product'} | {formatDate(selectedReview.createdAt)}
                  </p>
                </div>

                <div className='grid grid-cols-2 gap-3 sm:min-w-[320px]'>
                  <div className='rounded-2xl bg-slate-50 px-4 py-3'>
                    <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Rating</p>
                    <p className='mt-2 text-lg font-semibold text-slate-900'>{selectedReview.rating}/5</p>
                  </div>
                  <div className='rounded-2xl bg-slate-50 px-4 py-3'>
                    <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Reward points</p>
                    <p className='mt-2 text-lg font-semibold text-slate-900'>
                      {selectedReview.rewardPointsGranted || 0}
                    </p>
                  </div>
                </div>
              </div>

              <section className='rounded-3xl border border-slate-200 bg-slate-50 p-5'>
                <p className='text-lg font-semibold text-slate-900'>Review content</p>
                <p className='mt-4 text-sm leading-7 text-slate-600'>{selectedReview.comment}</p>
              </section>

              {Array.isArray(selectedReview.media) && selectedReview.media.length > 0 ? (
                <section className='rounded-3xl border border-slate-200 bg-slate-50 p-5'>
                  <div className='flex items-center justify-between gap-4'>
                    <p className='text-lg font-semibold text-slate-900'>Customer media</p>
                    <span className='text-sm text-slate-500'>{selectedReview.media.length} uploaded assets</span>
                  </div>

                  <div className='mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
                    {selectedReview.media.map((item, index) => (
                      <a
                        key={`${selectedReview._id}-media-${index}`}
                        href={item.url}
                        target='_blank'
                        rel='noreferrer'
                        className='overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'
                      >
                        <img
                          src={item.url}
                          alt={`Review media ${index + 1}`}
                          className='h-44 w-full object-cover'
                        />
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className='rounded-3xl border border-slate-200 bg-slate-50 p-5'>
                <div className='grid gap-4'>
                  <div>
                    <p className='mb-2 text-sm text-slate-600'>Moderation status</p>
                    <select
                      value={statusDraft}
                      onChange={(event) => setStatusDraft(event.target.value)}
                      className='w-full rounded-2xl border border-slate-300 bg-white px-4 py-3'
                    >
                      <option value='pending'>Pending</option>
                      <option value='published'>Publish</option>
                      <option value='rejected'>Reject</option>
                    </select>
                  </div>

                  <div>
                    <p className='mb-2 text-sm text-slate-600'>Admin reply</p>
                    <textarea
                      value={adminReplyDraft}
                      onChange={(event) => setAdminReplyDraft(event.target.value)}
                      className='min-h-32 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3'
                      placeholder='Reply to the customer or add context that will appear on the product page.'
                      maxLength={500}
                    />
                  </div>
                </div>

                <button
                  type='button'
                  onClick={saveReviewStatus}
                  disabled={isSaving}
                  className='mt-5 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-60'
                >
                  {isSaving ? 'Saving moderation...' : 'Save moderation'}
                </button>
              </section>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default Reviews;
