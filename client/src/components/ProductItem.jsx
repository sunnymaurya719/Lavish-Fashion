import React, { memo, useContext } from 'react';
import { ShopContext } from '../context/ShopContext';
import { Link } from 'react-router-dom';
import { prefetchRoute } from '../utils/prefetchRoutes';

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

const StarIcon = () => (
  <svg width='14' height='14' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
    <path
      d='m12 3.5 2.63 5.33 5.88.86-4.25 4.14 1 5.86L12 17l-5.26 2.69 1-5.86L3.5 9.69l5.88-.86L12 3.5Z'
      fill='currentColor'
    />
  </svg>
);

const ProductItem = ({ id, image, name, price, averageRating = 0, reviewCount = 0 }) => {
  const { currency, isWishlisted, toggleWishlist } = useContext(ShopContext);
  const wishlisted = isWishlisted(id);

  return (
    <div className='group relative'>
      <button
        type='button'
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleWishlist(id);
        }}
        className={`absolute right-3 top-3 z-10 rounded-full border p-2 backdrop-blur transition ${
          wishlisted
            ? 'border-rose-200 bg-rose-50 text-rose-700'
            : 'border-white/70 bg-white/90 text-slate-600 hover:text-slate-900'
        }`}
        aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
      >
        <HeartIcon filled={wishlisted} />
      </button>

      <Link className='text-gray-700 cursor-pointer block' to={`/product/${id}`} onMouseEnter={() => prefetchRoute('/product')}>
        <div className='overflow-hidden rounded-2xl bg-slate-50'>
          <img className='hover:scale-110 transition ease-in-out' src={image[0]} alt={name} loading='lazy' />
        </div>
        <p className='pt-3 pb-1 text-sm'>{name}</p>
        <p className='text-sm font-medium'>
          {currency}
          {price}
        </p>
        <div className='mt-2 flex items-center gap-2 text-xs text-slate-500'>
          {reviewCount > 0 ? (
            <>
              <span className='inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-amber-700'>
                <StarIcon />
                {Number(averageRating || 0).toFixed(1)}
              </span>
              <span>{reviewCount} reviews</span>
            </>
          ) : (
            <span className='rounded-full bg-slate-100 px-2.5 py-1 text-slate-600'>New arrival</span>
          )}
        </div>
      </Link>
    </div>
  );
};

export default memo(ProductItem);
