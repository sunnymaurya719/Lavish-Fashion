import React, { useCallback, useContext, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import FitAssistantModal from '../components/fit/FitAssistantModal';
import { ShopContext } from '../context/ShopContext';
import { getFitInsights as getFitInsightsRequest } from '../services/fitApi';
import { isFitRolloutActiveForProduct } from '../utils/fitRollout';
import useScrollToTop from '../hooks/useScrollToTop';

const RelatedProducts = lazy(() => import('../components/RelatedProducts'));

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

const IMAGE_SWIPE_THRESHOLD = 40;

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
const formatFitBiasLabel = (value) => {
  if (value === 'runs_small') {
    return 'Runs small';
  }

  if (value === 'runs_large') {
    return 'Runs large';
  }

  return 'True to size';
};

const Product = () => {
  const { productId } = useParams();
  const {
    BACKEND_URL,
    products,
    currency,
    addToCart,
    cartItems,
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
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [isImageZoomed, setIsImageZoomed] = useState(false);
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
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const [isFitAssistantOpen, setIsFitAssistantOpen] = useState(false);
  const [appliedFitSelection, setAppliedFitSelection] = useState(null);
  const [fitInsights, setFitInsights] = useState(null);
  const imageTouchStartXRef = useRef(null);
  const imageTouchDeltaXRef = useRef(0);
  const swipeHintTimerRef = useRef(null);
  const reviewMediaInputRef = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  const isInCart = productData && size ? (cartItems[productData._id]?.[size] || 0) > 0 : false;

  const handleAddToCart = useCallback(async () => {
    if (isInCart && !justAdded) {
      navigate('/cart');
      return;
    }
    const success = await addToCart(
      productData._id,
      size,
      appliedFitSelection?.selectedSize === size ? appliedFitSelection.fitAssistant : null
    );
    if (success) {
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 1500);
    }
  }, [addToCart, productData, size, appliedFitSelection, isInCart, justAdded, navigate]);

  useScrollToTop([productId]);

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
      toast.sizeRequired();
      return;
    }

    if (Number(productData?.stock || 0) === 0) {
      toast.error('This product is currently out of stock');
      return;
    }

    navigate('/place-order', {
      state: {
        buyNow: true,
        product: {
          ...productData,
          size,
          ...(appliedFitSelection?.selectedSize === size ? { fitAssistant: appliedFitSelection.fitAssistant } : {}),
        },
      },
    });
  };

  useEffect(() => {
    const matchedProduct = products.find((item) => item._id === productId);

    if (!matchedProduct) {
      return;
    }

    setProductData(matchedProduct);
    setActiveImageIndex(0);
    setIsImageZoomed(false);
    setIsFitAssistantOpen(false);
    setAppliedFitSelection(null);
    setImageLoaded(false);
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
  const imageList = useMemo(
    () => (Array.isArray(productData?.image) && productData.image.length ? productData.image : []),
    [productData?.image]
  );
  const activeImage = imageList[activeImageIndex] || imageList[0] || '';
  const sizeOptions = useMemo(() => (Array.isArray(productData?.sizes) ? productData.sizes : []), [productData?.sizes]);
  const fitRolloutEnabled =
    serverStatus === 'online'
      ? isFitRolloutActiveForProduct({
          productId: productData?._id,
          rolloutPercent: serverBootstrap?.rollout?.fitRolloutPercent,
        })
      : true;
  const fitAssistantEnabled =
    Boolean(productData?.fitEnabled) &&
    Boolean(productData?.fitProfileSummary?.ready) &&
    fitRolloutEnabled &&
    (serverStatus === 'online' ? Boolean(serverBootstrap?.features?.fitAssistantEnabled) : true);
  const fitCameraEnabled =
    fitAssistantEnabled &&
    (serverStatus === 'online'
      ? Boolean(serverBootstrap?.features?.fitCameraEnabled) &&
        Boolean(serverBootstrap?.integrations?.mlServiceEnabled) &&
        Boolean(serverBootstrap?.integrations?.mlServiceHealthy)
      : false);
  const fitInsightsEnabled =
    fitAssistantEnabled &&
    (serverStatus === 'online' ? Boolean(serverBootstrap?.features?.fitInsightsEnabled) : false);
  const appliedFitConfidence = useMemo(() => {
    const confidence = Number(appliedFitSelection?.fitAssistant?.confidence || 0);
    return confidence > 0 ? Math.round(confidence * 100) : null;
  }, [appliedFitSelection?.fitAssistant?.confidence]);
  const fitAssistantSteps = useMemo(
    () =>
      fitCameraEnabled
        ? ['Add your details', 'Take an optional quick scan', 'Review the best size']
        : ['Add your details', 'Choose your fit preference', 'Review the best size'],
    [fitCameraEnabled]
  );
  const descriptionPoints = useMemo(
    () => [
      productData?.description,
      `Tailored for the ${String(productData?.category || '').toLowerCase()} wardrobe with a ${String(
        productData?.subCategory || ''
      ).toLowerCase()} silhouette.`,
      `Available sizes: ${sizeOptions.join(', ') || 'Standard sizing options'}.`,
    ].filter(Boolean),
    [productData?.category, productData?.description, productData?.subCategory, sizeOptions]
  );
  const detailPoints = useMemo(
    () => [
      `Category: ${productData?.category || 'N/A'}`,
      `Style: ${productData?.subCategory || 'N/A'}`,
      `Stock status: ${isOutOfStock ? 'Out of stock' : `${productData?.stock ?? 'Available'} units available`}`,
      '100% original product sourced for the Lavish Fashion catalog.',
      'Cash on delivery, Stripe, and Razorpay checkout are supported.',
      'Easy return and exchange requests can be initiated within 7 days of delivery.',
    ],
    [isOutOfStock, productData?.category, productData?.stock, productData?.subCategory]
  );

  const selectImageByIndex = useCallback(
    (index) => {
      if (!imageList.length) {
        return;
      }

      setActiveImageIndex((index + imageList.length) % imageList.length);
      setIsImageZoomed(false);
      setShowSwipeHint(false);
      setImageLoaded(false);
    },
    [imageList.length]
  );

  const handleSizeSelection = useCallback((nextSize) => {
    setSize(nextSize);
    setAppliedFitSelection((currentSelection) =>
      currentSelection?.selectedSize === nextSize ? currentSelection : null
    );
  }, []);

  useEffect(() => {
    if (!productData?._id || !fitInsightsEnabled) {
      setFitInsights(null);
      return;
    }

    let isActive = true;

    const fetchFitInsights = async () => {
      try {
        const response = await getFitInsightsRequest({
          backendUrl: BACKEND_URL,
          productId: productData._id,
        });

        if (isActive && response.success) {
          setFitInsights(response.insights || null);
        }
      } catch {
        if (isActive) {
          setFitInsights(null);
        }
      }
    };

    fetchFitInsights();

    return () => {
      isActive = false;
    };
  }, [BACKEND_URL, fitInsightsEnabled, productData?._id]);

  const handleImageTouchStart = (event) => {
    imageTouchStartXRef.current = event.touches?.[0]?.clientX ?? null;
    imageTouchDeltaXRef.current = 0;
    setShowSwipeHint(false);
  };

  const handleImageTouchMove = (event) => {
    if (imageTouchStartXRef.current === null) {
      return;
    }

    const currentX = event.touches?.[0]?.clientX ?? imageTouchStartXRef.current;
    imageTouchDeltaXRef.current = currentX - imageTouchStartXRef.current;
  };

  const handleImageTouchEnd = () => {
    if (Math.abs(imageTouchDeltaXRef.current) >= IMAGE_SWIPE_THRESHOLD && imageList.length > 1) {
      if (imageTouchDeltaXRef.current > 0) {
        selectImageByIndex(activeImageIndex - 1);
      } else {
        selectImageByIndex(activeImageIndex + 1);
      }
    }

    imageTouchStartXRef.current = null;
    imageTouchDeltaXRef.current = 0;
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    if (imageList.length < 2) {
      setShowSwipeHint(false);
      return undefined;
    }

    const storageKey = 'lf-product-swipe-hint-shown';
    const hasSeenHint = window.localStorage.getItem(storageKey) === '1';

    if (hasSeenHint) {
      return undefined;
    }

    setShowSwipeHint(true);
    window.localStorage.setItem(storageKey, '1');
    swipeHintTimerRef.current = window.setTimeout(() => {
      setShowSwipeHint(false);
    }, 2600);

    return () => {
      if (swipeHintTimerRef.current) {
        window.clearTimeout(swipeHintTimerRef.current);
        swipeHintTimerRef.current = null;
      }
    };
  }, [imageList.length, productId]);

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
      return (
        <div className='pt-6'>
          <div className='grid gap-7 lg:grid-cols-[1.03fr_0.97fr]'>
            <div className='space-y-3'>
              <div className='relative aspect-[4/5] overflow-hidden rounded-[32px] bg-slate-100'>
                <div className='absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent'></div>
              </div>
              <div className='flex gap-2 overflow-hidden'>
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className='relative h-20 w-20 overflow-hidden rounded-2xl bg-slate-100'>
                    <div className='absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent'></div>
                  </div>
                ))}
              </div>
            </div>

            <div className='space-y-5 pt-2'>
              <div className='space-y-3'>
                <div className='h-3 w-24 rounded-full bg-slate-200'></div>
                <div className='h-11 w-[82%] rounded-2xl bg-slate-200'></div>
              </div>
              <div className='h-5 w-36 rounded-full bg-slate-200'></div>
              <div className='h-10 w-32 rounded-full bg-slate-200'></div>
              <div className='space-y-2 pt-2'>
                <div className='h-4 w-full rounded-full bg-slate-100'></div>
                <div className='h-4 w-[88%] rounded-full bg-slate-100'></div>
                <div className='h-4 w-[74%] rounded-full bg-slate-100'></div>
              </div>
              <div className='space-y-3 pt-2'>
                <div className='h-3 w-20 rounded-full bg-slate-200'></div>
                <div className='flex gap-2.5'>
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className='h-10 w-16 rounded-full bg-slate-100'></div>
                  ))}
                </div>
              </div>
              <div className='grid grid-cols-2 gap-3 pt-2'>
                <div className='h-12 rounded-full bg-slate-100'></div>
                <div className='h-12 rounded-full bg-slate-200'></div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className='pt-10'>
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
    <div className='pt-6 pb-28 sm:pb-0 transition-opacity ease-in duration-500 opacity-100'>
      <section className='grid gap-7 lg:grid-cols-[1.03fr_0.97fr]'>
        <div className='space-y-3'>
          <div
            className='relative overflow-hidden rounded-[32px] bg-[#f5f5f5]'
            onTouchStart={handleImageTouchStart}
            onTouchMove={handleImageTouchMove}
            onTouchEnd={handleImageTouchEnd}
          >
            {!imageLoaded && (
              <div className='absolute inset-0 z-[1] bg-slate-100'>
                <div className='absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent'></div>
              </div>
            )}
            <img
              src={activeImage}
              alt={productData.name}
              loading='eager'
              fetchpriority='high'
              onLoad={() => setImageLoaded(true)}
              onClick={() => setIsImageZoomed((current) => !current)}
              className={`w-full aspect-[4/5] object-cover cursor-zoom-in transition-transform duration-500 ${
                isImageZoomed ? 'scale-110' : 'scale-100'
              }`}
            />

            <button
              type='button'
              onClick={() => setIsImageZoomed((current) => !current)}
              className='absolute right-4 top-4 rounded-full bg-white/85 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-slate-600 backdrop-blur-sm'
            >
              {isImageZoomed ? 'Reset' : 'Zoom'}
            </button>

            {showSwipeHint && imageList.length > 1 ? (
              <div className='absolute left-1/2 -translate-x-1/2 bottom-14 rounded-full bg-white/90 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-slate-600 shadow-sm backdrop-blur-sm'>
                Swipe for more photos
              </div>
            ) : null}

            {imageList.length > 1 ? (
              <div className='absolute left-1/2 -translate-x-1/2 bottom-4 z-10 flex items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 backdrop-blur-sm'>
                {imageList.map((item, index) => (
                  <button
                    key={`${item}-${index}`}
                    type='button'
                    onClick={() => selectImageByIndex(index)}
                    className={`h-2.5 rounded-full transition-all ${
                      index === activeImageIndex ? 'w-6 bg-[#111]' : 'w-2.5 bg-[#111]/30'
                    }`}
                    aria-label={`View product image ${index + 1}`}
                  ></button>
                ))}
              </div>
            ) : null}
          </div>

          {imageList.length > 1 ? (
            <div className='flex snap-x snap-mandatory gap-2 overflow-x-auto py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:snap-none'>
              {imageList.map((item, index) => (
                <button
                  key={`${item}-thumb-${index}`}
                  type='button'
                  onClick={() => {
                    setShowSwipeHint(false);
                    selectImageByIndex(index);
                  }}
                  className={`h-auto w-[calc((100%-1.5rem)/4)] shrink-0 snap-start overflow-hidden rounded-2xl border-2 transition-all sm:h-20 sm:w-20 ${
                    index === activeImageIndex
                      ? 'border-[#111] opacity-100'
                      : 'border-transparent opacity-80 hover:opacity-100'
                  }`}
                >
                  <img
                    src={item}
                    alt={`${productData.name} thumbnail ${index + 1}`}
                    loading='lazy'
                    className='aspect-square h-full w-full object-cover bg-[#f5f5f5]'
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className='flex flex-col gap-5'>
          <div className='flex items-start justify-between gap-4'>
            <div>
              <p className='text-[11px] uppercase tracking-[0.24em] text-[#7b7b7b]'>{productData.category}</p>
              <h1 className='mt-2 text-[2rem] sm:text-[2.4rem] leading-[1.05] font-semibold tracking-[-0.015em] text-[#111]'>
                {productData.name}
              </h1>
            </div>

            <button
              type='button'
              onClick={() => toggleWishlist(productData._id)}
              className={`mt-1 inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
                wishlisted ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
            >
              <HeartIcon filled={wishlisted} />
            </button>
          </div>

          <div className='flex flex-wrap items-center gap-3 text-sm text-slate-500'>
            <StarRating rating={averageRating} size={15} />
            <span>{reviewCount > 0 ? `${averageRating.toFixed(1)} (${reviewCount} reviews)` : 'No reviews yet'}</span>
          </div>

          <p className='text-4xl font-semibold tracking-tight text-[#111]'>
            {currency}
            {productData.price}
          </p>

          <div className='space-y-3'>
            <p className='text-[11px] uppercase tracking-[0.24em] text-[#777]'>Select Size</p>
            <div className='flex flex-wrap gap-2.5'>
              {sizeOptions.map((item, index) => (
                <button
                  key={`${item}-${index}`}
                  type='button'
                  onClick={() => handleSizeSelection(item)}
                  className={`rounded-full px-5 py-2.5 text-sm transition-all ${
                    item === size
                      ? 'bg-[#111] text-white shadow-[0_10px_22px_rgba(17,17,17,0.22)]'
                      : 'bg-[#f3f3f3] text-[#3f3f3f] hover:bg-[#e9e9e9]'
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {fitAssistantEnabled ? (
            <div className='rounded-[30px] border border-slate-200 bg-slate-50 p-4 sm:p-5'>
              <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
                <div className='max-w-2xl'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <p className='text-[11px] uppercase tracking-[0.24em] text-slate-500'>Need fit help?</p>
                    <span className='rounded-full bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600 ring-1 ring-slate-200'>
                      {fitCameraEnabled ? 'Guided with optional scan' : 'Guided measurements only'}
                    </span>
                  </div>
                  <p className='mt-2 text-lg font-semibold text-slate-900'>Get a step-by-step size recommendation</p>
                  <p className='mt-2 text-sm leading-6 text-slate-600'>
                    The assistant now walks shoppers through each step clearly, so they always know what comes next.
                    {fitCameraEnabled
                      ? ' You can start with your details and add a quick camera scan only if you want extra precision.'
                      : ' It uses your measurements and fit preference to recommend the best size.'}
                  </p>
                </div>

                <button
                  type='button'
                  onClick={() => setIsFitAssistantOpen(true)}
                  className='rounded-full bg-white px-5 py-3 text-sm font-medium uppercase tracking-[0.12em] text-slate-900 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-100'
                >
                  {appliedFitSelection ? 'Refine My Size' : 'Start Guided Fit'}
                </button>
              </div>

              <div className='mt-4 grid gap-3 sm:grid-cols-3'>
                {fitAssistantSteps.map((step, index) => (
                  <div key={step} className='rounded-[22px] bg-white px-4 py-4 ring-1 ring-slate-200/80'>
                    <p className='text-[10px] uppercase tracking-[0.18em] text-slate-400'>{`Step 0${index + 1}`}</p>
                    <p className='mt-2 text-sm font-medium leading-6 text-slate-700'>{step}</p>
                  </div>
                ))}
              </div>

              {appliedFitSelection ? (
                <div className='mt-4 rounded-[22px] bg-white px-4 py-4 ring-1 ring-slate-200/80'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <p className='text-[11px] uppercase tracking-[0.22em] text-slate-500'>Assistant selected</p>
                    <span className='rounded-full bg-slate-950 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-white'>
                      Size {appliedFitSelection.selectedSize}
                    </span>
                  </div>
                  <p className='mt-3 text-sm leading-6 text-slate-600'>
                    {appliedFitSelection.fitAssistant?.source === 'hybrid'
                      ? 'Recommended from your measurements and scan.'
                      : 'Recommended from your measurements.'}
                    {appliedFitConfidence ? ` Confidence: ${appliedFitConfidence}%.` : ''}
                  </p>
                </div>
              ) : null}

              {fitInsightsEnabled && (fitInsights?.crowdSignal || fitInsights?.fitBias) ? (
                <div className='mt-4 rounded-[22px] bg-white px-4 py-4 ring-1 ring-slate-200/80'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <p className='text-[11px] uppercase tracking-[0.22em] text-slate-500'>Fit notes</p>
                    {fitInsights?.fitBias ? (
                      <span className='rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-700'>
                        {formatFitBiasLabel(fitInsights.fitBias)}
                      </span>
                    ) : null}
                  </div>

                  {fitInsights?.crowdSignal ? (
                    <p className='mt-3 text-sm leading-6 text-slate-600'>{fitInsights.crowdSignal}</p>
                  ) : (
                    <p className='mt-3 text-sm leading-6 text-slate-600'>
                      This fit note is based on the product&apos;s measurement profile and verified shopper feedback.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className='hidden grid-cols-2 gap-3 sm:grid'>
            <button
              type='button'
              onClick={handleAddToCart}
              disabled={isOutOfStock || justAdded}
              className={`rounded-full border px-5 py-3 text-sm font-medium tracking-[0.08em] uppercase transition disabled:cursor-not-allowed disabled:opacity-50 ${
                justAdded
                  ? 'border-emerald-500 bg-emerald-500 text-white'
                  : isInCart
                    ? 'border-[#111] bg-[#111] text-white hover:bg-[#262626]'
                    : 'border-[#111] bg-white text-[#111] hover:bg-[#111] hover:text-white'
              }`}
            >
              {justAdded ? (
                <span className='flex items-center justify-center gap-1.5'>
                  <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>
                  Added
                </span>
              ) : isInCart ? (
                <span className='flex items-center justify-center gap-1.5'>
                  <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>
                  Go to Cart
                </span>
              ) : 'Add To Cart'}
            </button>
            <button
              type='button'
              onClick={buyNow}
              disabled={isOutOfStock}
              className='rounded-full bg-[#111] px-5 py-3 text-sm font-medium tracking-[0.08em] uppercase text-white transition hover:bg-[#262626] disabled:cursor-not-allowed disabled:opacity-50'
            >
              Buy Now
            </button>
          </div>

          <div className='inline-flex w-fit items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600'>
            <span className={`h-2 w-2 rounded-full ${isOutOfStock ? 'bg-rose-500' : 'bg-emerald-500'}`}></span>
            {isOutOfStock ? 'Out of stock' : `${productData.stock ?? 'Limited'} in stock`}
          </div>

          <p className='text-[15px] leading-7 text-slate-600'>{productData.description}</p>
        </div>
      </section>

      <section className='mt-10 grid gap-4 sm:grid-cols-2'>
        <article className='rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]'>
          <p className='text-[11px] uppercase tracking-[0.24em] text-[#777]'>Description</p>
          <ul className='mt-4 space-y-3 text-sm leading-6 text-slate-600'>
            {descriptionPoints.map((point, index) => (
              <li key={`description-${index}`} className='flex gap-2.5'>
                <span className='mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400'></span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className='rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]'>
          <p className='text-[11px] uppercase tracking-[0.24em] text-[#777]'>Details</p>
          <ul className='mt-4 space-y-3 text-sm leading-6 text-slate-600'>
            {detailPoints.map((point, index) => (
              <li key={`details-${index}`} className='flex gap-2.5'>
                <span className='mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400'></span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>

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
                            loading='lazy'
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

      <div className='fixed bottom-0 left-0 right-0 z-40 sm:hidden'>
        <div className='flex items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_20px_rgba(15,23,42,0.08)] backdrop-blur-lg'>
          <div className='min-w-0 flex-1'>
            <p className='text-xl font-semibold leading-none text-[#111]'>
              {currency}
              {productData.price}
            </p>
            <p className='mt-1.5 truncate text-[10px] uppercase tracking-[0.18em] text-slate-500'>
              {size ? `Size ${size}` : 'Select size above'}
            </p>
          </div>

          <button
            type='button'
            onClick={handleAddToCart}
            disabled={isOutOfStock || justAdded}
            className={`rounded-full border px-4 py-2.5 text-xs font-medium uppercase tracking-[0.1em] transition disabled:opacity-45 ${
              justAdded
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : isInCart
                  ? 'border-[#111] bg-[#111] text-white'
                  : 'border-[#111] bg-white text-[#111]'
            }`}
          >
            {justAdded ? (
              <span className='flex items-center justify-center gap-1'>
                <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>
                Added
              </span>
            ) : isInCart ? (
              <span className='flex items-center justify-center gap-1'>
                <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>
                Go to Cart
              </span>
            ) : 'Add to Cart'}
          </button>
          <button
            type='button'
            onClick={buyNow}
            disabled={isOutOfStock}
            className='rounded-full bg-[#111] px-5 py-2.5 text-xs font-medium uppercase tracking-[0.1em] text-white disabled:opacity-45'
          >
            Buy Now
          </button>
        </div>
      </div>

      <Suspense fallback={<div className='my-20 text-center text-sm text-slate-400'>Loading recommendations...</div>}>
        <RelatedProducts category={productData.category} subCategory={productData.subCategory} />
      </Suspense>

      <FitAssistantModal
        isOpen={isFitAssistantOpen}
        onClose={() => setIsFitAssistantOpen(false)}
        product={productData}
        backendUrl={BACKEND_URL}
        token={token}
        toast={toast}
        onApplySize={({ size: recommendedSize, fitAssistant }) => {
          setSize(recommendedSize);
          setAppliedFitSelection(
            fitAssistant
              ? {
                  selectedSize: recommendedSize,
                  fitAssistant,
                }
              : null
          );
        }}
        cameraEnabled={fitCameraEnabled}
      />
    </div>
  );
};

export default Product;
