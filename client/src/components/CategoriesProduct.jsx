import React, { useContext, useEffect, useState } from 'react';
import { ShopContext } from '../context/ShopContext';
import Title from './Title';
import ProductItem from './ProductItem';
import ProductShimmer from './ProductShimmer';

const categoryDescriptions = {
  Men: 'Explore sharp everyday essentials, clean casualwear, and reliable layering pieces for the modern men wardrobe.',
  Women:
    'Discover versatile women styles that balance comfort, polish, and seasonal freshness across every collection drop.',
  Kids: 'Shop playful, easy-to-wear kids styles designed for comfort, movement, and simple day-to-day dressing.',
};

const CategoriesProduct = ({ catname, cat }) => {
  const { products, loadingProductsData } = useContext(ShopContext);
  const [categoryProducts, setCategoryProducts] = useState([]);

  useEffect(() => {
    setCategoryProducts(products.filter((product) => product.category === cat));
  }, [cat, products]);

  return (
    <div className='my-10'>
      <div className='text-center text-3xl py-8'>
        <Title text1={catname} text2='' />
        <p className='w-3/4 m-auto text-xs sm:text-sm md:text-base text-gray-600'>
          {categoryDescriptions[cat]}
        </p>
      </div>
      <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 gap-y-6'>
        {loadingProductsData
          ? Array.from({ length: 10 }).map((_, index) => <ProductShimmer key={index} />)
          : categoryProducts.map((item) => (
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

export default CategoriesProduct;
