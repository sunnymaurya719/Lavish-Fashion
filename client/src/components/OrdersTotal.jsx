import React, { useContext } from 'react';
import { ShopContext } from '../context/ShopContext';
import Title from './Title';

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const OrdersTotal = ({
  isBuyNow = false,
  buyNowProduct = null,
  subtotal: subtotalProp,
  deliveryFee: deliveryFeeProp,
  discountAmount = 0,
  couponDiscountAmount = 0,
  loyaltyDiscountAmount = 0,
  loyaltyPointsRedeemed = 0,
  total: totalProp,
  couponCode = '',
}) => {
  const { delivery_fee, getCartAmount } = useContext(ShopContext);

  const derivedSubtotal = isBuyNow && buyNowProduct ? buyNowProduct.price * (buyNowProduct.quantity || 1) : getCartAmount();
  const subtotal = subtotalProp ?? derivedSubtotal;
  const deliveryFee = deliveryFeeProp ?? (subtotal === 0 ? 0 : delivery_fee);
  const normalizedDiscount = Number(discountAmount || 0);
  const normalizedCouponDiscount = Number(couponDiscountAmount || 0);
  const normalizedLoyaltyDiscount = Number(loyaltyDiscountAmount || 0);
  const total = totalProp ?? Math.max(0, subtotal + deliveryFee - normalizedDiscount);

  return (
    <div className='w-full'>
      <div className='text-2xl'>
        <Title text1={isBuyNow ? 'ORDER' : 'CART'} text2='TOTALS' />
      </div>

      <div className='mt-2 flex flex-col gap-3 text-sm'>
        <div className='flex justify-between'>
          <p>Subtotal</p>
          <p>{formatCurrency(subtotal)}</p>
        </div>

        <hr />

        <div className='flex justify-between'>
          <p>Shipping Fee</p>
          <p>{deliveryFee === 0 ? 'Free' : formatCurrency(deliveryFee)}</p>
        </div>

        {normalizedCouponDiscount > 0 ? (
          <>
            <hr />
            <div className='flex justify-between text-emerald-700'>
              <p>{couponCode ? `Discount (${couponCode})` : 'Discount'}</p>
              <p>-{formatCurrency(normalizedCouponDiscount)}</p>
            </div>
          </>
        ) : null}

        {normalizedLoyaltyDiscount > 0 ? (
          <>
            <hr />
            <div className='flex justify-between text-sky-700'>
              <p>{`Rewards redemption${loyaltyPointsRedeemed > 0 ? ` (${loyaltyPointsRedeemed} pts)` : ''}`}</p>
              <p>-{formatCurrency(normalizedLoyaltyDiscount)}</p>
            </div>
          </>
        ) : null}

        <hr />

        <div className='flex justify-between'>
          <b>Total</b>
          <b>{formatCurrency(total)}</b>
        </div>

        {couponCode ? (
          <p className='text-xs text-emerald-700'>Coupon {couponCode} is currently applied to this order.</p>
        ) : null}

        {normalizedLoyaltyDiscount > 0 ? (
          <p className='text-xs text-sky-700'>
            {loyaltyPointsRedeemed} loyalty points are currently reserved for this checkout.
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default OrdersTotal;
