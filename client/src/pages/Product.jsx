import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import RelatedProducts from '../components/RelatedProducts';
import { ShopContext } from '../context/ShopContext';

const HeartIcon = ({ filled = false }) => (
  <svg width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
    <path
      d='M12 20.4 10.55 19.08C5.4 14.36 2 11.24 2 7.42 2 4.3 4.42 2 7.5 2c1.74 0 3.42.81 4.5 2.09A5.9 5.9 0 0 1 16.5 2C19.58 2 22 4.3 22 7.42c0 3.82-3.4 6.94-8.55 11.69L12 20.4Z'
      fill={filled ? 'currentColor' : 'none'}
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinejoin='round'
    />
  </svg>
);

const StarRating = ({ rating = 0, size = 18 }) => (
  <div className='flex items-center gap-1 text-amber-500'>
    {Array.from({ length: 5 }).map((_, index) => (
      <svg key={index} width={size} height={size} viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <path
          d='m12 3.5 2.63 5.33 5.88.86-4.25 4.14 1 5.86L12 17l-5.26 2.69 1-5.86L3.5 9.69l5.88-.86L12 3.5Z'
          fill={index < Math.round(Number(rating || 0)) ? 'currentColor' : 'none'}
          stroke='currentColor'
          strokeWidth='1.4'
          strokeLinejoin='round'
        />
      </svg>
    ))}
  </div>
);

const defaultReviewSummary = {
  reviewCount: 0,
  averageRating: 0,
  ratingBreakdown: [5, 4, 3, 2, 1].map((rating) => ({ rating, count: 0 })),
};

const defaultEligibility = {
  canReview: false,
  alreadyReviewed: false,
  reviewStatus: null,
  reason: '',
  orderId: '',
};

const isMissingRouteError = (error) => {
  const statusCode = Number(error?.response?.status || 0);
  const errorMessage = String(error?.response?.data?.message || '').toLowerCase();
  return statusCode === 404 && errorMessage.includes('route not found');
};

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

