import React from 'react'
import { assets } from '../assets/assets'

const Footer = () => {
  return (
    <div>
        <div className='flex flex-col sm:grid grid-cols-[3fr_1fr_1fr] gap-14 my-10 mt-5 text-sm'>
            <div>
                <img src={assets.Lavishlogo} alt='' className='mb-5 w-32' />
                <p className='w-full md:w-2/3 text-gray-600'>
                    Lorem ipsum dolor, sit amet consectetur adipisicing elit. Ratione sit rem soluta, veritatis officiis quasi aliquid eveniet. Alias consequatur impedit labore exercitationem, inventore sapiente, quis explicabo odit nostrum id enim.
                </p>
            </div>
            <div>
                <p className='text-xl font-medium mb-5'>COMPANY</p>
                <ul className='flex flex-col gap-1 text-gray-600'>
                    <li>Home</li>
                    <li>About us</li>
                    <li>Delivery</li>
                    <li>Privacy policy</li>
                </ul>
            </div>

            <div>
                <p className='text-xl font-medium mb-5'>GET IN TOUCH</p>
                <ul className='flex flex-col gap-1 text-gray-600'>
                    <li>+1 123 456 7890</li>
                    <li>contact777@Lavishfashion.com</li>
                </ul>
            </div>
        </div>

        <div>
            <hr />
            <p className='py-5 text-sm text-center'>Copyright 2025@LavishFashion.com - All Rights Reserved</p>
        </div>
    </div>
  )
}

export default Footer