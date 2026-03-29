import React, { useCallback, useContext, useEffect } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import { notify as toast } from '../utils/notify';
import { ShopContext } from '../context/ShopContext';

const Verify = () => {
  const { navigate, clearCartState, token, BACKEND_URL } = useContext(ShopContext);
  const [searchParams] = useSearchParams();
  const success = searchParams.get('success');
  const orderId = searchParams.get('orderId');
  const sessionId = searchParams.get('session_id');
  const checkoutSource = searchParams.get('checkoutSource');

  const verifyPayment = useCallback(async () => {
    try {
      if (!token) {
        navigate('/login');
        return;
      }

      if (!orderId) {
        toast.error('Missing order id in verification link');
        navigate('/cart');
        return;
      }

      const response = await axios.post(
        BACKEND_URL + '/api/order/verifyStripe',
        { success, orderId, session_id: sessionId },
        { headers: { token } }
      );

      if (response.data.success) {
        if (checkoutSource !== 'buy_now') {
          clearCartState();
        }
        navigate('/orders');
        return;
      }

      toast.error(response.data.message || 'Payment verification failed');
      navigate('/cart');
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
      navigate('/cart');
    }
  }, [BACKEND_URL, checkoutSource, clearCartState, navigate, orderId, sessionId, success, token]);

  useEffect(() => {
    verifyPayment();
  }, [verifyPayment]);

  return <div></div>;
};

export default Verify;
