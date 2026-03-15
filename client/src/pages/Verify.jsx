import React, { useCallback, useContext,useEffect } from 'react'
import axios from 'axios';
import { ShopContext } from '../context/ShopContext'
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';

const Verify = () => {

    const {navigate,setCartItems,token,BACKEND_URL} = useContext(ShopContext);
    const [searchParams] = useSearchParams();
    const success = searchParams.get('success');
    const orderId = searchParams.get('orderId');
    const sessionId = searchParams.get('session_id');

    const verifyPayment = useCallback(async() => {
        try{
            if(!token){
                navigate('/login');
                return;
            }

            if (!orderId) {
                toast.error('Missing order id in verification link');
                navigate('/cart');
                return;
            }

            const response = await axios.post(BACKEND_URL + '/api/order/verifyStripe',{success,orderId,session_id:sessionId},{headers:{token}});
            if(response.data.success){
                setCartItems({})
                navigate('/orders');
            }
            else{
                toast.error(response.data.message || 'Payment verification failed');
                navigate('/cart');
            }
        }catch(error){
            toast.error(error?.response?.data?.message || error.message);
            navigate('/cart');
        }
    }, [token, navigate, orderId, sessionId, success, BACKEND_URL, setCartItems])

    useEffect(() =>{
        verifyPayment();
    },[verifyPayment]);

  return (
    <div>
        
    </div>
  )
}

export default Verify