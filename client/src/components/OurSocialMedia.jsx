import React from 'react'
import { assets } from '../assets/assets'

const OurSocialMedia = () => {
  return (
    <section className='mt-8 border-t border-slate-200/80 px-6 py-8'>
      <div className='flex items-center justify-center gap-5 sm:gap-6'>
        <a href='#' aria-label='Facebook' className='rounded-full bg-[#f5f5f5] p-3 transition hover:bg-[#ececec] active:bg-[#e4e4e4]'>
          <img src={assets.facebook} alt='Facebook' className='h-5 w-5' />
        </a>
        <a href='#' aria-label='Instagram' className='rounded-full bg-[#f5f5f5] p-3 transition hover:bg-[#ececec] active:bg-[#e4e4e4]'>
          <img src={assets.instagram} alt='Instagram' className='h-5 w-5' />
        </a>
        <a href='#' aria-label='YouTube' className='rounded-full bg-[#f5f5f5] p-3 transition hover:bg-[#ececec] active:bg-[#e4e4e4]'>
          <img src={assets.youtube} alt='YouTube' className='h-5 w-5' />
        </a>
      </div>
    </section>
  )
}

export default OurSocialMedia