const Product = () => {
  const { productId } = useParams();
  const {
    BACKEND_URL,
    products,
    currency,
    addToCart,
    isWishlisted,
    navigate,
    toast,
    toggleWishlist,
    token,
    serverBootstrap,
    serverStatus,
    loadingProductsData,
  } = useContext(ShopContext);
  const [productData, setProductData] = useState(false);
  const [image, setImage] = useState('');
  const [size, setSize] = useState('');
  const [reviews, setReviews] = useState([]);
  const [reviewSummary, setReviewSummary] = useState(defaultReviewSummary);
  const [reviewEligibility, setReviewEligibility] = useState(defaultEligibility);
  const [reviewForm, setReviewForm] = useState({
    rating: 5,
    title: '',
    comment: '',
  });
  const [reviewMediaFiles, setReviewMediaFiles] = useState([]);
  const [isLoadingReviews, setIsLoadingReviews] = useState(true);
  const [isCheckingEligibility, setIsCheckingEligibility] = useState(false);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const reviewMediaInputRef = useRef(null);

  const fetchReviews = useCallback(async () => {
    setIsLoadingReviews(true);

    try {
      const response = await axios.get(BACKEND_URL + `/api/review/product/${productId}`);

      if (!response.data.success) {
        toast.error(response.data.message || 'Unable to load reviews');
        return;
      }

      setReviewSummary({
        ...defaultReviewSummary,
        ...(response.data.summary || {}),
      });
      setReviews(response.data.reviews || []);
    } catch (error) {
      if (isMissingRouteError(error)) {
        setReviewSummary(defaultReviewSummary);
        setReviews([]);
        return;
      }

      toast.error(error?.response?.data?.message || 'Unable to load reviews');
    } finally {
      setIsLoadingReviews(false);
    }
  }, [BACKEND_URL, productId, toast]);

  const fetchReviewEligibility = useCallback(async () => {
    if (!token) {
      setReviewEligibility(defaultEligibility);
      return;
    }

    setIsCheckingEligibility(true);

    try {
      const response = await axios.post(
        BACKEND_URL + '/api/review/eligibility',
        { productId },
        { headers: { token } }
      );

      if (!response.data.success) {
        toast.error(response.data.message || 'Unable to check review access');
        return;
      }

      setReviewEligibility({
        ...defaultEligibility,
        ...(response.data.eligibility || {}),
      });
    } catch (error) {
      const statusCode = Number(error?.response?.status || 0);

      if (statusCode === 401) {
        return;
      }

      if (isMissingRouteError(error)) {
        setReviewEligibility({
          ...defaultEligibility,
          reason: 'Review feature is currently unavailable on this API environment.',
        });
        return;
      }

      toast.error(error?.response?.data?.message || 'Unable to check review access');
    } finally {
      setIsCheckingEligibility(false);
    }
  }, [BACKEND_URL, productId, toast, token]);

  const buyNow = () => {
    if (!size) {
      toast.error('Please select a size');
      return;
    }

    if (Number(productData?.stock || 0) === 0) {
      toast.error('This product is currently out of stock');
      return;
    }

    navigate('/place-order', { state: { buyNow: true, product: { ...productData, size } } });
  };

  useEffect(() => {
    const matchedProduct = products.find((item) => item._id === productId);

    if (!matchedProduct) {
      return;
    }

    setProductData(matchedProduct);
    setImage(matchedProduct.image?.[0] || '');
    setSize((currentSize) => (matchedProduct.sizes?.includes(currentSize) ? currentSize : ''));
  }, [productId, products]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  useEffect(() => {
    fetchReviewEligibility();
  }, [fetchReviewEligibility]);

  const submitReview = async (event) => {
    event.preventDefault();

    if (!token) {
      navigate('/login');
      return;
    }

    if (isSubmittingReview) {
      return;
    }

    setIsSubmittingReview(true);

    try {
      const formData = new FormData();
      formData.append('productId', productId);
      formData.append('rating', String(Number(reviewForm.rating)));
      formData.append('title', reviewForm.title);
      formData.append('comment', reviewForm.comment);
      reviewMediaFiles.forEach((file) => {
        formData.append('media', file);
      });

      const response = await axios.post(BACKEND_URL + '/api/review/create', formData, { headers: { token } });

      if (!response.data.success) {
        toast.error(response.data.message || 'Unable to submit review');
        return;
      }

      toast.success(response.data.message || 'Review submitted successfully');
      setReviewForm({
        rating: 5,
        title: '',
        comment: '',
      });
      setReviewMediaFiles([]);
      if (reviewMediaInputRef.current) {
        reviewMediaInputRef.current.value = '';
      }
      setReviewEligibility({
        canReview: false,
        alreadyReviewed: true,
        reviewStatus: 'pending',
        reason: 'Your review is pending moderation.',
        orderId: reviewEligibility.orderId || '',
      });
    } catch (error) {
      if (isMissingRouteError(error)) {
        toast.error('Review submission is unavailable right now. Please try again later.');
        return;
      }

      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const reviewCount = Number(reviewSummary.reviewCount || productData?.reviewCount || 0);
  const averageRating =
    reviewCount > 0 ? Number(reviewSummary.averageRating || productData?.averageRating || 0) : 0;
  const wishlisted = isWishlisted(productData?._id);
  const isOutOfStock = Number(productData?.stock || 0) === 0;
  const reviewMediaEnabled =
    serverStatus === 'online' ? Boolean(serverBootstrap?.features?.reviewMediaEnabled) : true;

  const reviewBreakdownMax = useMemo(
    () => Math.max(...reviewSummary.ratingBreakdown.map((item) => Number(item.count || 0)), 1),
    [reviewSummary.ratingBreakdown]
  );
  const reviewMediaPreviewUrls = useMemo(
    () => reviewMediaFiles.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })),
    [reviewMediaFiles]
  );

  useEffect(() => {
    return () => {
      reviewMediaPreviewUrls.forEach((file) => URL.revokeObjectURL(file.url));
    };
  }, [reviewMediaPreviewUrls]);

  if (!productData) {
    if (loadingProductsData) {
      return <div className='border-t-2 pt-10 text-sm text-slate-500'>Loading product details...</div>;
    }

    return (
      <div className='border-t-2 pt-10'>
        <div className='rounded-[32px] border border-slate-200 bg-white p-8 text-center shadow-sm'>
          <p className='text-2xl font-semibold text-slate-900'>Product not found</p>
          <p className='mt-3 text-sm text-slate-500'>
            This product may no longer be active in the storefront catalog.
          </p>
          <button
            type='button'
            onClick={() => navigate('/collection')}
            className='mt-6 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white'
          >
            Browse collection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='border-t-2 pt-10 transition-opacity ease-in duration-500 opacity-100'>
      <div className='flex gap-12 sm:gap-12 flex-col sm:flex-row'>
        <div className='flex-1 flex flex-col-reverse gap-3 sm:flex-row'>
          <div className='flex sm:flex-col overflow-x-auto sm:overflow-y-scroll justify-between sm:justify-normal sm:w-[18.7%] w-full'>
            {productData.image.map((item, index) => (
              <img
                onClick={() => setImage(item)}
                src={item}
                key={index}
                className='w-[24%] sm:w-full sm:mb-3 flex-shrink-0 cursor-pointer'
                alt={`${productData.name} view ${index + 1}`}
              />
            ))}
          </div>
          <div className='w-full sm:w-[80%]'>
            <img className='w-full h-auto rounded-[32px] bg-slate-50' src={image} alt={productData.name} />
          </div>
        </div>

        <div className='flex-1'>
          <h1 className='font-medium text-2xl mt-2'>{productData.name}</h1>
          <div className='mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-500'>
            <span className='px-3 py-1 rounded-full bg-gray-100'>Fresh catalog drop</span>
            {reviewCount > 0 ? (
              <span className='inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-amber-700'>
                <StarRating rating={averageRating} size={14} />
                {averageRating.toFixed(1)} from {reviewCount} reviews
              </span>
            ) : (
              <span className='px-3 py-1 rounded-full bg-slate-100 text-slate-600'>
                Be the first verified buyer to review
              </span>
            )}
          </div>
          <p className='mt-5 text-3xl font-medium'>
            {currency}
            {productData.price}
          </p>
          <p className='mt-5 text-gray-500 md:w-4/5'>{productData.description}</p>

          <div className='mt-5 text-sm text-gray-500 flex flex-col gap-1'>
            <p>
              Category: <span className='text-gray-700'>{productData.category}</span>
            </p>
            <p>
              Style: <span className='text-gray-700'>{productData.subCategory}</span>
            </p>
            <p>
              Stock:{' '}
              <span className={`${isOutOfStock ? 'text-rose-600' : 'text-gray-700'}`}>
                {isOutOfStock ? 'Out of stock' : productData.stock ?? 'Available'}
              </span>
            </p>
          </div>

          <div className='flex flex-col gap-4 my-8'>
            <p>Select Size</p>
            <div className='flex gap-2 flex-wrap'>
              {productData.sizes.map((item, index) => (
                <button
                  onClick={() => setSize(item)}
                  className={`border border-gray-100 py-2 px-4 bg-gray-100 ${
                    item === size ? 'border-orange-500' : ''
                  }`}
                  key={index}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className='flex gap-4 flex-wrap'>
            <button
              onClick={() => addToCart(productData._id, size)}
              disabled={isOutOfStock}
              className='bg-black text-white px-8 py-3 text-sm active:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {isOutOfStock ? 'OUT OF STOCK' : 'ADD TO CART'}
            </button>
            <button
              onClick={buyNow}
              disabled={isOutOfStock}
              className='bg-black text-white px-8 py-3 text-sm active:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50'
            >
              BUY NOW
            </button>
            <button
              onClick={() => toggleWishlist(productData._id)}
              className={`inline-flex items-center gap-2 border px-6 py-3 text-sm ${
                wishlisted ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-gray-300 text-gray-700'
              }`}
            >
              <HeartIcon filled={wishlisted} />
              {wishlisted ? 'SAVED' : 'SAVE FOR LATER'}
            </button>
          </div>

          <hr className='mt-8 sm:w-4/5' />
          <div className='text-sm text-gray-500 mt-5 flex flex-col gap-1'>
            <p>100% original product sourced for the Lavish Fashion catalog.</p>
            <p>Cash on delivery, Stripe, and Razorpay checkout are all supported.</p>
            <p>Easy return and exchange requests can be initiated within 7 days of delivery.</p>
          </div>
        </div>
      </div>

      <div className='mt-20'>
        <div className='flex'>
          <b className='border px-5 py-3 text-sm'>Details</b>
          <p className='border px-5 py-3 text-sm'>Shopping Notes</p>
        </div>
        <div className='flex flex-col gap-4 border px-6 py-6 text-sm text-gray-500'>
          <p>{productData.description}</p>
          <p>
            This product is currently available in {productData.sizes.join(', ')} and belongs to the{' '}
            {productData.category} / {productData.subCategory} lineup.
          </p>
          <p>
            Need sizing help before ordering? Use the contact page and our team will help you pick the
            best fit before checkout.
          </p>
        </div>
      </div>

      <section className='mt-20 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]'>
        <article className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='flex items-start justify-between gap-4'>
            <div>
              <p className='text-lg font-semibold text-slate-900'>Customer reviews</p>
              <p className='text-sm text-slate-500'>Verified post-purchase reviews help shoppers buy with confidence.</p>
            </div>
            {reviewCount > 0 ? (
              <div className='text-right'>
                <p className='text-3xl font-semibold text-slate-900'>{averageRating.toFixed(1)}</p>
                <p className='text-sm text-slate-500'>{reviewCount} published reviews</p>
              </div>
            ) : null}
          </div>

          <div className='mt-5 rounded-[28px] bg-slate-50 p-5'>
            <div className='flex items-center gap-3'>
              <StarRating rating={averageRating} />
              <p className='text-sm text-slate-600'>
                {reviewCount > 0 ? `${averageRating.toFixed(1)} average rating` : 'No published reviews yet'}
              </p>
            </div>

            <div className='mt-5 space-y-3'>
              {reviewSummary.ratingBreakdown.map((item) => (
                <div key={item.rating}>
                  <div className='mb-2 flex items-center justify-between text-sm'>
                    <span className='text-slate-600'>{item.rating} stars</span>
                    <span className='font-medium text-slate-900'>{item.count}</span>
                  </div>
                  <div className='h-3 overflow-hidden rounded-full bg-white'>
                    <div
                      className='h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500'
                      style={{
                        width: `${Math.max((Number(item.count || 0) / reviewBreakdownMax) * 100, item.count ? 12 : 0)}%`,
                      }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className='mt-5 space-y-4'>
            {isLoadingReviews ? (
              <p className='text-sm text-slate-500'>Loading reviews...</p>
            ) : reviews.length === 0 ? (
              <div className='rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500'>
                There are no published reviews for this product yet.
              </div>
            ) : (
              reviews.map((review) => (
                <div key={review._id} className='rounded-[28px] border border-slate-200 p-5'>
                  <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
                    <div>
                      <div className='flex flex-wrap items-center gap-2'>
                        <p className='font-semibold text-slate-900'>{review.title}</p>
                        {review.isVerifiedPurchase ? (
                          <span className='rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-emerald-700'>
                            Verified purchase
                          </span>
                        ) : null}
                      </div>
                      <p className='mt-2 text-sm text-slate-500'>by {review.reviewerName}</p>
                    </div>

                    <div className='text-right'>
                      <StarRating rating={review.rating} size={15} />
                      <p className='mt-2 text-xs uppercase tracking-[0.2em] text-slate-400'>
                        {formatDate(review.createdAt)}
                      </p>
                    </div>
                  </div>

                  <p className='mt-4 text-sm leading-6 text-slate-600'>{review.comment}</p>

                  {Array.isArray(review.media) && review.media.length > 0 ? (
                    <div className='mt-4 grid gap-3 sm:grid-cols-3'>
                      {review.media.map((item, index) => (
                        <a
                          key={`${review._id}-media-${index}`}
                          href={item.url}
                          target='_blank'
                          rel='noreferrer'
                          className='block overflow-hidden rounded-2xl border border-slate-200 bg-slate-50'
                        >
                          <img
                            src={item.url}
                            alt={`${review.title} media ${index + 1}`}
                            className='h-36 w-full object-cover'
                          />
                        </a>
                      ))}
                    </div>
                  ) : null}

                  {review.adminReply ? (
                    <div className='mt-4 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600'>
                      <span className='font-medium text-slate-900'>Brand reply:</span> {review.adminReply}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </article>

        <article className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='flex items-start justify-between gap-4'>
            <div>
              <p className='text-lg font-semibold text-slate-900'>Write a verified review</p>
              <p className='text-sm text-slate-500'>
                Delivered orders are required before you can post a review for this product.
              </p>
            </div>
            {isCheckingEligibility ? (
              <span className='text-sm text-slate-500'>Checking access...</span>
            ) : null}
          </div>

          {!token ? (
            <div className='mt-5 rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500'>
              Login to check if you are eligible to leave a verified review.
            </div>
          ) : reviewEligibility.canReview ? (
            <form onSubmit={submitReview} className='mt-5 space-y-4'>
              <div>
                <p className='mb-2 text-sm text-slate-600'>Your rating</p>
                <select
                  value={reviewForm.rating}
                  onChange={(event) =>
                    setReviewForm((current) => ({ ...current, rating: Number(event.target.value) }))
                  }
                  className='w-full rounded-2xl border border-slate-300 bg-white px-4 py-3'
                >
                  <option value='5'>5 - Excellent</option>
                  <option value='4'>4 - Very good</option>
                  <option value='3'>3 - Good</option>
                  <option value='2'>2 - Fair</option>
                  <option value='1'>1 - Poor</option>
                </select>
              </div>

              <div>
                <p className='mb-2 text-sm text-slate-600'>Review title</p>
                <input
                  value={reviewForm.title}
                  onChange={(event) => setReviewForm((current) => ({ ...current, title: event.target.value }))}
                  className='w-full rounded-2xl border border-slate-300 px-4 py-3'
                  type='text'
                  maxLength='120'
                  placeholder='How did the fit, fabric, or finish feel?'
                  required
                />
              </div>

              <div>
                <p className='mb-2 text-sm text-slate-600'>Your review</p>
                <textarea
                  value={reviewForm.comment}
                  onChange={(event) => setReviewForm((current) => ({ ...current, comment: event.target.value }))}
                  className='min-h-40 w-full rounded-2xl border border-slate-300 px-4 py-3'
                  maxLength='1500'
                  placeholder='Share details that would help other shoppers with fit, comfort, styling, and quality.'
                  required
                />
              </div>

              <div>
                <div className='flex items-center justify-between gap-4'>
                  <p className='mb-2 text-sm text-slate-600'>Add photos</p>
                  <span className='text-xs uppercase tracking-[0.2em] text-slate-400'>Optional, up to 3 images</span>
                </div>
                <input
                  ref={reviewMediaInputRef}
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []).slice(0, 3);
                    setReviewMediaFiles(files);

                    if (Array.from(event.target.files || []).length > 3) {
                      toast.info('Only the first 3 images will be attached to your review');
                    }
                  }}
                  className='w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm'
                  type='file'
                  accept='image/png,image/jpeg,image/webp,image/gif'
                  multiple
                  disabled={!reviewMediaEnabled}
                />
                <p className='mt-2 text-xs text-slate-500'>
                  {reviewMediaEnabled
                    ? 'Upload fit shots, fabric details, or styling photos. Each image can be up to 5 MB.'
                    : 'Review photo uploads are currently unavailable because media storage is not configured on the server.'}
                </p>

                {reviewMediaPreviewUrls.length > 0 ? (
                  <div className='mt-4 grid gap-3 sm:grid-cols-3'>
                    {reviewMediaPreviewUrls.map((file, index) => (
                      <div
                        key={`${file.name}-${index}`}
                        className='overflow-hidden rounded-2xl border border-slate-200 bg-slate-50'
                      >
                        <img src={file.url} alt={`Review upload preview ${index + 1}`} className='h-32 w-full object-cover' />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <button
                type='submit'
                disabled={isSubmittingReview}
                className='rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-60'
              >
                {isSubmittingReview ? 'Submitting review...' : 'Submit review'}
              </button>
            </form>
          ) : (
            <div className='mt-5 space-y-4'>
              <div className='rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500'>
                {reviewEligibility.reason ||
                  'A delivered order is required before a verified review can be submitted.'}
              </div>

              {reviewEligibility.alreadyReviewed ? (
                <div className='rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800'>
                  Your latest review status: <span className='font-semibold capitalize'>{reviewEligibility.reviewStatus}</span>
                </div>
              ) : (
                <button
                  type='button'
                  onClick={() => navigate('/orders')}
                  className='rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700'
                >
                  Review your orders
                </button>
              )}
            </div>
          )}
        </article>
      </section>

      <RelatedProducts category={productData.category} subCategory={productData.subCategory} />
    </div>
  );
};

export default Product;
