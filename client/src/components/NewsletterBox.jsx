import React from 'react';

const NewsletterBox = () => {
  const onSubmitHandler = (event) => {
    event.preventDefault();
  };

  return (
    <section className='mt-14 rounded-[28px] bg-[#f5f5f5] px-6 py-7 text-center sm:mt-16 sm:px-10 sm:py-10'>
      <h2 className='text-[1.4rem] sm:text-[1.55rem] font-semibold text-[#111] leading-tight'>
        Stay close to every new drop
      </h2>

      <p className='mt-3 text-sm text-[#777]'>
        Join the Lavish Fashion mailing list for launch updates, style highlights, and seasonal edits.
      </p>

      <form onSubmit={onSubmitHandler} className='mt-6 mx-auto w-full max-w-[640px]'>
        <div className='flex items-center overflow-hidden rounded-full bg-white p-1 shadow-[0_6px_18px_rgba(15,23,42,0.06)]'>
          <input
            type='email'
            placeholder='Enter your email'
            className='min-w-0 flex-1 bg-transparent px-4 py-3 text-sm text-[#111] placeholder:text-[#8f8f8f] outline-none'
            required
          />
          <button
            type='submit'
            className='shrink-0 rounded-full bg-black px-4 py-3 text-[10px] font-medium uppercase tracking-[0.1em] text-white sm:px-7 sm:text-[11px] sm:tracking-[0.18em]'
          >
            Subscribe
          </button>
        </div>
      </form>
    </section>
  );
};

export default NewsletterBox;
