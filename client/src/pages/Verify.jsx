import React, { useContext,useEffect } from 'react'
import axios from 'axios';
import { ShopContext } from '../context/ShopContext'
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
const Verify = () => {

    const {navigate,setCartItems,token,BACKEND_URL} = useContext(ShopContext);
    const [searchParams,setSearchParams] = useSearchParams();
    const success = searchParams.get('success');
    const orderId = searchParams.get('orderId');

    const verifyPayment=async() => {
        try{
            if(!token){
                return null;
            }
            const response = await axios.post(BACKEND_URL + '/api/order/verifyStripe',{success,orderId},{headers:{token}});
            console.log("response at verify Stripe:",response);
            if(response.data.success){
                setCartItems({})
                navigate('/orders');
            }
            else{
                navigate('/cart');
            }
        }catch(error){
            console.log(error);
            toast.error(error.message);
        }
    }

    useEffect(() =>{
        verifyPayment();
    },[]);

  return (
    <div>
        
    </div>
  )
}

export default Verify