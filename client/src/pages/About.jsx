import React from 'react';
import Title from '../components/Title';
import { assets } from '../assets/assets';

const About = () => {
  return (
    <div>
      <div className='text-2xl text-center pt-8 border-t'>
        <Title text1='ABOUT' text2='US' />
      </div>

      <div className='my-10 flex flex-col md:flex-row gap-16'>
        <img className='w-full md:max-w-[450px]' src={assets.about_img} alt='About Lavish Fashion' />
        <div className='flex flex-col justify-center gap-6 md:w-2/4 text-gray-600'>
          <p>
            Lavish Fashion is built for shoppers who want polished everyday style without the noise.
            We focus on wearable collections, clear product presentation, and a buying experience that
            feels simple from discovery to delivery.
          </p>
          <p>
            Our storefront is curated around wardrobe staples, seasonal layers, and easy-to-shop
            categories so customers can find what they need quickly while still discovering new looks.
          </p>
          <b className='text-gray-800'>Our Mission</b>
          <p>
            Our mission is to make modern fashion feel accessible, trustworthy, and well organized by
            combining thoughtful product curation with a clean digital shopping experience.
          </p>
        </div>
      </div>

      <div className='text-xl py-4'>
        <Title text1='WHY' text2='CHOOSE US' />
      </div>

      <div className='flex flex-col md:flex-row text-sm mb-20'>
        <div className='border px-10 md:px-16 py-8 sm:py-20 flex flex-col gap-5'>
          <b>Quality-first assortment</b>
          <p className='text-gray-600'>
            We focus on styles that are easy to wear, easy to pair, and strong enough to earn repeat
            use in real wardrobes.
          </p>
        </div>
        <div className='border px-10 md:px-16 py-8 sm:py-20 flex flex-col gap-5'>
          <b>Convenient shopping flow</b>
          <p className='text-gray-600'>
            From filtering and checkout to order updates, the store is designed to reduce friction at
            every step.
          </p>
        </div>
        <div className='border px-10 md:px-16 py-8 sm:py-20 flex flex-col gap-5'>
          <b>Customer support mindset</b>
          <p className='text-gray-600'>
            We aim to make it easy for customers to get help with sizing, orders, and post-purchase
            questions when they need it.
          </p>
        </div>
      </div>
    </div>
  );
};

export default About;
