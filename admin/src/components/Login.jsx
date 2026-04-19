import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';

const ADMIN_EMAIL_STORAGE_KEY = 'adminLastEmail';

const ServerStatusPanel = ({ serverStatus, serverBootstrap, onRetryConnection }) => {
  const palette =
    serverStatus === 'online'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : serverStatus === 'offline'
        ? 'border-rose-200 bg-rose-50 text-rose-900'
        : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <div className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${palette}`} role='status'>
      <p className='font-medium'>
        {serverStatus === 'online'
          ? 'Server connected'
          : serverStatus === 'offline'
            ? 'Server offline'
            : 'Checking server'}
      </p>
      <p className='mt-1 text-[13px] leading-relaxed'>
        {serverStatus === 'online'
          ? `Dashboard API ready. Email mode: ${serverBootstrap?.integrations?.marketingEmailMode || 'simulation'}.`
          : serverStatus === 'offline'
            ? 'The admin dashboard cannot authenticate or load live data until the API is reachable.'
            : 'Verifying API availability and integration capabilities.'}
      </p>
      <button
        type='button'
        onClick={onRetryConnection}
        className='mt-3 inline-flex items-center gap-2 rounded-xl border border-current bg-white/70 px-3 py-1.5 text-xs font-semibold transition hover:bg-white ui-focus-ring'
      >
        <svg width='12' height='12' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
          <path d='M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z' fill='currentColor' />
        </svg>
        Retry connection
      </button>
    </div>
  );
};

const Login = ({ setToken, serverStatus, serverBootstrap, onRetryConnection }) => {
  const [email, setEmail] = useState(() => {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem(ADMIN_EMAIL_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const passwordInputRef = useRef(null);

  const loginDisabled = serverStatus === 'offline' || isSubmitting;

  useEffect(() => {
    if (email && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(ADMIN_EMAIL_STORAGE_KEY, email);
      } catch {
        /* ignore */
      }
    }
  }, [email]);

  const handleCapsLock = (event) => {
    if (typeof event.getModifierState === 'function') {
      setCapsLockOn(event.getModifierState('CapsLock'));
    }
  };

  const onSubmitHandler = async (event) => {
    event.preventDefault();
    if (loginDisabled) {
      if (serverStatus === 'offline') {
        toast.error('The admin API is currently offline. Retry the connection before logging in.');
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await axios.post(BACKEND_URL + '/api/user/admin', { email, password });
      if (response.data.success) {
        setToken(response.data.token);
        return;
      }
      toast.error(response.data.message || 'Login failed');
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsSubmitting(false);
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

          <ServerStatusPanel
            serverStatus={serverStatus}
            serverBootstrap={serverBootstrap}
            onRetryConnection={onRetryConnection}
          />

          <form onSubmit={onSubmitHandler} className='mt-6' noValidate>
            <div className='mb-4'>
              <label htmlFor='admin-email' className='mb-2 block text-sm font-medium text-slate-700'>
                Email Address
              </label>
              <input
                id='admin-email'
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className='w-full rounded-2xl border border-slate-300 px-4 py-3 ui-focus-ring'
                type='email'
                autoComplete='username'
                placeholder='admin@lavish.com'
                required
              />
            </div>

            <div className='mb-2'>
              <label htmlFor='admin-password' className='mb-2 block text-sm font-medium text-slate-700'>
                Password
              </label>
              <div className='relative'>
                <input
                  id='admin-password'
                  ref={passwordInputRef}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={handleCapsLock}
                  onKeyUp={handleCapsLock}
                  className='w-full rounded-2xl border border-slate-300 px-4 py-3 pr-12 ui-focus-ring'
                  type={showPassword ? 'text' : 'password'}
                  autoComplete='current-password'
                  placeholder='Enter your password'
                  required
                />
                <button
                  type='button'
                  onClick={() => {
                    setShowPassword((prev) => !prev);
                    passwordInputRef.current?.focus();
                  }}
                  className='absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 ui-focus-ring'
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {capsLockOn ? (
                <p className='mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-700'>
                  <span className='inline-block h-1.5 w-1.5 rounded-full bg-amber-500' aria-hidden='true' />
                  Caps Lock is on
                </p>
              ) : null}
            </div>

            <button
              className='mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 ui-focus-ring'
              type='submit'
              disabled={loginDisabled}
            >
              {isSubmitting ? (
                <>
                  <span
                    className='inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white'
                    aria-hidden='true'
                  />
                  Signing in…
                </>
              ) : (
                'Login'
              )}
            </button>
          </form>

          <p className='mt-6 border-t border-slate-100 pt-4 text-center text-xs text-slate-500'>
            Need access? Contact{' '}
            <a
              href='mailto:ops@lavishfashion.com'
              className='font-medium text-slate-700 underline-offset-2 hover:underline'
            >
              ops@lavishfashion.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
