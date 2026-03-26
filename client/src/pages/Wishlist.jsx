import React, { useContext } from 'react';
import { ShopContext } from '../context/ShopContext';
import ProductShimmer from '../components/ProductShimmer';

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const twoLineClampStyle = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const fourLineClampStyle = {
  display: '-webkit-box',
  WebkitLineClamp: 4,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const Wishlist = () => {
  const { loadingProductsData, loadingWishlist, navigate, products, token, toggleWishlist, wishlistItems } =
    useContext(ShopContext);

  if (!token) {
    return (
      <div className='wishlist-shell min-h-[70vh] flex flex-col items-center justify-center text-center px-4'>
        <h2 className='text-3xl font-semibold text-slate-900'>Wishlist</h2>
        <p className='mt-2 text-base text-slate-600'>Saved styles for later</p>
        <p className='mt-4 max-w-md text-sm text-slate-500'>Please login to view the products you have saved for later.</p>
        <button
          onClick={() => navigate('/login')}
          className='mt-6 rounded-full bg-slate-950 px-8 py-3 text-sm font-medium text-white transition hover:bg-slate-800'
        >
          LOGIN TO CONTINUE
        </button>
      </div>
    );
  }

  const wishlistProducts = products.filter((product) => wishlistItems.includes(product._id));

  return (
    <div className='wishlist-shell pt-8 sm:pt-10 pb-14'>
      <div className='wishlist-entrance wishlist-delay-0 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <h1 className='text-[2rem] sm:text-[2.35rem] font-semibold tracking-[-0.015em] text-[#111] leading-none'>
            Wishlist
          </h1>
          <p className='mt-2 text-sm text-slate-500'>Saved styles for later</p>
          <p className='mt-3 max-w-2xl text-sm text-slate-500'>
            Saved styles stay synced with your account so you can return to them anytime across devices.
          </p>
        </div>

        <div className='wishlist-entrance wishlist-delay-1 w-full sm:w-auto rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 text-center'>
          {wishlistItems.length} item{wishlistItems.length === 1 ? '' : 's'} saved
        </div>
      </div>

      {loadingProductsData || loadingWishlist ? (
        <div className='wishlist-entrance wishlist-delay-1 mt-10 grid grid-cols-2 gap-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4'>
          {Array.from({ length: 4 }).map((_, index) => (
            <ProductShimmer key={index} />
          ))}
        </div>
      ) : wishlistProducts.length === 0 ? (
        <div className='wishlist-entrance wishlist-delay-2 mt-12 rounded-[32px] border border-slate-200 bg-white px-6 py-12 text-center shadow-sm'>
          <h2 className='text-xl font-semibold text-slate-900'>Your wishlist is empty</h2>
          <p className='mt-3 text-sm text-slate-500'>
            Save products from collection or product pages and they will show up here.
          </p>
          <button
            type='button'
            onClick={() => navigate('/collection')}
            className='mt-6 rounded-2xl bg-slate-950 px-6 py-3 text-sm font-medium text-white'
          >
            BROWSE COLLECTION
          </button>
        </div>
      ) : (
        <div className='mt-8 grid grid-cols-1 gap-4 md:mt-10 md:grid-cols-2 xl:grid-cols-3'>
          {wishlistProducts.map((product, index) => (
            <article
              key={product._id}
              className='wishlist-entrance rounded-[26px] border border-slate-200 bg-white p-4 sm:rounded-[30px] sm:p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]'
              style={{ animationDelay: `${Math.min(0.14 + index * 0.05, 0.44)}s` }}
            >
              <div className='flex gap-3 sm:gap-4'>
                <img
                  src={product.image?.[0]}
                  alt={product.name}
                  className='h-24 w-20 shrink-0 rounded-2xl border border-slate-200 object-cover sm:h-28 sm:w-24 sm:rounded-3xl'
                />
                <div className='min-w-0 flex-1'>
                  <p className='text-base sm:text-lg font-semibold text-slate-900 leading-6 sm:leading-7' style={twoLineClampStyle}>
                    {product.name}
                  </p>
                  <p className='mt-1 text-sm text-slate-500'>
                    {product.category} / {product.subCategory}
                  </p>
                  <p className='mt-2 text-2xl sm:text-xl font-semibold text-slate-900'>{formatCurrency(product.price)}</p>
                  <p className='mt-2 text-sm leading-6 text-slate-500' style={fourLineClampStyle}>
                    {product.description}
                  </p>
                </div>
              </div>

              <div className='mt-4 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3'>
                <button
                  type='button'
                  onClick={() => navigate(`/product/${product._id}`)}
                  className='rounded-full bg-slate-950 px-3 py-2.5 sm:px-4 sm:py-3 text-sm font-medium text-white'
                >
                  View product
                </button>
                <button
                  type='button'
                  onClick={() => toggleWishlist(product._id)}
                  className='rounded-full border border-slate-300 px-3 py-2.5 sm:px-4 sm:py-3 text-sm font-medium text-slate-700'
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

export default Wishlist;
