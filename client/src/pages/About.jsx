import React from 'react';
import { assets } from '../assets/assets';

const QualityIcon = () => (
  <svg viewBox='0 0 24 24' fill='none' className='h-5 w-5' aria-hidden='true'>
    <path d='M12 3 4 7v5c0 5.3 3.6 8.9 8 10 4.4-1.1 8-4.7 8-10V7l-8-4Z' stroke='currentColor' strokeWidth='1.7' strokeLinejoin='round' />
    <path d='m9 12 2 2 4-4' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' strokeLinejoin='round' />
  </svg>
);

const FlowIcon = () => (
  <svg viewBox='0 0 24 24' fill='none' className='h-5 w-5' aria-hidden='true'>
    <path d='M6 7h12M6 12h8M6 17h12' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' />
    <path d='m16 10 2 2-2 2' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' strokeLinejoin='round' />
  </svg>
);

const SupportIcon = () => (
  <svg viewBox='0 0 24 24' fill='none' className='h-5 w-5' aria-hidden='true'>
    <path d='M4 12a8 8 0 1 1 16 0v4a2 2 0 0 1-2 2h-3v-5h5M4 13h5v5H6a2 2 0 0 1-2-2v-3Z' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' strokeLinejoin='round' />
  </svg>
);

const whyChooseCards = [
  {
    title: 'Quality-first assortment',
    description:
      'We focus on styles that are easy to wear, easy to pair, and strong enough to earn repeat use in real wardrobes.',
    Icon: QualityIcon,
  },
  {
    title: 'Convenient shopping flow',
    description:
      'From filtering and checkout to order updates, the store is designed to reduce friction at every step.',
    Icon: FlowIcon,
  },
  {
    title: 'Customer support mindset',
    description:
      'We make it simple to get sizing help, delivery updates, and post-purchase support whenever needed.',
    Icon: SupportIcon,
  },
];

const storyPoints = [
  'Polished, wearable collections curated for everyday style.',
  'Clean product presentation that helps customers decide faster.',
  'A calm buying journey from discovery to doorstep.',
];

const About = () => {
  return (
    <section className='pt-6 sm:pt-8'>
      <header className='text-center'>
        <p className='text-[11px] uppercase tracking-[0.24em] text-[#777]'>About</p>
        <h1 className='mt-2 text-[2rem] sm:text-[2.45rem] font-semibold tracking-[-0.015em] text-[#111] leading-[0.95]'>
          Our Story
        </h1>
      </header>

      <div className='mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]'>
        <div className='grid grid-cols-2 gap-3'>
          <img
            className='col-span-2 h-[250px] sm:h-[320px] w-full rounded-2xl object-cover'
            src={assets.about_img}
            alt='Lavish Fashion styling flat lay'
          />
          <img
            className='h-[140px] sm:h-[170px] w-full rounded-2xl object-cover'
            src={assets.contact_img}
            alt='Lavish Fashion seasonal collection look'
          />
          <img
            className='h-[140px] sm:h-[170px] w-full rounded-2xl object-cover'
            src={assets.about_img}
            alt='Lavish Fashion curated wardrobe essentials'
          />
        </div>

        <div className='space-y-6'>
          <p className='text-sm leading-7 text-[#777]'>
            Lavish Fashion is built for shoppers who want polished everyday style without the noise.
            We design a storefront that feels modern, calm, and easy to shop.
          </p>

          <ul className='space-y-3 text-sm text-[#777]'>
            {storyPoints.map((point, index) => (
              <li key={index} className='flex gap-2.5 leading-6'>
                <span className='mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#9aa1ad]'></span>
                <span>{point}</span>
              </li>
            ))}
          </ul>

          <div className='rounded-2xl bg-[#f5f5f5] p-6'>
            <p className='text-[11px] uppercase tracking-[0.22em] text-[#777]'>Mission</p>
            <p className='mt-3 text-sm leading-7 text-[#666]'>
              Our mission is to make modern fashion feel accessible, trustworthy, and well-organized
              through thoughtful curation and a clean digital shopping experience.
            </p>
          </div>
        </div>
      </div>

      <section className='mt-10 sm:mt-12'>
        <p className='text-[11px] uppercase tracking-[0.24em] text-[#777]'>Why Choose Us</p>
        <div className='mt-4 grid gap-4 sm:grid-cols-2'>
          {whyChooseCards.map(({ title, description, Icon }) => (
            <article
              key={title}
              className='rounded-2xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.06)]'
            >
              <div className='inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#f5f5f5] text-[#111]'>
                <Icon />
              </div>
              <h2 className='mt-4 text-xl font-semibold text-[#111]'>{title}</h2>
              <p className='mt-3 text-sm leading-7 text-[#777]'>{description}</p>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
};

export default About;
