import React, { useContext, useMemo } from 'react'
import { ShopContext } from '../context/ShopContext';
import ProductItem from './ProductItem';

const RelatedProducts = ({category,subCategory}) => {
    const {products} = useContext(ShopContext);
    const related = useMemo(() => {
        if (products.length === 0) return [];
        return products
            .filter((item) => category === item.category && subCategory === item.subCategory)
            .slice(0, 5);
    }, [products, category, subCategory]);

  return (
    <section className='my-20 sm:my-24'>

        <div className='text-center py-2'>
            <p className='text-[11px] uppercase tracking-[0.24em] text-[#777]'>Curated Picks</p>
            <h2 className='mt-2 text-[2rem] sm:text-[2.45rem] font-semibold tracking-[-0.015em] leading-[0.95] text-[#111]'>
              Related Products
            </h2>
        </div>

        <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 gap-y-6'>
            {
                related.map((item) => (
                    <ProductItem
                      key={item._id}
                      id={item._id}
                      name={item.name}
                      price={item.price}
                      image={item.image}
                      averageRating={item.averageRating}
                      reviewCount={item.reviewCount}
                    />
                ))
            }
            
        </div>

        </section>
  )
}

export default RelatedProducts
