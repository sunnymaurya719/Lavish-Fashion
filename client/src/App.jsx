import React, { lazy, Suspense, memo } from 'react'
import {Routes, Route, useLocation} from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import SearchBar from './components/SearchBar'
import ScrollToTop from './components/ScrollToTop'
import MobileToastContainer from './components/MobileToastContainer'

const Home = lazy(() => import('./pages/Home'))
const Collection = lazy(() => import('./pages/Collection'))
const Product = lazy(() => import('./pages/Product'))
const Cart = lazy(() => import('./pages/Cart'))
const Login = lazy(() => import('./pages/Login'))
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
  const shellClassName = isAuthRoute
    ? 'min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(235,214,195,0.45),transparent_28%),radial-gradient(circle_at_top_right,rgba(15,23,42,0.07),transparent_24%),linear-gradient(180deg,#fffdf8_0%,#fffaf4_100%)] px-4 sm:px-6 lg:px-8'
    : 'px-4 sm:px-[5vw] md:px-[7vw] lg:px-[9vw]'

  return (
    <div className={shellClassName}>
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
