import React from 'react'
import { assets } from '../assets/assets'

const OurSocialMedia = () => {
  return (
    <div className='flex flex-col items-center justify-center py-20 text-xs sm:text-sm md:text-base'>

      <div className='flex flex-col items-center justify-center gap-1'>

        <div className='flex flex-row items-center gap-12'>
          <img src={assets.facebook} alt='Facebook' className='w-5 h-5 m-auto mb-5' />
          <img src={assets.youtube} alt='Youtube' className='w-5 m-auto mb-5' />
          <img src={assets.instagram} alt='Instgram' className='w-5 h-5 m-auto mb-5' />
        </div>

        <p className='font-semibold'>Connect With Us</p>
        <p className='text-gray-400'>For Latest Fashions.</p>
      </div>

    </div>
  )
}

export default OurSocialMedia