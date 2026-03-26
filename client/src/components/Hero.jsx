import React, { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { assets } from '../assets/assets'
import { ShopContext } from '../context/ShopContext'

const AUTO_SLIDE_MS = 4600
const SWIPE_THRESHOLD = 45
const PARALLAX_INTENSITY = 0.8

const Hero = () => {
    const { products, currency } = useContext(ShopContext)
    const featuredProducts = useMemo(
        () => products.filter((item) => Array.isArray(item?.image) && item.image[0]).slice(0, 5),
        [products]
    )
    const [activeIndex, setActiveIndex] = useState(0)
    const [isPaused, setIsPaused] = useState(false)
    const [scrollOffset, setScrollOffset] = useState(0)
    const touchStartXRef = useRef(null)
    const touchDeltaXRef = useRef(0)

    useEffect(() => {
        if (activeIndex >= featuredProducts.length) {
            setActiveIndex(0)
        }
    }, [activeIndex, featuredProducts.length])

    useEffect(() => {
        if (featuredProducts.length < 2 || isPaused) {
            return undefined
        }

        const interval = setInterval(() => {
            setActiveIndex((prev) => (prev + 1) % featuredProducts.length)
        }, AUTO_SLIDE_MS)

        return () => clearInterval(interval)
    }, [featuredProducts.length, isPaused])

    useEffect(() => {
        if (typeof window === 'undefined') {
            return undefined
        }

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

        if (prefersReducedMotion) {
            setScrollOffset(0)
            return undefined
        }

        let ticking = false

        const onScroll = () => {
            if (ticking) {
                return
            }

            ticking = true
            window.requestAnimationFrame(() => {
                setScrollOffset(window.scrollY || 0)
                ticking = false
            })
        }

        onScroll()
        window.addEventListener('scroll', onScroll, { passive: true })

        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    const activeProduct = featuredProducts[activeIndex]
    const activeImage = activeProduct?.image?.[0] || assets.hero_img
    const arcParallax = Math.min(scrollOffset * 0.05 * PARALLAX_INTENSITY, 18)
    const primaryBlobParallax = Math.min(scrollOffset * 0.08 * PARALLAX_INTENSITY, 26)
    const secondaryBlobParallax = Math.min(scrollOffset * 0.12 * PARALLAX_INTENSITY, 42)

    const onSlideChange = (nextIndex) => {
        if (!featuredProducts.length) {
            return
        }

        setActiveIndex((nextIndex + featuredProducts.length) % featuredProducts.length)
    }

    const handleTouchStart = (event) => {
        touchStartXRef.current = event.touches?.[0]?.clientX ?? null
        touchDeltaXRef.current = 0
        setIsPaused(true)
    }

    const handleTouchMove = (event) => {
        if (touchStartXRef.current === null) {
            return
        }

        const currentX = event.touches?.[0]?.clientX ?? touchStartXRef.current
        touchDeltaXRef.current = currentX - touchStartXRef.current
    }

    const handleTouchEnd = () => {
        if (Math.abs(touchDeltaXRef.current) >= SWIPE_THRESHOLD) {
            if (touchDeltaXRef.current > 0) {
                onSlideChange(activeIndex - 1)
            } else {
                onSlideChange(activeIndex + 1)
            }
        }

        touchStartXRef.current = null
        touchDeltaXRef.current = 0
        setIsPaused(false)
    }

    return (
        <section className='hero-shell relative overflow-hidden flex flex-col lg:flex-row min-h-[460px]'>
            <div className='pointer-events-none absolute inset-0'>
                <span
                    className='absolute -left-28 -top-24 h-64 w-64 rounded-full border border-[#414141]/8 will-change-transform'
                    style={{ transform: `translate3d(0, ${arcParallax}px, 0)` }}
                ></span>
                <span
                    className='absolute right-[10%] top-[4%] h-[420px] w-[420px] rounded-full bg-[#efcdcf]/40 blur-3xl will-change-transform'
                    style={{ transform: `translate3d(0, ${primaryBlobParallax}px, 0)` }}
                ></span>
                <span
                    className='absolute right-[-8%] bottom-[-20%] h-[280px] w-[280px] rounded-full bg-[#efcdcf]/35 blur-2xl will-change-transform'
                    style={{ transform: `translate3d(0, ${secondaryBlobParallax}px, 0)` }}
                ></span>
            </div>

            {/* Left Section */}
            <div className='relative w-full lg:w-[48%] px-7 sm:px-12 lg:px-16 xl:px-20 py-12 sm:py-14 lg:py-0 flex items-center min-h-[440px]'>

                <div className='hero-copy relative z-10 text-[#414141] max-w-md'>
                    <div className='hero-line flex items-center gap-3'>
                        <p className='w-10 md:w-14 h-[2px] bg-[#414141]'></p>
                        <p className='hero-kicker hero-track text-[11px] sm:text-xs font-medium tracking-[0.28em]'>NEW SEASON 2026</p>
                    </div>

                    <h1 className='hero-title prata-regular text-[2.15rem] sm:text-5xl lg:text-[3.55rem] leading-[1.08] mt-5'>
                        Dress for <span className='italic'>Every</span>
                        <br />
                        Occasion
                    </h1>

                    <p className='hero-subtitle text-sm sm:text-base text-[#414141]/75 mt-5 leading-7'>
                        Curated styles from everyday essentials to standout pieces, all under one roof.
                    </p>

                    <div className='hero-actions mt-8 flex flex-wrap items-center gap-4 sm:gap-6'>
                        <div className='pr-4 sm:pr-6 border-r border-[#414141]/25'>
                            <p className='prata-regular text-2xl leading-none'>500+</p>
                            <p className='text-[10px] tracking-[0.2em] uppercase mt-1.5 text-[#414141]/80'>New Arrivals</p>
                        </div>

                        <Link
                            to='/collection'
                            className='hero-lookbook hero-track group text-left text-xs sm:text-sm font-semibold tracking-[0.18em] uppercase text-[#414141]'
                        >
                            View Lookbook
                            <span className='ml-2 inline-block transition-transform duration-300 group-hover:translate-x-1'>-&gt;</span>
                        </Link>
                    </div>
                </div>
            </div>

            {/* Right Section */}
            <div
                className='relative w-full lg:w-[52%] min-h-[360px] sm:min-h-[420px] lg:min-h-[440px] overflow-hidden'
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onMouseEnter={() => setIsPaused(true)}
                onMouseLeave={() => setIsPaused(false)}
                onFocusCapture={() => setIsPaused(true)}
                onBlurCapture={() => setIsPaused(false)}
            >
                <div className='absolute inset-0 bg-gradient-to-r from-white/5 via-transparent to-transparent z-10'></div>
                <div className='absolute inset-0 bg-gradient-to-t from-[#efcdcf]/45 via-[#efcdcf]/18 to-transparent z-10'></div>

                <img
                    key={activeProduct?._id || 'hero-fallback'}
                    className='hero-image w-full h-full object-cover object-top opacity-[0.97]'
                    src={activeImage}
                    alt={activeProduct?.name || 'Model wearing latest arrivals'}
                />

                {activeProduct && (
                    <div className='absolute left-4 right-4 sm:left-7 sm:right-7 bottom-5 sm:bottom-7 z-20'>
                        <p className='text-[10px] sm:text-[11px] tracking-[0.22em] uppercase text-[#414141]/75'>Featured Product</p>
                        <div className='mt-2 flex items-end justify-between gap-4'>
                            <div className='min-w-0'>
                                <h3 className='text-base sm:text-[1.45rem] font-medium text-[#2f2f2f] leading-tight line-clamp-1'>
                                    {activeProduct.name}
                                </h3>
                                <p className='prata-regular text-xl sm:text-[2rem] text-[#2f2f2f] mt-1'>
                                    {currency}
                                    {activeProduct.price}
                                </p>
                            </div>
                            <Link
                                to={`/product/${activeProduct._id}`}
                                className='shrink-0 text-[11px] sm:text-xs font-semibold tracking-[0.16em] uppercase text-[#414141] hover:opacity-80'
                            >
                                Shop Now -&gt;
                            </Link>
                        </div>
                    </div>
                )}

                {featuredProducts.length > 1 && (
                    <>
                        <button
                            type='button'
                            className='hidden sm:flex items-center justify-center absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 z-20 h-10 w-10 rounded-full bg-white/35 text-[#414141] backdrop-blur-sm hover:bg-white/55 transition'
                            onClick={() => onSlideChange(activeIndex - 1)}
                            aria-label='Previous featured product'
                        >
                            {'<'}
                        </button>
                        <button
                            type='button'
                            className='hidden sm:flex items-center justify-center absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 z-20 h-10 w-10 rounded-full bg-white/35 text-[#414141] backdrop-blur-sm hover:bg-white/55 transition'
                            onClick={() => onSlideChange(activeIndex + 1)}
                            aria-label='Next featured product'
                        >
                            {'>'}
                        </button>

                        <div className='absolute z-20 left-1/2 -translate-x-1/2 bottom-[34%] sm:bottom-[31%] flex items-center gap-2 rounded-full bg-white/45 backdrop-blur-sm px-3 py-1.5'>
                            {featuredProducts.map((item, index) => (
                                <button
                                    key={item._id}
                                    type='button'
                                    onClick={() => onSlideChange(index)}
                                    className={`h-2.5 rounded-full transition-all ${
                                        index === activeIndex ? 'w-7 bg-[#414141]' : 'w-2.5 bg-white/80'
                                    }`}
                                    aria-label={`View ${item.name}`}
                                ></button>
                            ))}
                        </div>

                        <p className='absolute sm:hidden z-20 left-1/2 -translate-x-1/2 bottom-[26%] text-[10px] tracking-[0.18em] uppercase text-[#414141]/75'>
                            Swipe To Explore
                        </p>
                    </>
                )}
            </div>
        </section>
    )
}

export default Hero