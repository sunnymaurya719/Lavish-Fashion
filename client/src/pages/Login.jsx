import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { notify as toast } from '../utils/notify';
import { ShopContext } from '../context/ShopContext';
import { useLocation } from 'react-router-dom';
import { loadGoogleIdentityScript } from '../utils/googleIdentity';

const GoogleIcon = () => (
  <svg viewBox='0 0 24 24' className='h-5 w-5' aria-hidden='true'>
    <path
      d='M21.8 12.22c0-.77-.07-1.51-.2-2.22H12v4.2h5.49a4.7 4.7 0 0 1-2.03 3.08v2.56h3.28c1.92-1.77 3.06-4.37 3.06-7.62Z'
      fill='#4285F4'
    />
    <path
      d='M12 22c2.76 0 5.08-.92 6.77-2.48l-3.28-2.56c-.92.62-2.08 1-3.49 1-2.68 0-4.94-1.8-5.74-4.24H2.87v2.64A10 10 0 0 0 12 22Z'
      fill='#34A853'
    />
    <path
      d='M6.26 13.72A5.98 5.98 0 0 1 6 12c0-.6.1-1.18.26-1.72V7.64H2.87A10 10 0 0 0 2 12c0 1.62.39 3.16 1.08 4.36l3.18-2.64Z'
      fill='#FBBC05'
    />
    <path
      d='M12 5.96c1.5 0 2.84.52 3.9 1.53l2.92-2.92C17.07 2.95 14.76 2 12 2a10 10 0 0 0-9.13 5.64l3.39 2.64C7.06 7.76 9.32 5.96 12 5.96Z'
      fill='#EA4335'
    />
  </svg>
);

const AppleIcon = () => (
  <svg viewBox='0 0 24 24' className='h-5 w-5' fill='currentColor' aria-hidden='true'>
    <path d='M16.33 12.29c.01 2.77 2.42 3.69 2.45 3.7-.02.06-.38 1.29-1.25 2.57-.76 1.11-1.56 2.22-2.8 2.24-1.22.02-1.62-.72-3.03-.72-1.4 0-1.85.7-3 .74-1.2.05-2.12-1.2-2.88-2.3-1.55-2.23-2.74-6.3-1.15-9.04.79-1.36 2.2-2.22 3.74-2.24 1.17-.02 2.27.78 3 1.27.72-.49 2.07-1.58 3.48-1.35.59.02 2.25.24 3.32 1.82-.09.05-1.98 1.16-1.96 3.3Zm-2.44-9.86c.63-.77 1.06-1.84.94-2.91-.9.04-1.99.6-2.64 1.37-.58.67-1.08 1.76-.95 2.8 1 .08 2.02-.5 2.65-1.26Z' />
  </svg>
);

const ButtonSpinner = () => (
  <svg className='h-5 w-5 animate-spin text-white' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
    <circle cx='12' cy='12' r='10' stroke='currentColor' strokeOpacity='0.22' strokeWidth='3' />
    <path d='M22 12a10 10 0 0 0-10-10' stroke='currentColor' strokeWidth='3' strokeLinecap='round' />
  </svg>
);

const AuthField = ({
  id,
  label,
  type = 'text',
  value,
  onChange,
  onBlur,
  placeholder,
  error,
  helper,
  maxLength,
  autoComplete,
  className = '',
}) => (
  <div className='space-y-2'>
    <label htmlFor={id} className='block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500'>
      {label}
    </label>
    <input
      id={id}
      type={type}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      placeholder={placeholder}
      maxLength={maxLength}
      autoComplete={autoComplete}
      className={`h-14 w-full rounded-[20px] border px-4 text-[16px] text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.04)] outline-none transition-all duration-200 placeholder:text-slate-400 ${
        error
          ? 'border-rose-300 bg-rose-50/90 focus:border-rose-500 focus:ring-4 focus:ring-rose-100'
          : 'border-[#e7dfda] bg-white/95 focus:border-[#d6b494] focus:bg-white focus:ring-4 focus:ring-[#e7d4c4]/40'
      } ${className}`}
      aria-invalid={Boolean(error)}
      aria-describedby={error ? `${id}-error` : helper ? `${id}-helper` : undefined}
    />
    {error ? (
      <p id={`${id}-error`} className='text-sm text-rose-600'>
        {error}
      </p>
    ) : helper ? (
      <p id={`${id}-helper`} className='text-sm leading-6 text-slate-500'>
        {helper}
      </p>
    ) : null}
  </div>
);

