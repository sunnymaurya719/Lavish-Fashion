import React, { useContext, useState } from 'react'
import Title from '../components/Title'
import OrdersTotal from '../components/OrdersTotal'
import { assets } from '../assets/assets'
import { ShopContext } from '../context/ShopContext'
import { useLocation } from 'react-router-dom';
import axios from 'axios'

const PlaceOrder = () => {

  const { navigate, toast, BACKEND_URL, token, cartItems, setCartItems, getCartAmount, delivery_fee, products } = useContext(ShopContext);
  const [method, setMethod] = useState('');

  const location = useLocation();
  const isBuyNow = location.state?.buyNow;
  const buyNowProduct = location.state?.product;

  //  User not logged in
  if (!token) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4">

        <h2 className="text-2xl font-semibold mb-2">
          Login Required
        </h2>

        <p className="text-gray-600 mb-6">
          Please login to continue and place your order
        </p>

        <button
          onClick={() => navigate('/login')}
          className="bg-black text-white px-8 py-3 text-sm rounded
                   hover:bg-gray-800 transition"
        >
          LOGIN TO CONTINUE
        </button>
      </div>
    );
  }


  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    street: '',
    city: '',
    state: '',
    pincode: '',
    country: '',
    phone: ''

  });

  const onChangeHandler = (event) => {
    const name = event.target.name;
    const value = event.target.value;
    setFormData(data => ({ ...data, [name]: value }));
  }

  const initPay = (order) => {
    const options = {
      key: import.meta.env.VITE_RAZORPAY_KEY_ID,
      amount: order.amount,
      currency: order.currency,
      name: 'Order Payment',
      description: 'Order Payment',
      order_id: order.id,
      receipt: order.receipt,
      handler: async (response) => {
        try {
          const res = await axios.post(BACKEND_URL + '/api/order/verifyRazorpay', response, { headers: { token } });
          if (res.data.success) {
            navigate('/orders');
            setCartItems({});
          }
        } catch (error) {
          console.log(error.message);
          toast.error(error)
        }
      }
    }
    const razorpay = new window.Razorpay(options);
    razorpay.open();
  }

  const onSubmitHandler = async (event) => {
    event.preventDefault();
    if (!method) {
      toast.error('Please select a payment method');
      return;
    }

    try {

      let orderItems = [];
      let totalAmount = 0;

      if (isBuyNow && buyNowProduct) {
        //  BUY NOW FLOW
        orderItems.push({
          ...buyNowProduct,
          quantity: 1,
        });
        totalAmount = buyNowProduct.price + delivery_fee;

      } else {
        //  CART FLOW
        for (const items in cartItems) {
          for (const item in cartItems[items]) {
            if (cartItems[items][item] > 0) {
              const itemInfo = structuredClone(
                products.find(prod => prod._id === items)
              );
              if (itemInfo) {
                itemInfo.size = item;
                itemInfo.quantity = cartItems[items][item];
                orderItems.push(itemInfo);
              }
            }
          }
        }
        totalAmount = getCartAmount() + delivery_fee;
      }

      let orderData = {
        address: formData,
        items: orderItems,
        amount: totalAmount
      }

      switch (method) {

        case 'stripe':
          const stripeResponse = await axios.post(BACKEND_URL + '/api/order/stripe', orderData, { headers: { token } });
          if (stripeResponse.data.success) {
            const { url } = stripeResponse.data.session
            window.location.replace(url);
          }
          else {
            toast.error(stripeResponse.data.message);
          }
          break;

        case 'razorpay':
          const razorpayResponse = await axios.post(BACKEND_URL + '/api/order/razorpay', orderData, { headers: { token } });
          if (razorpayResponse.data.success) {
            initPay(razorpayResponse.data.order);
          }
          else {
            console.log("Razorpay error" + razorpayResponse.data.message);
          }
          break;

        default:
          break;

      }

    }
    catch (error) {
      console.log('Error placing order:', error);
      toast.error('Failed to place order. Please try again.', error.message);
    }
  }

  return (
    <form onSubmit={onSubmitHandler} className='flex flex-col sm:flex-row justify-between gap-4 pt-5 sm:pt-14 min-h-[80vh] border-t'>

      {/* Left Section */}
      <div className='flex flex-col gap-4 w-full sm:max-w-[450px]'>
        <div className='text-xl sm:text-2xl my-3'>
          <Title text1={'DELIVERY'} text2={'INFORMATION'} />
        </div>
        <div className='flex gap-3'>
          <input onChange={onChangeHandler} name='firstName' value={formData.firstName} className='border border-gray-300 rounded py-1.5 px-3.5 w-full' type="text" placeholder='First name' maxLength={'15'} required />
          <input onChange={onChangeHandler} name='lastName' value={formData.lastName} className='border border-gray-300 rounded py-1.5 px-3.5 w-full' type="text" placeholder='Second name' maxLength={'15'} required />
        </div>
        <input onChange={onChangeHandler} name='phone' value={formData.phone} className='border border-gray-300 rounded py-1.5 px-3.5 w-full' type="text" placeholder='Phone no.' maxLength={'10'} required />
        <input onChange={onChangeHandler} name='street' value={formData.street} className='border border-gray-300 rounded py-1.5 px-3.5 w-full' type="text" placeholder='Street' maxLength={'35'} required />
        <div className='flex gap-3'>
          <input onChange={onChangeHandler} name='city' value={formData.city} className='border border-gray-300 rounded py-1.5 px-3.5 w-full' type="text" placeholder='City' maxLength={'25'} required />
          <input onChange={onChangeHandler} name='state' value={formData.state} className='border border-gray-300 rounded py-1.5 px-3.5 w-full' type="text" placeholder='State' maxLength={'25'} required />
        </div>
        <div className='flex gap-3'>
          <input onChange={onChangeHandler} name='pincode' value={formData.pincode} className='border border-gray-300 rounded py-1.5 px-3.5 w-full' type="text" placeholder='PIN code' maxLength={'6'} required />
          <input onChange={onChangeHandler} name='country' value={formData.country} className='border border-gray-300 rounded py-1.5 px-3.5 w-full' type="text" placeholder='Country' maxLength={'15'} required />
        </div>
      </div>

      {/* Right Section */}

      <div className='mt-8'>

        <div className='mt-8 min-w-80'>
          <OrdersTotal isBuyNow={isBuyNow} buyNowProduct={buyNowProduct} />
        </div>

        <div className='mt-12'>
          <Title text1={'PAYMENT'} text2={'METHOD'} />

          {/* Payment Methods */}
          <div className='flex gap-3 flex-col lg:flex-row'>

            <div onClick={() => setMethod('stripe')} className='flex items-center gap-3 border p-2 px-3 cursor-pointer'>
              <p className={`min-w-3.5 h-3.5 border rounded-full ${method === 'stripe' ? 'bg-green-400' : ''}`}></p>
              <img className='h-5 mx-4' src={assets.stripe_logo} alt='' />
            </div>
            <div onClick={() => setMethod('razorpay')} className='flex items-center gap-3 border p-2 px-3 cursor-pointer'>
              <p className={`min-w-3.5 h-3.5 border rounded-full ${method === 'razorpay' ? 'bg-green-400' : ''}`}></p>
              <img className='h-5 mx-4' src={assets.razorpay_logo} alt='' />
            </div>

          </div>

          <div className='w-full text-end mt-8'>
            <button type='submit' className='bg-black text-white px-16 py-3 text-sm'>PLACE ORDER</button>
          </div>

        </div>

      </div>


    </form>
  )
}

export default PlaceOrder