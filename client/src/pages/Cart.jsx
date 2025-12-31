import React, { useContext, useEffect, useState } from 'react'
import { ShopContext } from '../context/ShopContext'
import Title from '../components/Title'
import { assets } from '../assets/assets';
import OrdersTotal from '../components/OrdersTotal';

const Cart = () => {

  const { products, currency, cartItems, updateQuantity, navigate } = useContext(ShopContext);

  const [cartData, setCartData] = useState([]);

  useEffect(() => {

    if (products.length > 0) {
      const tempData = [];

      for (const items in cartItems) {
        for (const item in cartItems[items]) {
          if (cartItems[items][item] > 0) {
            tempData.push({
              _id: items,
              size: item,
              quantity: cartItems[items][item]
            })
          }
        }
      }
      setCartData(tempData);
    }

  }, [cartItems, products]);

  return cartData.length === 0 ? (
        <div className='flex flex-col items-center justify-center py-20 text-gray-500'>
          <h2 className='text-xl font-semibold mb-2'>Your cart is empty</h2>
          <p className='text-sm mb-6'>
            Looks like you haven’t added anything to your cart yet
          </p>
          <button
            onClick={() => navigate('/')}
            className='bg-black text-white px-8 py-3 text-sm rounded hover:bg-gray-800 transition'
          >
            CONTINUE SHOPPING
          </button>
        </div>
        ) : (
        <div className='border-t pt-14'>
          <div className='text-2xl mb-3'>
            <Title text1={'YOUR'} text2={'CART'} />
          </div>
          <div>
            {
              cartData.map((item, index) => {
                const productData = products.find((product) => product._id === item._id);
                return (
                  <div key={index} className='py-4 border-t border-b text-gray-700 grid grid-cols-[4fr_0.5fr_0.5fr] sm:grid-cols-[4fr_2fr_0.5fr] items-center gap-4'>
                    <div className='flex items-start gap-6'>
                      <img className='w-16 sm:w-20' src={productData?.image[0]} alt='' />
                      <div>
                        <p className='text-xs sm:text-lg font-medium'>{productData.name}</p>
                        <div className='flex items-center gap-5 mt-2'>
                          <p>{currency}{productData.price}</p>
                          <p className='px-2 sm:px-3 sm:py-1 border bg-slate-50'>{item.size}</p>
                        </div>
                      </div>
                    </div>
                    <div className='flex flex-col sm:flex-row sm:ml-3 items-center justify-center border border-gray-300 rounded-md max-w-16 sm:max-w-24 px-2 py-1 bg-white shadow-sm'>
                      <img
                        className='w-4 h-4 sm:w-5 sm:h-5 cursor-pointer hover:opacity-75 transition-opacity mb-1 sm:mb-0'
                        src={assets.minus}
                        alt='minus'
                        onClick={() => updateQuantity(item._id, item.size, item.quantity - 1)} // Assuming you have a handler function
                      />
                      <p className='text-center mx-0 sm:mx-3 text-sm sm:text-base font-medium min-w-6 my-1 sm:my-0'>{item.quantity}</p>
                      <img
                        className='w-3 h-3 sm:w-4 sm:h-4 cursor-pointer hover:opacity-75 transition-opacity mt-1 sm:mt-0'
                        src={assets.plus}
                        alt='plus'
                        onClick={() => updateQuantity(item._id, item.size, item.quantity + 1)} // Assuming you have a handler function
                      />
                    </div>
                    {/* <div className='sm:flex border-rounded border-w-1 max-w-10 sm:max-w-20 px-1 sm:px-2 py-1'>
                  <img className='w-4 mr-4 sm:w-5 cursor-pointer' src={assets.minus} alt='minus' />
                  <p className='text-center'>{item.quantity}</p>
                  <img className='w-4 mr-4 sm:w-5 cursor-pointer' src={assets.plus} alt='plus' />
                 <input onChange={(e) => e.target.value === '' || e.target.value === '0' ? null : updateQuantity(item._id, item.size, Number(e.target.value))} className='border max-w-10 sm:max-w-20 px-1 sm:px-2 py-1' type="number" min={1} defaultValue={item.quantity} /> 
                </div>  */}

                    <img onClick={() => updateQuantity(item._id, item.size, 0)} className='w-4 mr-4 sm:w-5 cursor-pointer' src={assets.bin_icon} alt='' />
                  </div>
                )
              })
            }
          </div>
          <div className='flex justify-end my-20'>
            <div className='w-full sm:w-[450px]'>
              <OrdersTotal />
              <div className='w-full text-end'>
                <button onClick={() => navigate('/place-order')} className='bg-black text-white text-sm my-8 px-8 py-3'>PROCEED TO CHECKOUT</button>
              </div>
            </div>
          </div>
        </div>
        )
      
    }

export default Cart