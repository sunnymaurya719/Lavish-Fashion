import React, { useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';

const Login = ({ setToken, serverStatus, serverBootstrap, onRetryConnection }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const loginDisabled = serverStatus === 'offline';

  const onSubmitHandler = async (event) => {
    event.preventDefault();

    if (loginDisabled) {
      toast.error('The admin API is currently offline. Retry the connection before logging in.');
      return;
    }

    try {
      const response = await axios.post(BACKEND_URL + '/api/user/admin', { email, password });

      if (response.data.success) {
        setToken(response.data.token);
        return;
      }

      toast.error(response.data.message || 'Login failed');
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    }
  };

  return (
    <div className='min-h-screen w-full bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.16),_transparent_30%),linear-gradient(180deg,_#f8fafc_0%,_#f1f5f9_100%)] px-4 py-8'>
      <div className='mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center justify-center'>
        <div className='w-full max-w-xl rounded-[32px] border border-slate-200 bg-white p-8 shadow-xl'>
          <p className='text-xs uppercase tracking-[0.35em] text-slate-400'>Admin workspace</p>
          <h1 className='mt-2 text-3xl font-semibold text-slate-950'>Sign in to Admin OS</h1>
          <p className='mt-2 text-sm text-slate-500'>
            Access catalog, inventory, orders, and retention operations from one control layer.
          </p>

        <div
          className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
            serverStatus === 'online'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : serverStatus === 'offline'
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-slate-200 bg-slate-50 text-slate-700'
          }`}
        >
          <p className='font-medium'>
            {serverStatus === 'online' ? 'Server connected' : serverStatus === 'offline' ? 'Server offline' : 'Checking server'}
          </p>
          <p className='mt-1'>
            {serverStatus === 'online'
              ? `Dashboard API ready. Email mode: ${serverBootstrap?.integrations?.marketingEmailMode || 'simulation'}.`
              : serverStatus === 'offline'
                ? 'The admin dashboard cannot authenticate or load live data until the API is reachable.'
                : 'Verifying API availability and integration capabilities.'}
          </p>
          <button
            type='button'
            onClick={onRetryConnection}
            className='mt-3 rounded-xl border border-current px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em]'
          >
            Retry connection
          </button>
        </div>

        <form onSubmit={onSubmitHandler} className='mt-6'>
          <div className='mb-4'>
            <p className='mb-2 text-sm font-medium text-slate-700'>Email Address</p>
            <input
              onChange={(event) => setEmail(event.target.value)}
              className='w-full rounded-2xl border border-slate-300 px-4 py-3'
              type='email'
              placeholder='admin@lavish.com'
              required
            />
          </div>
          <div className='mb-4'>
            <p className='mb-2 text-sm font-medium text-slate-700'>Password</p>
            <input
              onChange={(event) => setPassword(event.target.value)}
              className='w-full rounded-2xl border border-slate-300 px-4 py-3'
              type='password'
              placeholder='Enter your password'
              required
            />
          </div>
          <button
            className='mt-2 w-full rounded-2xl bg-slate-950 px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60'
            type='submit'
            disabled={loginDisabled}
          >
            Login
          </button>
        </form>
      </div>
      </div>
    </div>
  );
};

export default Login;
