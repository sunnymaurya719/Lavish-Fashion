import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { assets } from '../assets/assets';

const LocationIcon = ({ className = '' }) => (
  <svg viewBox='0 0 24 24' fill='none' className={className} aria-hidden='true'>
    <path d='M12 21s7-5.8 7-11a7 7 0 1 0-14 0c0 5.2 7 11 7 11Z' stroke='currentColor' strokeWidth='1.7' strokeLinejoin='round' />
    <circle cx='12' cy='10' r='2.7' stroke='currentColor' strokeWidth='1.7' />
  </svg>
);

const MailIcon = ({ className = '' }) => (
  <svg viewBox='0 0 24 24' fill='none' className={className} aria-hidden='true'>
    <rect x='3' y='5' width='18' height='14' rx='2' stroke='currentColor' strokeWidth='1.7' />
    <path d='m4 7 8 6 8-6' stroke='currentColor' strokeWidth='1.7' strokeLinejoin='round' />
  </svg>
);

const PhoneIcon = ({ className = '' }) => (
  <svg viewBox='0 0 24 24' fill='none' className={className} aria-hidden='true'>
    <path d='M6.5 4h3l1.2 4-1.8 1.8a13.3 13.3 0 0 0 5.3 5.3L16 13.3l4 1.2v3c0 1-1 1.8-2 1.7a17 17 0 0 1-13.7-13.7C4.2 5 5 4 6.5 4Z' stroke='currentColor' strokeWidth='1.7' strokeLinejoin='round' />
  </svg>
);

const WhatsAppIcon = ({ className = '' }) => (
  <svg viewBox='0 0 24 24' fill='none' className={className} aria-hidden='true'>
    <path d='M12 21a9 9 0 1 0-7.8-4.5L3 21l4.7-1.2A9 9 0 0 0 12 21Z' stroke='currentColor' strokeWidth='1.7' strokeLinejoin='round' />
    <path d='M9 9.2c0-.4.3-.7.7-.7h.8c.3 0 .5.2.6.4l.7 1.8c.1.3 0 .6-.2.8l-.6.7a7.2 7.2 0 0 0 2.2 2.2l.7-.6c.2-.2.6-.2.8-.2l1.8.7c.3.1.4.3.4.6v.8c0 .4-.3.7-.7.7h-.4a7 7 0 0 1-7-7v-.4Z' stroke='currentColor' strokeWidth='1.5' strokeLinejoin='round' />
  </svg>
);

const Contact = () => {
  const [formValues, setFormValues] = useState({ name: '', email: '', message: '' });

  const onSubmitHandler = (event) => {
    event.preventDefault();
    setFormValues({ name: '', email: '', message: '' });
  };

  return (
    <section className='pt-6 sm:pt-8'>

        <header className='text-center'>
          <p className='text-[11px] uppercase tracking-[0.24em] text-[#777]'>Contact</p>
          <h1 className='mt-2 text-[2rem] sm:text-[2.45rem] font-semibold tracking-[-0.015em] text-[#111] leading-[0.95]'>
            Get in touch
          </h1>
        </header>

        <div className='my-8 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]'>
          <div className='space-y-6'>
            <img className='w-full rounded-2xl object-cover h-[280px] sm:h-[420px]' src={assets.about_img} alt='Lavish Fashion studio and styling essentials' />

            <div className='rounded-2xl bg-[#f5f5f5] p-6 space-y-4'>
              <h2 className='text-[11px] uppercase tracking-[0.22em] text-[#777]'>Contact Information</h2>

              <div className='flex gap-3 text-[#666]'>
                <LocationIcon className='h-5 w-5 shrink-0 mt-0.5 text-[#111]' />
                <div>
                  <p className='text-[11px] uppercase tracking-[0.2em] text-[#777]'>Address</p>
                  <p className='mt-1 text-sm leading-6'>74923 Nio Tower, Zak 449, Bengaluru, India</p>
                </div>
              </div>

              <div className='flex gap-3 text-[#666]'>
                <MailIcon className='h-5 w-5 shrink-0 mt-0.5 text-[#111]' />
                <div>
                  <p className='text-[11px] uppercase tracking-[0.2em] text-[#777]'>Email</p>
                  <p className='mt-1 text-sm'>contact@lavishfashion.com</p>
                </div>
              </div>

              <div className='flex gap-3 text-[#666]'>
                <PhoneIcon className='h-5 w-5 shrink-0 mt-0.5 text-[#111]' />
                <div>
                  <p className='text-[11px] uppercase tracking-[0.2em] text-[#777]'>Phone</p>
                  <p className='mt-1 text-sm'>+91 7888777788</p>
                </div>
              </div>

              <div className='flex gap-3 text-[#666]'>
                <WhatsAppIcon className='h-5 w-5 shrink-0 mt-0.5 text-[#111]' />
                <div>
                  <p className='text-[11px] uppercase tracking-[0.2em] text-[#777]'>WhatsApp</p>
                  <p className='mt-1 text-sm'>+91 7888777788</p>
                </div>
              </div>
            </div>
          </div>

          <div className='space-y-6'>
            <form onSubmit={onSubmitHandler} className='rounded-2xl bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.06)] space-y-4'>
              <p className='text-[11px] uppercase tracking-[0.22em] text-[#777]'>Send us a message</p>

              <input
                type='text'
                placeholder='Your name'
                value={formValues.name}
                onChange={(event) => setFormValues((current) => ({ ...current, name: event.target.value }))}
                className='w-full rounded-xl bg-[#f5f5f5] px-4 py-3 text-sm text-[#111] outline-none'
                required
              />

              <input
                type='email'
                placeholder='Your email'
                value={formValues.email}
                onChange={(event) => setFormValues((current) => ({ ...current, email: event.target.value }))}
                className='w-full rounded-xl bg-[#f5f5f5] px-4 py-3 text-sm text-[#111] outline-none'
                required
              />

              <textarea
                placeholder='How can we help you?'
                value={formValues.message}
                onChange={(event) => setFormValues((current) => ({ ...current, message: event.target.value }))}
                className='min-h-32 w-full rounded-xl bg-[#f5f5f5] px-4 py-3 text-sm text-[#111] outline-none resize-none'
                required
              />

              <button
                type='submit'
                className='rounded-full bg-black px-7 py-3 text-[11px] font-medium uppercase tracking-[0.18em] text-white'
              >
                Send Message
              </button>
            </form>

            <div className='rounded-2xl bg-[#f5f5f5] p-6'>
              <p className='text-[11px] uppercase tracking-[0.22em] text-[#777]'>Need help?</p>
              <div className='mt-3 flex flex-wrap gap-2.5'>
                <Link to='/orders' className='rounded-full bg-white px-4 py-2 text-sm text-[#555] hover:text-[#111] transition-colors'>Track Order</Link>
                <Link to='/collection' className='rounded-full bg-white px-4 py-2 text-sm text-[#555] hover:text-[#111] transition-colors'>Shop Collections</Link>
                <Link to='/rewards' className='rounded-full bg-white px-4 py-2 text-sm text-[#555] hover:text-[#111] transition-colors'>Rewards Help</Link>
                <Link to='/profile' className='rounded-full bg-white px-4 py-2 text-sm text-[#555] hover:text-[#111] transition-colors'>Account Support</Link>
              </div>
            </div>
          </div>
        </div>

    </section>
  )
}

export default Contact