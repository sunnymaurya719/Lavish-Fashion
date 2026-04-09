import React, { lazy, Suspense } from 'react'
import Hero from '../components/Hero'
import LatestCollection from '../components/LatestCollection'

const CategoriesProduct = lazy(() => import('../components/CategoriesProduct'))
const NewsletterBox = lazy(() => import('../components/NewsletterBox'))
const OurSocialMedia = lazy(() => import('../components/OurSocialMedia'))

const Home = () => {
  return (
    <div>
      <Hero />
      <LatestCollection />
      <Suspense fallback={null}>
        <CategoriesProduct catname={'Mens'} cat={'Men'}/>
        <CategoriesProduct catname={'Womens'} cat={'Women'} />
        <CategoriesProduct catname={'Kids'} cat={'Kids'} />
        <NewsletterBox />
        <OurSocialMedia />
      </Suspense>
    </div>
  )
}

export default Home