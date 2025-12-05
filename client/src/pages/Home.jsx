import React from 'react'
import Hero from '../components/Hero'
import LatestCollection from '../components/LatestCollection'
import CategoriesProduct from '../components/CategoriesProduct'
import OurSocialMedia from '../components/OurSocialMedia'
import NewsletterBox from '../components/NewsletterBox'

const Home = () => {
  return (
    <div>
      <Hero />
      <LatestCollection />
      <CategoriesProduct catname={'Mens'} cat={'Men'}/>
      <CategoriesProduct catname={'Womens'} cat={'Women'} />
      <CategoriesProduct catname={'Kids'} cat={'Kids'} />
      <NewsletterBox />
      <OurSocialMedia />
    </div>
  )
}

export default Home