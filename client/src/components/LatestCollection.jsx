import React, { useContext, useEffect, useState } from 'react';
import { ShopContext } from '../context/ShopContext';
import ProductItem from './ProductItem';
import ProductShimmer from './ProductShimmer';

const LatestCollection = () => {
  const { products, loadingProductsData } = useContext(ShopContext);
  const [latestProducts, setLatestProducts] = useState([]);

  useEffect(() => {
    setLatestProducts(products.slice(0, 10));
  }, [products]);

  return (
    <section className='mt-2 mb-14 sm:my-16 bg-white'>
      <div className='text-center py-5 sm:py-6 px-3'>
        <p className='text-[11px] sm:text-xs font-light tracking-[0.28em] uppercase text-[#777]'>
          New Arrivals
        </p>

        <h2 className='mt-2 text-[2rem] sm:text-[2.45rem] font-semibold tracking-[-0.015em] text-[#111] leading-[0.95]'>
          Latest Collections
        </h2>

        <p className='mt-3 text-sm sm:text-[15px] font-light text-[#777] max-w-[30rem] mx-auto'>
          Discover fresh styles curated for you.
        </p>

        <span className='block w-10 h-px bg-[#111]/65 mx-auto mt-4'></span>
      </div>

      <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 gap-y-6'>
        {loadingProductsData
          ? Array.from({ length: 10 }).map((_, index) => <ProductShimmer key={index} />)
          : latestProducts.map((item) => (
              <ProductItem
                key={item._id}
                id={item._id}
                image={item.image}
                name={item.name}
                price={item.price}
                averageRating={item.averageRating}
                reviewCount={item.reviewCount}
              />
            ))}
      </div>
    </section>
  );
};

export default LatestCollection;
