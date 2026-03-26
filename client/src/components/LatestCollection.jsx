import React, { useContext, useEffect, useState } from 'react';
import { ShopContext } from '../context/ShopContext';
import Title from './Title';
import ProductItem from './ProductItem';
import ProductShimmer from './ProductShimmer';

const LatestCollection = () => {
  const { products, loadingProductsData } = useContext(ShopContext);
  const [latestProducts, setLatestProducts] = useState([]);

  useEffect(() => {
    setLatestProducts(products.slice(0, 10));
  }, [products]);

  return (
    <div className='mt-8 mb-16 sm:my-20'>
      <div className='text-center py-4 sm:py-8 text-3xl'>
        <Title text1='LATEST' text2='COLLECTIONS' />
        <p className='w-3/4 m-auto text-xs sm:text-sm md:text-base text-gray-600'>
          Explore the newest additions to Lavish Fashion, from everyday essentials to standout seasonal
          layers selected for quick, confident shopping.
        </p>
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
    </div>
  );
};

export default LatestCollection;
