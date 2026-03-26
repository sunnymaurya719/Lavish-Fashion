import React, { useContext, useMemo, useState } from 'react';
import { ShopContext } from '../context/ShopContext';

const FREE_DELIVERY_THRESHOLD = 999;

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const Cart = () => {
  const {
    cartItems,
    delivery_fee,
    isWishlisted,
    loadingProductsData,
    navigate,
    products,
    toggleWishlist,
    updateQuantity,
  } = useContext(ShopContext);
  const [savingItemKey, setSavingItemKey] = useState('');

  const cartData = useMemo(() => {
    const tempData = [];

    for (const itemId in cartItems) {
      for (const size in cartItems[itemId]) {
        if (Number(cartItems[itemId][size] || 0) > 0) {
          tempData.push({
            _id: itemId,
            size,
            quantity: Number(cartItems[itemId][size] || 0),
          });
        }
      }
    }

    return tempData;
  }, [cartItems]);

  const cartLines = useMemo(
    () =>
      cartData.map((line) => ({
        ...line,
        product: products.find((productItem) => productItem._id === line._id) || null,
      })),
    [cartData, products]
  );

  const itemCount = useMemo(
    () => cartData.reduce((count, item) => count + Number(item.quantity || 0), 0),
    [cartData]
  );

  const subtotal = useMemo(
    () =>
      cartLines.reduce(
        (total, line) => total + Number(line.product?.price || 0) * Number(line.quantity || 0),
        0
      ),
    [cartLines]
  );

  const deliveryFee = subtotal === 0 ? 0 : subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : Number(delivery_fee || 0);
  const total = subtotal + deliveryFee;
  const freeDeliveryUnlocked = subtotal >= FREE_DELIVERY_THRESHOLD;
  const amountToFreeDelivery = Math.max(0, FREE_DELIVERY_THRESHOLD - subtotal);

  const handleQuantityChange = (line, nextQuantity) => {
    const normalized = Math.max(0, Math.min(99, Number(nextQuantity || 0)));
    updateQuantity(line._id, line.size, normalized);
  };

  const handleSaveForLater = async (line) => {
    const lineKey = `${line._id}-${line.size}`;
    setSavingItemKey(lineKey);

    try {
      if (!isWishlisted(line._id)) {
        await toggleWishlist(line._id);
      }

      await updateQuantity(line._id, line.size, 0);
    } finally {
      setSavingItemKey('');
    }
  };

  if (!loadingProductsData && cartData.length === 0) {
    return (
      <div className='cart-shell pt-10 pb-16'>
        <div className='cart-entrance cart-delay-0 rounded-[30px] border border-slate-200 bg-white px-6 py-12 text-center shadow-[0_8px_24px_rgba(15,23,42,0.06)]'>
          <h2 className='text-3xl font-semibold tracking-[-0.015em] text-slate-900'>Cart</h2>
          <p className='mt-2 text-sm text-slate-500'>0 items</p>
          <p className='mt-5 text-sm text-slate-500'>Your bag is empty. Add your favorite pieces and checkout in seconds.</p>

          <div className='mt-6 flex flex-wrap justify-center gap-2'>
            <span className='rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600'>Secure checkout</span>
            <span className='rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600'>Easy returns</span>
          </div>

          <button
            onClick={() => navigate('/collection')}
            className='mt-8 rounded-full bg-slate-950 px-8 py-3 text-sm font-medium text-white transition hover:bg-slate-800'
          >
            Continue shopping
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='cart-shell pt-8 sm:pt-10 pb-28 md:pb-16'>
      <div className='cart-entrance cart-delay-0 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <h1 className='text-[2rem] sm:text-[2.35rem] font-semibold tracking-[-0.015em] text-[#111] leading-none'>
            Cart
          </h1>
          <p className='mt-2 text-sm text-slate-500'>
            {itemCount} item{itemCount === 1 ? '' : 's'}
          </p>
        </div>

        <button
          type='button'
          onClick={() => navigate('/collection')}
          className='w-full sm:w-auto rounded-full border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700'
        >
          Add more items
        </button>
      </div>

      {loadingProductsData ? (
        <div className='cart-entrance cart-delay-1 mt-6 space-y-3'>
          <div className='rounded-[24px] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)]'>
            <div className='flex gap-3'>
              <div className='lf-shimmer h-24 w-20 rounded-2xl'></div>
              <div className='min-w-0 flex-1'>
                <div className='lf-shimmer h-4 w-4/5 rounded-full'></div>
                <div className='mt-2 lf-shimmer h-3 w-1/3 rounded-full'></div>
                <div className='mt-3 lf-shimmer h-6 w-24 rounded-full'></div>
                <div className='mt-3 lf-shimmer h-9 w-28 rounded-full'></div>
              </div>
            </div>
          </div>
          <div className='rounded-[24px] bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)]'>
            <div className='lf-shimmer h-5 w-32 rounded-full'></div>
            <div className='mt-3 lf-shimmer h-4 w-full rounded-full'></div>
            <div className='mt-2 lf-shimmer h-4 w-2/3 rounded-full'></div>
            <div className='mt-4 lf-shimmer h-11 w-full rounded-full'></div>
          </div>
        </div>
      ) : (
        <>
          <section className='mt-6 space-y-3'>
            {cartLines.map((line, index) => {
              const lineKey = `${line._id}-${line.size}`;
              const productName = line.product?.name || 'Product';
              const productPrice = Number(line.product?.price || 0);
              const imageSrc = Array.isArray(line.product?.image) ? line.product.image[0] : '';
              const saveDisabled = savingItemKey === lineKey;

              return (
                <article
                  key={lineKey}
                  className='cart-entrance rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)]'
                  style={{ animationDelay: `${Math.min(0.1 + index * 0.05, 0.42)}s` }}
                >
                  <div className='flex gap-3'>
                    {imageSrc ? (
                      <img
                        src={imageSrc}
                        alt={productName}
                        className='h-24 w-20 shrink-0 rounded-2xl object-cover bg-slate-100'
                      />
                    ) : (
                      <div className='h-24 w-20 shrink-0 rounded-2xl bg-slate-100'></div>
                    )}

                    <div className='min-w-0 flex-1'>
                      <p className='text-base font-semibold text-slate-900 leading-6 line-clamp-2'>{productName}</p>
                      <div className='mt-1 flex items-center gap-2 text-xs text-slate-500'>
                        <span className='rounded-full bg-slate-100 px-2.5 py-1'>Size {line.size}</span>
                      </div>
                      <p className='mt-2 text-2xl font-semibold tracking-[-0.015em] text-slate-900'>
                        {formatCurrency(productPrice)}
                      </p>

                      <div className='mt-3 flex items-center justify-between gap-3'>
                        <div className='inline-flex items-center rounded-full border border-slate-200 bg-slate-50 p-1'>
                          <button
                            type='button'
                            onClick={() => handleQuantityChange(line, line.quantity - 1)}
                            className='h-7 w-7 rounded-full text-base font-semibold text-slate-700'
                            aria-label='Decrease quantity'
                          >
                            -
                          </button>
                          <span className='min-w-7 text-center text-sm font-medium text-slate-800'>{line.quantity}</span>
                          <button
                            type='button'
                            onClick={() => handleQuantityChange(line, line.quantity + 1)}
                            className='h-7 w-7 rounded-full text-base font-semibold text-slate-700'
                            aria-label='Increase quantity'
                          >
                            +
                          </button>
                        </div>

                        <button
                          type='button'
                          onClick={() => handleQuantityChange(line, 0)}
                          className='inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500'
                          aria-label='Remove item'
                        >
                          <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor' className='h-4 w-4'>
                            <path d='M9 3a1 1 0 00-1 1v1H5a1 1 0 000 2h1v12a2 2 0 002 2h8a2 2 0 002-2V7h1a1 1 0 100-2h-3V4a1 1 0 00-1-1H9zm1 4h6v12h-6V7z' />
                          </svg>
                        </button>
                      </div>

                      <div className='mt-3'>
                        <button
                          type='button'
                          onClick={() => handleSaveForLater(line)}
                          disabled={saveDisabled}
                          className='text-xs uppercase tracking-[0.16em] text-slate-600 disabled:opacity-60 disabled:cursor-not-allowed'
                        >
                          {saveDisabled ? 'Saving...' : 'Save for later'}
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>

          <section className='cart-entrance cart-delay-2 mt-6 rounded-[24px] border border-slate-200 bg-white p-4 sm:p-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)]'>
            <div className='flex items-center justify-between text-sm text-slate-600'>
              <span>Subtotal</span>
              <span className='font-medium text-slate-900'>{formatCurrency(subtotal)}</span>
            </div>

            <div className='mt-3 flex items-center justify-between text-sm text-slate-600'>
              <span>Shipping</span>
              <span className='font-medium text-slate-900'>{deliveryFee === 0 ? 'Free' : formatCurrency(deliveryFee)}</span>
            </div>

            <div className='mt-4 rounded-2xl bg-slate-50 px-3 py-3'>
              <p className='text-xs uppercase tracking-[0.2em] text-slate-500'>Total</p>
              <p className='mt-1 text-[1.9rem] sm:text-[2.1rem] leading-none font-semibold tracking-[-0.02em] text-slate-900'>
                {formatCurrency(total)}
              </p>
            </div>

            <p className={`mt-3 text-xs ${freeDeliveryUnlocked ? 'text-emerald-700' : 'text-slate-500'}`}>
              {freeDeliveryUnlocked
                ? 'Free delivery unlocked on this order.'
                : `Free delivery above ${formatCurrency(FREE_DELIVERY_THRESHOLD)}. Add ${formatCurrency(amountToFreeDelivery)} more.`}
            </p>

            <div className='mt-4 flex flex-wrap gap-2'>
              <span className='rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600'>Secure checkout</span>
              <span className='rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600'>Easy returns</span>
              <span className='rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600'>Trusted payments</span>
            </div>

            <button
              type='button'
              onClick={() => navigate('/place-order')}
              className='mt-5 hidden md:block w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white'
            >
              Proceed to checkout
            </button>
          </section>
        </>
      )}

      {!loadingProductsData && cartData.length > 0 ? (
        <div className='md:hidden fixed inset-x-3 bottom-3 z-30' style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className='cart-entrance cart-delay-3 rounded-2xl border border-slate-200 bg-white/95 px-3 py-3 shadow-[0_10px_28px_rgba(15,23,42,0.12)] backdrop-blur'>
            <div className='flex items-center justify-between gap-3'>
              <div>
                <p className='text-xs uppercase tracking-[0.16em] text-slate-500'>Total</p>
                <p className='mt-0.5 text-xl font-semibold text-slate-900'>{formatCurrency(total)}</p>
              </div>

              <button
                type='button'
                onClick={() => navigate('/place-order')}
                className='rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white'
              >
                Proceed to checkout
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Cart;
