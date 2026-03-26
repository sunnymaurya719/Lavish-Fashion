import React, { useContext, useState } from 'react';
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

const Navbar = () => {
  const [visible, setVisible] = useState(false);
  const {
    clearSession,
    getCartCount,
    getWishlistCount,
    navigate,
    serverStatus,
    setShowSearch,
    token,
  } = useContext(ShopContext);

  const logOutHandler = () => {
    clearSession({ message: 'Logged out successfully' });
  };

  const serverBadge =
    serverStatus === 'online'
      ? { label: 'API online', classes: 'bg-emerald-50 text-emerald-700' }
      : serverStatus === 'offline'
        ? { label: 'API offline', classes: 'bg-rose-50 text-rose-700' }
        : { label: 'Checking API', classes: 'bg-slate-100 text-slate-600' };

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
        <div className={`hidden rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] md:block ${serverBadge.classes}`}>
          {serverBadge.label}
        </div>

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
            <img src={assets.profile_icon} alt='profile_icon' className='w-5 cursor-pointer' />
          ) : (
            <Link to='/login'>
              <img src={assets.profile_icon} alt='profile_icon' className='w-5 cursor-pointer' />
            </Link>
          )}

          {token ? (
            <div className='group-hover:block hidden absolute dropdown-menu right-0 pt-4'>
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
          className='w-5 cursor-pointer sm:hidden'
        />
      </div>

      <div
        className={`absolute top-0 right-0 bottom-0 overflow-hidden bg-white transition-all ${
          visible ? 'w-full' : 'w-0'
        }`}
      >
        <div className='flex flex-col text-gray-600'>
          <div
            onClick={() => setVisible(false)}
            className='flex items-center gap-4 p-3 cursor-pointer hover:bg-gray-200'
          >
            <img src={assets.dropdown_icon} alt='' className='h-4 rotate-180' />
            <p>Back</p>
          </div>
          <NavLink onClick={() => setVisible(false)} className='py-2 pl-6 hover:bg-gray-200' to='/'>
            HOME
          </NavLink>
          <NavLink
            onClick={() => setVisible(false)}
            className='py-2 pl-6 hover:bg-gray-200'
            to='/collection'
          >
            COLLECTION
          </NavLink>
          <NavLink
            onClick={() => setVisible(false)}
            className='py-2 pl-6 hover:bg-gray-200'
            to='/about'
          >
            ABOUT
          </NavLink>
          <NavLink
            onClick={() => setVisible(false)}
            className='py-2 pl-6 hover:bg-gray-200'
            to='/contact'
          >
            CONTACT
          </NavLink>
          {token ? (
            <>
              <NavLink
                onClick={() => setVisible(false)}
                className='py-2 pl-6 hover:bg-gray-200'
                to='/profile'
              >
                PROFILE
              </NavLink>
              <NavLink
                onClick={() => setVisible(false)}
                className='py-2 pl-6 hover:bg-gray-200'
                to='/orders'
              >
                ORDERS
              </NavLink>
              <NavLink
                onClick={() => setVisible(false)}
                className='py-2 pl-6 hover:bg-gray-200'
                to='/rewards'
              >
                REWARDS
              </NavLink>
              <NavLink
                onClick={() => setVisible(false)}
                className='py-2 pl-6 hover:bg-gray-200'
                to='/wishlist'
              >
                WISHLIST
              </NavLink>
              <button
                type='button'
                onClick={() => {
                  setVisible(false);
                  logOutHandler();
                }}
                className='py-2 pl-6 text-left hover:bg-gray-200'
              >
                LOGOUT
              </button>
            </>
          ) : (
            <NavLink
              onClick={() => setVisible(false)}
              className='py-2 pl-6 hover:bg-gray-200'
              to='/login'
            >
              LOGIN
            </NavLink>
          )}
        </div>
      </div>
    </div>
  );
};

export default Navbar;
