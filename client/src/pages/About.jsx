import React from 'react'
import Title from '../components/Title'
import {assets} from '../assets/assets'

const About = () => {
  return (
    <div>

    
        <div className='text-2xl text-center pt-8 border-t'>
          <Title text1={'ABOUT'} text2={'US'}/>
        </div>

        <div className='my-10 flex flex-col md:flex-row gap-16'>
          <img className='w-full md:max-w-[450px]' src={assets.about_img} />
          <div className='flex flex-col justify-center gap-6 md:w-2/4 text-gray-600'>
            <p>Lorem ipsum dolor sit amet consectetur adipisicing elit. Sed magni labore, nihil distinctio impedit ea quia quidem eveniet quae cum vel. Delectus commodi, illum consequuntur architecto natus necessitatibus cupiditate explicabo!</p>
            <p>Lorem ipsum dolor sit amet consectetur adipisicing elit. Esse tempora modi ad officia ex eos architecto dolores illo at id a explicabo doloremque, harum praesentium minus laboriosam, sapiente cumque quo.</p>
            <b className='text-gray-800'>Our Mission</b>
            <p>Our mission Lorem ipsum dolor sit amet, consectetur adipisicing elit. Possimus unde esse neque voluptates veritatis iste quos eaque voluptatibus quisquam at. Veritatis non magni ad distinctio numquam voluptates, itaque id accusantium.</p>
          </div>
        </div>

        <div className='text-xl py-4'>
          <Title text1={'WHY'} text2={'CHOOSE US'}/>
        </div>

        <div className='flex flex-col md:flex-row text-sm mb-20'>
          <div className='border px-10 md:px-16 py-8 sm:py-20 flex flex-col gap-5'>
            <b>Quality Assurance:</b>
            <p className='text-gray-600'>Lorem ipsum dolor sit amet consectetur adipisicing elit. Modi aperiam libero quod, sunt obcaecati quisquam.</p>
          </div>
          <div className='border px-10 md:px-16 py-8 sm:py-20 flex flex-col gap-5'>
            <b>Convenience:</b>
            <p className='text-gray-600'>Lorem ipsum dolor sit amet consectetur adipisicing elit. Modi aperiam libero quod, sunt obcaecati quisquam.</p>
          </div>
          <div className='border px-10 md:px-16 py-8 sm:py-20 flex flex-col gap-5'>
            <b>Exceptional Customer Service:</b>
            <p className='text-gray-600'>Lorem ipsum dolor sit amet consectetur adipisicing elit. Modi aperiam libero quod, sunt obcaecati quisquam.</p>
          </div>
        </div>

    </div>
  )
}

export default About