const SocialButton = ({ icon, label, onClick, disabled = false }) => (
  <button
    type='button'
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex h-14 w-full items-center justify-center gap-3 rounded-[20px] border border-[#e5ddd7] bg-white/90 px-4 text-sm font-medium text-slate-800 shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition-all duration-200 ${
      disabled
        ? 'cursor-not-allowed opacity-60'
        : 'hover:border-[#d6b494] hover:bg-white active:scale-[0.985]'
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);

const Login = () => {
  const [currentState, setCurrentState] = useState('Login');
  const { token, setToken, navigate, BACKEND_URL, getUserCart, serverBootstrap, serverStatus } = useContext(ShopContext);
  const location = useLocation();
  const googleButtonRef = useRef(null);
  const googleAuthContextRef = useRef({ isLogin: true, referralCode: '' });
  const googleInitializedClientIdRef = useRef('');
  const [formValues, setFormValues] = useState({
    name: '',
    email: '',
    password: '',
    referralCode: '',
  });
  const [touched, setTouched] = useState({});
  const [formErrors, setFormErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [formErrorMessage, setFormErrorMessage] = useState('');
  const [googleButtonStatus, setGoogleButtonStatus] = useState('idle');
  const isLogin = currentState === 'Login';
  const googleClientId = String(serverBootstrap?.auth?.googleClientId || '').trim();
  const isGoogleAuthEnabled = Boolean(serverBootstrap?.auth?.googleEnabled && googleClientId);
  const authHighlights = isLogin
    ? ['Wishlist sync', 'Faster checkout', 'Order tracking']
    : ['Save favorites', 'Member rewards', 'Easy reorders'];

  const validateField = useMemo(
    () => (field, value, mode) => {
      const trimmed = String(value || '').trim();
      const normalizedMode = mode || currentState;

      if (field === 'name' && normalizedMode !== 'Login') {
        if (!trimmed) {
          return 'Please enter your full name.';
        }

        if (trimmed.length < 2) {
          return 'Name should be at least 2 characters.';
        }
      }

      if (field === 'email') {
        if (!trimmed) {
          return 'Please enter your email address.';
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(trimmed)) {
          return 'Enter a valid email address.';
        }
      }

      if (field === 'password') {
        if (!value) {
          return 'Please enter your password.';
        }

        if (String(value).length < 8) {
          return 'Password should be at least 8 characters.';
        }
      }

      if (field === 'referralCode' && normalizedMode !== 'Login') {
        if (!trimmed) {
          return '';
        }

        if (!/^[A-Z0-9]{6,12}$/.test(trimmed.toUpperCase())) {
          return 'Use 6-12 letters or numbers only.';
        }
      }

      return '';
    },
    [currentState]
  );

  useEffect(() => {
    googleAuthContextRef.current = {
      isLogin,
      referralCode: String(formValues.referralCode || '').trim().toUpperCase(),
    };
  }, [formValues.referralCode, isLogin]);

  const handleGoogleCredential = useCallback(
    async (googleResponse) => {
      const credential = String(googleResponse?.credential || '').trim();
      const { isLogin: loginMode, referralCode } = googleAuthContextRef.current;

      if (!credential) {
        setFormErrorMessage('Google did not return a valid credential. Please try again.');
        toast.error('Google did not return a valid credential');
        return;
      }

      setIsGoogleSubmitting(true);
      setFormErrorMessage('');

      try {
        const response = await axios.post(BACKEND_URL + '/api/user/google', {
          credential,
          ...(!loginMode && referralCode ? { referralCode } : {}),
        });

        if (response.data.success) {
          setToken(response.data.token);
          localStorage.setItem('token', response.data.token);
          return;
        }

        const message = response.data.message || 'Unable to continue with Google right now.';
        setFormErrorMessage(message);
        toast.error(message);
      } catch (error) {
        const message = error?.response?.data?.message || 'Unable to continue with Google right now.';
        setFormErrorMessage(message);
        toast.error(message);
      } finally {
        setIsGoogleSubmitting(false);
      }
    },
    [BACKEND_URL, setToken]
  );

  useEffect(() => {
    let isCancelled = false;

    const renderGoogleButton = async () => {
      if (!isGoogleAuthEnabled || !googleButtonRef.current) {
        setGoogleButtonStatus('unavailable');
        return;
      }

      setGoogleButtonStatus('loading');

      try {
        await loadGoogleIdentityScript();

        if (isCancelled || !googleButtonRef.current || !window.google?.accounts?.id) {
          return;
        }

        if (googleInitializedClientIdRef.current !== googleClientId) {
          window.google.accounts.id.initialize({
            client_id: googleClientId,
            callback: handleGoogleCredential,
            ux_mode: 'popup',
            itp_support: true,
            use_fedcm_for_button: true,
          });
          googleInitializedClientIdRef.current = googleClientId;
        }

        googleButtonRef.current.innerHTML = '';
        const buttonWidth = Math.max(
          240,
          Math.min(392, Math.floor(googleButtonRef.current.offsetWidth || googleButtonRef.current.parentElement?.offsetWidth || 320))
        );
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: isLogin ? 'continue_with' : 'signup_with',
          shape: 'pill',
          logo_alignment: 'left',
          width: buttonWidth,
        });

        if (!isCancelled) {
          setGoogleButtonStatus('ready');
        }
      } catch {
        if (!isCancelled) {
          setGoogleButtonStatus('error');
        }
      }
    };

    renderGoogleButton();

    return () => {
      isCancelled = true;
    };
  }, [googleClientId, handleGoogleCredential, isGoogleAuthEnabled, isLogin]);

  const buildErrors = (values, mode) => {
    const fields = mode === 'Login' ? ['email', 'password'] : ['name', 'email', 'password', 'referralCode'];

    return fields.reduce((accumulator, field) => {
      const nextError = validateField(field, values[field], mode);
      if (nextError) {
        accumulator[field] = nextError;
      }
      return accumulator;
    }, {});
  };

  const handleFieldChange = (field, value) => {
    setFormValues((current) => ({ ...current, [field]: value }));
    setFormErrorMessage('');

    if (touched[field]) {
      const nextError = validateField(field, value, currentState);
      setFormErrors((current) => {
        if (!nextError) {
          const { [field]: _, ...rest } = current;
          return rest;
        }
        return { ...current, [field]: nextError };
      });
    }
  };

  const handleFieldBlur = (field) => {
    setTouched((current) => ({ ...current, [field]: true }));
    const nextError = validateField(field, formValues[field], currentState);
    setFormErrors((current) => {
      if (!nextError) {
        const { [field]: _, ...rest } = current;
        return rest;
      }
      return { ...current, [field]: nextError };
    });
  };

  const onSubmitHandler = async (event) => {
    event.preventDefault();

    const nextErrors = buildErrors(formValues, currentState);
    setFormErrors(nextErrors);
    setTouched((current) => ({
      ...current,
      email: true,
      password: true,
      ...(isLogin ? {} : { name: true, referralCode: true }),
    }));

    if (Object.keys(nextErrors).length > 0) {
      setFormErrorMessage('Please fix the highlighted fields and try again.');
      return;
    }

    setIsSubmitting(true);
    setFormErrorMessage('');

    try {
      if (currentState === 'Sign Up') {
        const payload = {
          name: formValues.name.trim(),
          email: formValues.email.trim(),
          password: formValues.password,
          ...(formValues.referralCode.trim()
            ? { referralCode: formValues.referralCode.trim().toUpperCase() }
            : {}),
        };
        const response = await axios.post(BACKEND_URL + '/api/user/register', payload);

        if (response.data.success) {
          setToken(response.data.token);
          localStorage.setItem('token', response.data.token);
          return;
        }

        setFormErrorMessage(response.data.message || 'Unable to create account right now.');
        toast.error(response.data.message || 'Unable to create account');
        return;
      }

      const response = await axios.post(BACKEND_URL + '/api/user/login', {
        email: formValues.email.trim(),
        password: formValues.password,
      });

      if (response.data.success) {
        setToken(response.data.token);
        localStorage.setItem('token', response.data.token);
        return;
      }

      setFormErrorMessage(response.data.message || 'Unable to sign in right now.');
      toast.error(response.data.message || 'Unable to sign in');
    } catch (error) {
      setFormErrorMessage(error?.response?.data?.message || 'Something went wrong. Please try again.');
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (token) {
      navigate('/');
      getUserCart(localStorage.getItem('token'));
    }
  }, [token, navigate, getUserCart]);

  useEffect(() => {
    setFormErrors({});
    setTouched({});
    setFormErrorMessage('');
  }, [currentState]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const queryReferralCode =
      String(params.get('ref') || params.get('referral') || params.get('referralCode') || '')
        .trim()
        .toUpperCase();

    if (!queryReferralCode) {
      return;
    }

    if (!/^[A-Z0-9]{6,12}$/.test(queryReferralCode)) {
      return;
    }

    setCurrentState('Sign Up');
    setFormValues((current) => ({
      ...current,
      referralCode: queryReferralCode,
    }));
  }, [location.search]);

  return (
    <section className='auth-shell mx-auto w-full max-w-[460px] pb-16 pt-5 sm:pt-10'>
      <div className='relative overflow-hidden rounded-[34px] border border-[#efe5df] bg-[linear-gradient(180deg,#fffdf9_0%,#ffffff_42%,#fff8f0_100%)] px-5 py-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] sm:px-8 sm:py-8'>
        <div className='pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(circle_at_top_left,_rgba(225,197,173,0.45),_transparent_58%),radial-gradient(circle_at_top_right,_rgba(15,23,42,0.08),_transparent_46%)]'></div>
        <div className='pointer-events-none absolute -right-14 top-24 h-32 w-32 rounded-full bg-[#ead6c4]/25 blur-3xl'></div>
        <div className='pointer-events-none absolute -left-14 bottom-18 h-36 w-36 rounded-full bg-[#f3e8dc] blur-3xl'></div>

        <div className='relative'>
          <div className='inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-600 shadow-[0_8px_20px_rgba(15,23,42,0.05)]'>
            <span className='h-2 w-2 rounded-full bg-[#d8b89c]'></span>
            Lavish Members
          </div>

          <div className='mt-6 text-center'>
            <div className='flex items-center justify-center gap-3'>
              <span className='hidden h-px w-10 bg-[#d7cec7] sm:block'></span>
              <h1 className='prata-regular text-[44px] leading-[0.92] tracking-[-0.04em] text-[#0f172a] sm:text-[56px]'>
                {isLogin ? 'Login' : 'Sign Up'}
              </h1>
              <span className='h-px w-9 bg-[#d7cec7]'></span>
            </div>
            <p className='mx-auto mt-4 max-w-[320px] text-[15px] leading-7 text-slate-500 sm:text-base'>
              {isLogin
                ? 'Welcome back. Step into your saved wishlist, order updates, and a smoother checkout flow.'
                : 'Create your Lavish account to save favorites, unlock member perks, and checkout faster.'}
            </p>
            <div className='mt-5 flex flex-wrap justify-center gap-2'>
              {authHighlights.map((highlight) => (
                <span
                  key={highlight}
                  className='rounded-full border border-white/90 bg-white/88 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.04)]'
                >
                  {highlight}
                </span>
              ))}
            </div>
          </div>

          <div className='mt-8 rounded-[28px] border border-[#ece2dc] bg-white/88 p-4 shadow-[0_16px_34px_rgba(15,23,42,0.06)] backdrop-blur'>
            <div className='flex items-start justify-between gap-4'>
              <div>
                <p className='text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500'>Quick Access</p>
                <p className='mt-2 text-sm leading-6 text-slate-600'>
                  {isLogin ? 'Use a linked account and get back to shopping instantly.' : 'Start with your preferred account and finish setup in seconds.'}
                </p>
              </div>
              <div className='rounded-full bg-[#f6ede5] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8d6c54]'>
                Fast lane
              </div>
            </div>

            <div className='mt-4 space-y-3'>
              {isGoogleAuthEnabled ? (
                <div className='space-y-2'>
                  <div
                    className={`flex min-h-14 items-center justify-center rounded-[20px] border border-[#e5ddd7] bg-[#fcfaf7] px-2 py-2 shadow-[0_10px_24px_rgba(15,23,42,0.04)] ${
                      isGoogleSubmitting ? 'pointer-events-none opacity-70' : ''
                    }`}
                  >
                    <div ref={googleButtonRef} className='flex w-full justify-center' />
                  </div>
                  {googleButtonStatus === 'loading' ? (
                    <p className='text-sm text-slate-500'>Loading Google sign-in...</p>
                  ) : null}
                  {googleButtonStatus === 'error' ? (
                    <p className='text-sm text-rose-600'>Google sign-in could not load right now. Please refresh and try again.</p>
                  ) : null}
                  {isGoogleSubmitting ? (
                    <p className='text-sm text-slate-500'>Finishing Google sign-in...</p>
                  ) : null}
                </div>
              ) : (
                <SocialButton
                  icon={<GoogleIcon />}
                  label={serverStatus === 'checking' ? 'Loading Google sign-in...' : 'Google sign-in unavailable'}
                  onClick={() => {}}
                  disabled
                />
              )}

              <SocialButton
                icon={<AppleIcon />}
                label={isLogin ? 'Continue with Apple' : 'Sign up with Apple'}
                onClick={() => toast.info('Apple sign-in will be available soon.')}
              />
            </div>
          </div>

          <div className='my-6 flex items-center gap-3'>
            <span className='h-px flex-1 bg-[#e5ddd7]'></span>
            <span className='rounded-full border border-[#eadfd7] bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400'>
              Use email instead
            </span>
            <span className='h-px flex-1 bg-[#e5ddd7]'></span>
          </div>

          <form onSubmit={onSubmitHandler} className='space-y-4'>
            <div className='rounded-[28px] border border-[#ece2dc] bg-white/88 p-4 shadow-[0_16px_34px_rgba(15,23,42,0.05)] backdrop-blur sm:p-5'>
              <div className='space-y-4'>
                {isLogin ? null : (
                  <AuthField
                    id='name'
                    label='Full Name'
                    value={formValues.name}
                    onChange={(event) => handleFieldChange('name', event.target.value)}
                    onBlur={() => handleFieldBlur('name')}
                    placeholder='Enter your full name'
                    autoComplete='name'
                    error={touched.name ? formErrors.name : ''}
                  />
                )}

                <AuthField
                  id='email'
                  label='Email'
                  type='email'
                  value={formValues.email}
                  onChange={(event) => handleFieldChange('email', event.target.value)}
                  onBlur={() => handleFieldBlur('email')}
                  placeholder='you@example.com'
                  autoComplete='email'
                  error={touched.email ? formErrors.email : ''}
                />

                <AuthField
                  id='password'
                  label='Password'
                  type='password'
                  value={formValues.password}
                  onChange={(event) => handleFieldChange('password', event.target.value)}
                  onBlur={() => handleFieldBlur('password')}
                  placeholder='Enter your password'
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  error={touched.password ? formErrors.password : ''}
                />

                {isLogin ? null : (
                  <AuthField
                    id='referralCode'
                    label='Referral Code (Optional)'
                    type='text'
                    value={formValues.referralCode}
                    onChange={(event) => handleFieldChange('referralCode', event.target.value.toUpperCase())}
                    onBlur={() => handleFieldBlur('referralCode')}
                    placeholder='Add a friend code for welcome perks'
                    maxLength='12'
                    autoComplete='off'
                    className='uppercase'
                    error={touched.referralCode ? formErrors.referralCode : ''}
                    helper='Add a friend code now to unlock new-customer rewards from your very first order.'
                  />
                )}
              </div>
            </div>

            {formErrorMessage ? (
              <div className='rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-[0_10px_24px_rgba(244,63,94,0.08)]'>
                {formErrorMessage}
              </div>
            ) : null}

            <div className='rounded-[24px] border border-[#ece2dc] bg-white/88 p-4 shadow-[0_16px_34px_rgba(15,23,42,0.05)] backdrop-blur'>
              <div className='flex items-center justify-between gap-4 text-sm'>
                {isLogin ? (
                  <button
                    type='button'
                    onClick={() => toast.info('Password reset support is coming soon.')}
                    className='font-medium text-slate-500 transition-colors hover:text-slate-900'
                  >
                    Forgot password?
                  </button>
                ) : (
                  <span className='max-w-[220px] text-slate-500'>Your referral code can be added now for a smooth first checkout.</span>
                )}

                {isLogin ? (
                  <button
                    type='button'
                    onClick={() => setCurrentState('Sign Up')}
                    className='font-semibold text-slate-900 transition-colors hover:text-[#8d6c54]'
                  >
                    Create account
                  </button>
                ) : (
                  <button
                    type='button'
                    onClick={() => setCurrentState('Login')}
                    className='font-semibold text-slate-900 transition-colors hover:text-[#8d6c54]'
                  >
                    Login here
                  </button>
                )}
              </div>

              <button
                type='submit'
                disabled={isSubmitting}
                className='mt-4 inline-flex h-14 w-full items-center justify-center gap-2 rounded-[20px] bg-[linear-gradient(135deg,#111827_0%,#1f2937_48%,#b79577_135%)] text-base font-medium text-white shadow-[0_16px_34px_rgba(15,23,42,0.18)] transition-all duration-200 hover:scale-[1.01] hover:brightness-[1.02] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-70'
              >
                {isSubmitting ? <ButtonSpinner /> : null}
                <span>{isSubmitting ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
};

export default Login;
