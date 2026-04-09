import React, { memo } from 'react';
import { Link } from 'react-router-dom';
import { assets } from '../assets/assets';

const Footer = () => {
  return (
    <footer className='border-t border-slate-200/80 pt-8'>
      <div className='grid gap-8 sm:grid-cols-[2.2fr_1fr_1fr] text-sm'>
        <div>
          <img src={assets.Lavishlogo} alt='Lavish Fashion Logo' className='mb-4 w-32' />
          <p className='text-[#777]'>Clean silhouettes, elevated essentials.</p>
        </div>

        <div>
          <p className='text-[11px] uppercase tracking-[0.22em] text-[#111] mb-4'>Company</p>
          <ul className='flex flex-col gap-2 text-[#777]'>
            <li>
              <Link to='/' className='hover:text-[#111] transition-colors'>Home</Link>
            </li>
            <li>
              <Link to='/about' className='hover:text-[#111] transition-colors'>About</Link>
            </li>
            <li>
              <Link to='/collection' className='hover:text-[#111] transition-colors'>Collections</Link>
            </li>
            <li>
              <Link to='/contact' className='hover:text-[#111] transition-colors'>Contact</Link>
            </li>
          </ul>
        </div>

        <div>
          <p className='text-[11px] uppercase tracking-[0.22em] text-[#111] mb-4'>Get In Touch</p>
          <ul className='flex flex-col gap-2 text-[#777]'>
            <li>support@lavishfashion.com</li>
            <li>Mon-Sat | 10:00 AM - 6:00 PM IST</li>
          </ul>
        </div>
      </div>

      <div className='mt-8 border-t border-slate-200/80'>
        <p className='py-5 text-sm text-center text-[#777]'>Copyright 2026 LavishFashion.com - All Rights Reserved</p>
      </div>
    </footer>
  );
};

export default memo(Footer);
