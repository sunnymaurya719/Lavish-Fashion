import React, { useContext, useEffect, useState } from 'react';
import axios from 'axios';
import { notify as toast } from '../utils/notify';
import { ShopContext } from '../context/ShopContext';

const Login = () => {
  const [currentState, setCurrentState] = useState('Login');
  const { token, setToken, navigate, BACKEND_URL, getUserCart, serverStatus, serverBootstrap, bootstrapServer } =
    useContext(ShopContext);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const submitDisabled = serverStatus === 'offline';

  const onSubmitHandler = async (event) => {
    event.preventDefault();

    if (submitDisabled) {
      toast.error('The storefront API is currently offline. Retry the connection before signing in.');
      return;
    }

    try {
      if (currentState === 'Sign Up') {
        const payload = {
          name,
          email,
          password,
          ...(referralCode.trim() ? { referralCode: referralCode.trim().toUpperCase() } : {}),
        };
        const response = await axios.post(BACKEND_URL + '/api/user/register', payload);

        if (response.data.success) {
          setToken(response.data.token);
          localStorage.setItem('token', response.data.token);
          return;
        }

        toast.error(response.data.message || 'Unable to create account');
        return;
      }

      const response = await axios.post(BACKEND_URL + '/api/user/login', { email, password });

      if (response.data.success) {
        setToken(response.data.token);
        localStorage.setItem('token', response.data.token);
        return;
      }

      toast.error(response.data.message || 'Unable to sign in');
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    }
  };

  useEffect(() => {
    if (token) {
      navigate('/');
      getUserCart(localStorage.getItem('token'));
    }
  }, [token, navigate, getUserCart]);

  return (
    <form onSubmit={onSubmitHandler} className='flex flex-col items-center w-[90%] sm:max-w-96 m-auto mt-14 gap-4 text-gray-800'>
      <div className='inline-flex items-center gap-2 mb-2 mt-10'>
        <p className='prata-regular text-3xl'>{currentState}</p>
        <hr className='border-none h-[1.5px] w-8 bg-gray-800' />
      </div>

      <div
        className={`w-full rounded-2xl border px-4 py-4 text-sm ${
          serverStatus === 'online'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : serverStatus === 'offline'
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-slate-200 bg-slate-50 text-slate-700'
        }`}
      >
        <p className='font-medium'>
          {serverStatus === 'online'
            ? 'Storefront API connected'
            : serverStatus === 'offline'
              ? 'Storefront API offline'
              : 'Checking storefront API'}
        </p>
        <p className='mt-1'>
          {serverStatus === 'online'
            ? `Checkout is synced. Stripe is ${serverBootstrap?.payments?.stripeEnabled ? 'enabled' : 'disabled'}, Razorpay is ${
                serverBootstrap?.payments?.razorpayEnabled ? 'enabled' : 'disabled'
              }.`
            : serverStatus === 'offline'
              ? 'Authentication and cart sync need the backend to be reachable before you continue.'
              : 'Verifying backend availability and payment capability sync.'}
        </p>
        <button
          type='button'
          onClick={() => bootstrapServer()}
          className='mt-3 rounded-lg border border-current px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em]'
        >
          Retry connection
        </button>
      </div>

      {currentState === 'Login' ? null : (
        <input
          onChange={(event) => setName(event.target.value)}
          value={name}
          type='text'
          className='w-full px-3 py-2 border border-gray-800'
          placeholder='Name'
          required
        />
      )}
      <input
        onChange={(event) => setEmail(event.target.value)}
        value={email}
        type='email'
        className='w-full px-3 py-2 border border-gray-800'
        placeholder='Email'
        required
      />
      <input
        onChange={(event) => setPassword(event.target.value)}
        value={password}
        type='password'
        className='w-full px-3 py-2 border border-gray-800'
        placeholder='Password'
        required
      />
      {currentState === 'Login' ? null : (
        <input
          onChange={(event) => setReferralCode(event.target.value.toUpperCase())}
          value={referralCode}
          type='text'
          className='w-full px-3 py-2 border border-gray-300 uppercase'
          placeholder='Referral code (optional)'
          maxLength='12'
        />
      )}

      <div className='w-full flex justify-between text-sm mt-[-8px] text-gray-500'>
        <p>{currentState === 'Login' ? 'Password reset is coming soon' : 'Add a referral code before creating your account'}</p>
        {currentState === 'Login' ? (
          <button type='button' onClick={() => setCurrentState('Sign Up')} className='cursor-pointer text-black'>
            Create account
          </button>
        ) : (
          <button type='button' onClick={() => setCurrentState('Login')} className='cursor-pointer text-black'>
            Login here
          </button>
        )}
      </div>
      <button className='bg-black text-white font-light px-8 py-2 mt-4 disabled:cursor-not-allowed disabled:opacity-60' disabled={submitDisabled}>
        {currentState === 'Login' ? 'Sign In' : 'Sign Up'}
      </button>
    </form>
  );
};

export default Login;
