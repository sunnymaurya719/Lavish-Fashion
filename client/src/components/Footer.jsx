import React from 'react';
import { Link } from 'react-router-dom';
import { assets } from '../assets/assets';

const Footer = () => {
  return (
    <div>
      <div className='flex flex-col sm:grid grid-cols-[3fr_1fr_1fr] gap-14 my-10 mt-5 text-sm'>
        <div>
          <img src={assets.Lavishlogo} alt='' className='mb-5 w-32' />
          <p className='w-full md:w-2/3 text-gray-600'>
            Lavish Fashion is a modern fashion storefront focused on clean design, reliable checkout,
            and an easy post-purchase experience for customers.
          </p>
        </div>
        <div>
          <p className='text-xl font-medium mb-5'>COMPANY</p>
          <ul className='flex flex-col gap-1 text-gray-600'>
            <li>
              <Link to='/'>Home</Link>
            </li>
            <li>
              <Link to='/about'>About us</Link>
            </li>
            <li>
              <Link to='/collection'>Collections</Link>
            </li>
            <li>
              <Link to='/contact'>Contact</Link>
            </li>
          </ul>
        </div>

        <div>
          <p className='text-xl font-medium mb-5'>GET IN TOUCH</p>
          <ul className='flex flex-col gap-1 text-gray-600'>
            <li>support@lavishfashion.com</li>
            <li>Mon-Sat | 10:00 AM - 6:00 PM IST</li>
          </ul>
        </div>
      </div>

      <div>
        <hr />
        <p className='py-5 text-sm text-center'>Copyright 2026 LavishFashion.com - All Rights Reserved</p>
      </div>
    </div>
  );
};

export default Footer;
