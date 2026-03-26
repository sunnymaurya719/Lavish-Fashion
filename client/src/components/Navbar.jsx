import React, { useContext, useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { assets } from '../assets/assets';
import { ShopContext } from '../context/ShopContext';

const HeartIcon = ({ filled = false }) => (
  <svg width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
    <path
      d='M12 20.4 10.55 19.08C5.4 14.36 2 11.24 2 7.42 2 4.3 4.42 2 7.5 2c1.74 0 3.42.81 4.5 2.09A5.9 5.9 0 0 1 16.5 2C19.58 2 22 4.3 22 7.42c0 3.82-3.4 6.94-8.55 11.69L12 20.4Z'
      fill={filled ? 'currentColor' : 'none'}
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinejoin='round'
    />
  </svg>
);

const HomeMenuIcon = ({ className = '' }) => (
  <svg viewBox='0 0 24 24' fill='none' className={className} aria-hidden='true'>
    <path d='M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3v-10.5Z' stroke='currentColor' strokeWidth='1.7' strokeLinejoin='round' />
  </svg>
);

const CollectionMenuIcon = ({ className = '' }) => (
  <svg viewBox='0 0 24 24' fill='none' className={className} aria-hidden='true'>
    <path d='M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' stroke='currentColor' strokeWidth='1.7' />
  </svg>
);

const AboutMenuIcon = ({ className = '' }) => (
  <svg viewBox='0 0 24 24' fill='none' className={className} aria-hidden='true'>
    <circle cx='12' cy='12' r='9' stroke='currentColor' strokeWidth='1.7' />
    <path d='M12 10v6M12 7.5h.01' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' />
  </svg>
);

const ContactMenuIcon = ({ className = '' }) => (
  <svg viewBox='0 0 24 24' fill='none' className={className} aria-hidden='true'>
    <rect x='3' y='5' width='18' height='14' rx='2' stroke='currentColor' strokeWidth='1.7' />
    <path d='m4 7 8 6 8-6' stroke='currentColor' strokeWidth='1.7' strokeLinejoin='round' />
  </svg>
);

const ProfileMenuIcon = ({ className = '' }) => (
  <svg viewBox='0 0 24 24' fill='none' className={className} aria-hidden='true'>
    <circle cx='12' cy='8' r='3.5' stroke='currentColor' strokeWidth='1.7' />
    <path d='M5 20a7 7 0 0 1 14 0' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' />
  </svg>
);

const OrdersMenuIcon = ({ className = '' }) => (
  <svg viewBox='0 0 24 24' fill='none' className={className} aria-hidden='true'>
    <path d='M6 7h12M6 12h12M6 17h8M4 4h16v16H4z' stroke='currentColor' strokeWidth='1.7' />
  </svg>
);

const RewardsMenuIcon = ({ className = '' }) => (
  <svg viewBox='0 0 24 24' fill='none' className={className} aria-hidden='true'>
    <path d='M12 3 14.7 8.48 21 9.4l-4.5 4.38 1.06 6.2L12 17.14 6.44 19.98 7.5 13.78 3 9.4l6.3-.92L12 3Z' stroke='currentColor' strokeWidth='1.7' strokeLinejoin='round' />
  </svg>
);

const WishlistMenuIcon = ({ className = '' }) => (
  <svg viewBox='0 0 24 24' fill='none' className={className} aria-hidden='true'>
    <path d='M12 20.4 10.55 19.08C5.4 14.36 2 11.24 2 7.42 2 4.3 4.42 2 7.5 2c1.74 0 3.42.81 4.5 2.09A5.9 5.9 0 0 1 16.5 2C19.58 2 22 4.3 22 7.42c0 3.82-3.4 6.94-8.55 11.69L12 20.4Z' stroke='currentColor' strokeWidth='1.7' strokeLinejoin='round' />
  </svg>
);

const LogoutMenuIcon = ({ className = '' }) => (
  <svg viewBox='0 0 24 24' fill='none' className={className} aria-hidden='true'>
    <path d='M15 7V4H4v16h11v-3M10 12h10M17 8l4 4-4 4' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' strokeLinejoin='round' />
  </svg>
);

const ChevronRightIcon = ({ className = '' }) => (
  <svg viewBox='0 0 24 24' fill='none' className={className} aria-hidden='true'>
    <path d='m9 6 6 6-6 6' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' strokeLinejoin='round' />
  </svg>
);

const CloseMenuIcon = ({ className = '' }) => (
  <svg viewBox='0 0 24 24' fill='none' className={className} aria-hidden='true'>
    <path d='M6 6 18 18M18 6 6 18' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' />
  </svg>
);

const mainMenuItems = [
  { label: 'Home', to: '/', icon: HomeMenuIcon },
  { label: 'Collections', to: '/collection', icon: CollectionMenuIcon },
  { label: 'About', to: '/about', icon: AboutMenuIcon },
  { label: 'Contact', to: '/contact', icon: ContactMenuIcon },
];

const accountMenuItems = [
  { label: 'Profile', to: '/profile', icon: ProfileMenuIcon },
  { label: 'Orders', to: '/orders', icon: OrdersMenuIcon },
  { label: 'Rewards', to: '/rewards', icon: RewardsMenuIcon },
  { label: 'Wishlist', to: '/wishlist', icon: WishlistMenuIcon },
];

const Navbar = () => {
  const [visible, setVisible] = useState(false);
  const {
    clearSession,
    getCartCount,
    getWishlistCount,
    navigate,
    setShowSearch,
    token,
  } = useContext(ShopContext);

  const logOutHandler = () => {
    clearSession({ message: 'Logged out successfully' });
  };

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const originalOverflow = document.body.style.overflow;

    const onEscape = (event) => {
      if (event.key === 'Escape') {
        setVisible(false);
      }
    };

    if (visible) {
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', onEscape);
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', onEscape);
    };
  }, [visible]);

  const drawerNavItemClass = ({ isActive }) =>
    `group flex items-center justify-between rounded-xl px-4 py-3.5 text-[17px] font-medium tracking-[0.02em] transition-colors ${
      isActive
        ? 'bg-[#f8f3ee] text-slate-900 ring-1 ring-[#eadccc]'
        : 'text-slate-700 hover:bg-slate-50 active:bg-slate-100'
    }`;

  const drawerChevronClass = (isActive) =>
    `h-4 w-4 transition-colors ${isActive ? 'text-[#c9ab8b]' : 'text-slate-400/80'}`;

  return (
    <div className='flex justify-between items-center py-5 font-medium'>
      <Link to='/'>
        <img src={assets.Lavishlogo} alt='Lavish Fashion Logo' className='w-30' />
      </Link>

      <ul className='hidden sm:flex gap-5 text-sm text-gray-700'>
        <NavLink to='/' className='flex flex-col items-center gap-1 '>
          <p>HOME</p>
          <hr className='w-2/4 border-none h-[1.5px] bg-gray-700 hidden' />
        </NavLink>

        <NavLink to='/collection' className='flex flex-col items-center gap-1'>
          <p>COLLECTION</p>
          <hr className='w-2/4 border-none h-[1.5px] bg-gray-700 hidden' />
        </NavLink>

        <NavLink to='/about' className='flex flex-col items-center gap-1'>
          <p>ABOUT</p>
          <hr className='w-2/4 border-none h-[1.5px] bg-gray-700 hidden' />
        </NavLink>

        <NavLink to='/contact' className='flex flex-col items-center gap-1'>
          <p>CONTACT</p>
          <hr className='w-2/4 border-none h-[1.5px] bg-gray-700 hidden' />
        </NavLink>

        {token ? (
          <NavLink to='/rewards' className='flex flex-col items-center gap-1'>
            <p>REWARDS</p>
            <hr className='w-2/4 border-none h-[1.5px] bg-gray-700 hidden' />
          </NavLink>
        ) : null}
      </ul>

      <div className='flex items-center gap-6'>
        <img
          onClick={() => setShowSearch(true)}
          src={assets.search_icon}
          alt='search_icon'
          className='w-5 cursor-pointer'
        />

        <Link to='/wishlist' className='relative text-slate-700'>
          <HeartIcon filled={getWishlistCount() > 0} />
          <p className='absolute right-[-7px] bottom-[-7px] min-w-4 px-1 text-center leading-4 bg-black text-white rounded-full text-[8px]'>
            {getWishlistCount()}
          </p>
        </Link>

        <div className='group relative'>
          {token ? (
            <>
              <Link to='/profile' className='sm:hidden'>
                <img src={assets.profile_icon} alt='profile_icon' className='w-5 cursor-pointer' />
              </Link>
              <img src={assets.profile_icon} alt='profile_icon' className='hidden sm:block w-5 cursor-pointer' />
            </>
          ) : (
            <Link to='/login'>
              <img src={assets.profile_icon} alt='profile_icon' className='w-5 cursor-pointer' />
            </Link>
          )}

          {token ? (
            <div className='hidden sm:group-hover:block absolute dropdown-menu right-0 pt-4 z-50'>
              <div className='flex flex-col gap-2 w-40 py-3 px-5 bg-slate-100 text-gray-500 rounded'>
                <button
                  type='button'
                  onClick={() => navigate('/profile')}
                  className='text-left cursor-pointer hover:text-black'
                >
                  My Profile
                </button>
                <button
                  type='button'
                  onClick={() => navigate('/orders')}
                  className='text-left cursor-pointer hover:text-black'
                >
                  Orders
                </button>
                <button
                  type='button'
                  onClick={() => navigate('/rewards')}
                  className='text-left cursor-pointer hover:text-black'
                >
                  Rewards
                </button>
                <button
                  type='button'
                  onClick={() => navigate('/wishlist')}
                  className='text-left cursor-pointer hover:text-black'
                >
                  Wishlist
                </button>
                <button
                  type='button'
                  onClick={logOutHandler}
                  className='text-left cursor-pointer hover:text-black'
                >
                  Logout
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <Link to='/cart' className='relative'>
          <img src={assets.cart_icon} alt='' className='w-5 min-w-5' />
          <p className='absolute right-[-5px] bottom-[-5px] w-4 text-center leading-4 bg-black text-white aspect-square rounded-full text-[8px]'>
            {getCartCount()}
          </p>
        </Link>

        <img
          onClick={() => setVisible(true)}
          src={assets.menu_icon}
          alt='menu_icon'
          aria-label='Open navigation menu'
          className='w-5 cursor-pointer sm:hidden'
        />
      </div>

      <div className={`sm:hidden fixed inset-0 z-[120] ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        <button
          type='button'
          onClick={() => setVisible(false)}
          aria-label='Close navigation menu'
          className={`absolute inset-0 bg-slate-900/30 transition-opacity duration-300 ${
            visible ? 'opacity-100' : 'opacity-0'
          }`}
        ></button>

        <aside
          className={`absolute inset-y-0 left-0 w-[84%] max-w-[340px] bg-white shadow-[0_22px_55px_rgba(15,23,42,0.18)] transition-transform duration-300 ease-out ${
            visible ? 'translate-x-0' : '-translate-x-full'
          }`}
          aria-hidden={!visible}
        >
          <span className='pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-[#f2e9df] via-[#dcc4ad] to-[#f3ece3]'></span>

          <div className='flex items-center justify-between px-5 py-5 border-b border-slate-100'>
            <p className='inline-flex items-center gap-2 text-[18px] font-semibold tracking-[0.04em] text-slate-900'>
              <span className='h-1.5 w-1.5 rounded-full bg-[#d8bea5]'></span>
              Menu
            </p>
            <button
              type='button'
              onClick={() => setVisible(false)}
              aria-label='Close menu'
              className='rounded-full p-1 text-slate-600 hover:bg-slate-100'
            >
              <CloseMenuIcon className='h-5 w-5' />
            </button>
          </div>

          <div className='h-full overflow-y-auto px-3 py-4'>
            <p className='px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.24em] text-slate-400 inline-flex items-center gap-2'>
              <span className='h-1.5 w-1.5 rounded-full bg-[#d8bea5]/90'></span>
              Main
            </p>

            <div className='space-y-1'>
              {mainMenuItems.map((item) => {
                const Icon = item.icon;

                return (
                  <NavLink
                    key={item.label}
                    to={item.to}
                    onClick={() => setVisible(false)}
                    className={drawerNavItemClass}
                  >
                    {({ isActive }) => (
                      <>
                        <span className='flex items-center gap-3'>
                          <Icon className='h-[18px] w-[18px]' />
                          <span>{item.label}</span>
                        </span>
                        <ChevronRightIcon className={drawerChevronClass(isActive)} />
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>

            <div className='mx-3 my-4 h-px bg-slate-100'></div>

            <p className='px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.24em] text-slate-400 inline-flex items-center gap-2'>
              <span className='h-1.5 w-1.5 rounded-full bg-[#d8bea5]/90'></span>
              Account
            </p>

            {token ? (
              <div className='space-y-1'>
                {accountMenuItems.map((item) => {
                  const Icon = item.icon;

                  return (
                    <NavLink
                      key={item.label}
                      to={item.to}
                      onClick={() => setVisible(false)}
                      className={drawerNavItemClass}
                    >
                      {({ isActive }) => (
                        <>
                          <span className='flex items-center gap-3'>
                            <Icon className='h-[18px] w-[18px]' />
                            <span>{item.label}</span>
                          </span>
                          <ChevronRightIcon className={drawerChevronClass(isActive)} />
                        </>
                      )}
                    </NavLink>
                  );
                })}

                <button
                  type='button'
                  onClick={() => {
                    setVisible(false);
                    logOutHandler();
                  }}
                  className='group flex w-full items-center justify-between rounded-xl px-4 py-3.5 text-[17px] font-medium tracking-[0.02em] text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100'
                >
                  <span className='flex items-center gap-3'>
                    <LogoutMenuIcon className='h-[18px] w-[18px]' />
                    <span>Logout</span>
                  </span>
                  <ChevronRightIcon className='h-4 w-4 opacity-55' />
                </button>
              </div>
            ) : (
              <NavLink to='/login' onClick={() => setVisible(false)} className={drawerNavItemClass}>
                {({ isActive }) => (
                  <>
                    <span className='flex items-center gap-3'>
                      <ProfileMenuIcon className='h-[18px] w-[18px]' />
                      <span>Login</span>
                    </span>
                    <ChevronRightIcon className={drawerChevronClass(isActive)} />
                  </>
                )}
              </NavLink>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default Navbar;
