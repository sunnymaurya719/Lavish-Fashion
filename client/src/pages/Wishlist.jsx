import React, { useContext } from 'react';
import { ShopContext } from '../context/ShopContext';
import Title from '../components/Title';
import ProductShimmer from '../components/ProductShimmer';

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const Wishlist = () => {
  const { loadingProductsData, loadingWishlist, navigate, products, token, toggleWishlist, wishlistItems } =
    useContext(ShopContext);

  if (!token) {
    return (
      <div className='min-h-[70vh] flex flex-col items-center justify-center text-center px-4 border-t'>
        <h2 className='text-2xl font-semibold mb-2'>Login Required</h2>
        <p className='text-gray-600 mb-6'>Please login to view the products you have saved for later.</p>
        <button
          onClick={() => navigate('/login')}
          className='bg-black text-white px-8 py-3 text-sm rounded hover:bg-gray-800 transition'
        >
          LOGIN TO CONTINUE
        </button>
      </div>
    );
  }

  const wishlistProducts = products.filter((product) => wishlistItems.includes(product._id));

  return (
    <div className='border-t pt-12'>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <Title text1='YOUR' text2='WISHLIST' />
          <p className='mt-3 max-w-2xl text-sm text-slate-500'>
            Saved styles stay synced with your account so you can return to them anytime across devices.
          </p>
        </div>

        <div className='rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600'>
          {wishlistItems.length} item{wishlistItems.length === 1 ? '' : 's'} saved
        </div>
      </div>

      {loadingProductsData || loadingWishlist ? (
        <div className='mt-10 grid grid-cols-2 gap-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4'>
          {Array.from({ length: 4 }).map((_, index) => (
            <ProductShimmer key={index} />
          ))}
        </div>
      ) : wishlistProducts.length === 0 ? (
        <div className='mt-12 rounded-[32px] border border-slate-200 bg-white px-6 py-12 text-center shadow-sm'>
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
        <div className='mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3'>
          {wishlistProducts.map((product) => (
            <article key={product._id} className='rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm'>
              <div className='flex gap-4'>
                <img
                  src={product.image?.[0]}
                  alt={product.name}
                  className='h-28 w-24 rounded-3xl border border-slate-200 object-cover'
                />
                <div className='min-w-0 flex-1'>
                  <p className='text-lg font-semibold text-slate-900'>{product.name}</p>
                  <p className='mt-1 text-sm text-slate-500'>
                    {product.category} / {product.subCategory}
                  </p>
                  <p className='mt-3 text-xl font-semibold text-slate-900'>{formatCurrency(product.price)}</p>
                  <p className='mt-3 text-sm text-slate-500'>{product.description}</p>
                </div>
              </div>

              <div className='mt-5 flex flex-wrap gap-3'>
                <button
                  type='button'
                  onClick={() => navigate(`/product/${product._id}`)}
                  className='rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white'
                >
                  View product
                </button>
                <button
                  type='button'
                  onClick={() => toggleWishlist(product._id)}
                  className='rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700'
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
