import React, { useContext, useEffect, useState } from 'react';
import { ShopContext } from '../context/ShopContext';
import ProductItem from './ProductItem';
import ProductShimmer from './ProductShimmer';

const categoryDescriptions = {
  Men: 'Explore sharp everyday essentials, clean casualwear, and reliable layering pieces for the modern men wardrobe.',
  Women:
    'Discover versatile women styles that balance comfort, polish, and seasonal freshness across every collection drop.',
  Kids: 'Shop playful, easy-to-wear kids styles designed for comfort, movement, and simple day-to-day dressing.',
};

const categoryLabels = {
  Men: "Men's Edit",
  Women: "Women's Edit",
  Kids: "Kids' Edit",
};

const CategoriesProduct = ({ catname, cat }) => {
  const { products, loadingProductsData } = useContext(ShopContext);
  const [categoryProducts, setCategoryProducts] = useState([]);

  useEffect(() => {
    setCategoryProducts(products.filter((product) => product.category === cat));
  }, [cat, products]);

  return (
    <section className='mt-10 mb-14 sm:my-16 bg-white'>
      <div className='text-center py-5 sm:py-6 px-3'>
        <p className='text-[11px] sm:text-xs font-light tracking-[0.28em] uppercase text-[#777]'>
          {categoryLabels[cat] || 'Curated Edit'}
        </p>

        <h2 className='mt-2 text-[2rem] sm:text-[2.45rem] font-semibold tracking-[-0.015em] text-[#111] leading-[0.95]'>
          {catname} Collection
        </h2>

        <p className='mt-3 w-[92%] sm:w-3/4 m-auto text-sm md:text-base font-light text-[#777]'>
          {categoryDescriptions[cat]}
        </p>

        <span className='block w-10 h-px bg-[#111]/65 mx-auto mt-4'></span>
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
    </section>
  );
};

export default CategoriesProduct;
