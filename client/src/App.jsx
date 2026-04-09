import React, { lazy, Suspense } from 'react'
import {Routes, Route, useLocation} from 'react-router-dom'
import Home from './pages/Home'
import Collection from './pages/Collection'
import Product from './pages/Product'
import Cart from './pages/Cart'
import Login from './pages/Login'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import SearchBar from './components/SearchBar'
import ScrollToTop from './components/ScrollToTop'
import MobileToastContainer from './components/MobileToastContainer'

const About = lazy(() => import('./pages/About'))
const Contact = lazy(() => import('./pages/Contact'))
const Profile = lazy(() => import('./pages/Profile'))
const Rewards = lazy(() => import('./pages/Rewards'))
const PlaceOrder = lazy(() => import('./pages/PlaceOrder'))
const Orders = lazy(() => import('./pages/Orders'))
const Wishlist = lazy(() => import('./pages/Wishlist'))
const Verify = lazy(() => import('./pages/Verify'))

const RouteFallback = () => (
  <div className='min-h-[60vh] flex items-center justify-center'>
    <div className='h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-900'></div>
  </div>
)

const App = () => {
  const location = useLocation()
  const isAuthRoute = location.pathname === '/login'

  return (
    <div className='px-4 sm:px-[5vw] md:px-[7vw] lg:px-[9vw]'>
      <ScrollToTop />
      <MobileToastContainer />
      <Navbar />
      {isAuthRoute ? null : <SearchBar />}
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path='/' element={<Home />} />
          <Route path='/about' element={<About/>} />
          <Route path='/collection' element={<Collection/>} />
          <Route path='/contact' element={<Contact />} />
          <Route path='/product/:productId' element={<Product />} />
          <Route path='/cart' element={<Cart/>} />
          <Route path='/wishlist' element={<Wishlist/>} />
          <Route path='/login' element={<Login/>} />
          <Route path='/profile' element={<Profile/>} />
          <Route path='/rewards' element={<Rewards/>} />
          <Route path='/place-order' element={<PlaceOrder/>} />
          <Route path='/orders' element={<Orders/>} />
          <Route path='/verify' element={<Verify/>} />
        </Routes>
      </Suspense>
      {isAuthRoute ? null : <Footer />}
    </div>
  )
}

export default App
