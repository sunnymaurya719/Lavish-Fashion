import React, { useEffect } from 'react'
import { useContext, useState } from 'react'
import { ShopContext } from '../context/ShopContext'
import Title from './Title';
import ProductItem from './ProductItem';
import ProductShimmer from './ProductShimmer';


const CategoriesProduct = ({ catname, cat }) => {
    const { products, loadingProductsData } = useContext(ShopContext);
    const [men, setMen] = useState([]);

    useEffect(() => {
        const menProducts = products.filter(product => product.category === cat);
        setMen(menProducts);
    }, [cat, products]);

    return (
        <div className='my-10'>
            <div className='text-center text-3xl py-8'>
                <Title text1={catname} text2={''} />
                <p className='w-3/4 m-auto text-xs sm:text-sm md:text-base text-gray-600'>
                    Lorem ipsum dolor sit amet consectetur adipisicing elit. Maxime provident modi voluptas molestiae ipsa dignissimos, atque corrupti praesentium autem at repellat placeat quos, nulla tempore natus? Explicabo quibusdam in distinctio.
                </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 gap-y-6">
                {loadingProductsData
                    ? Array.from({ length: 10 }).map((_, i) => (
                        <ProductShimmer key={i} />
                    ))
                    : men.map((item) => (
                        <ProductItem
                            key={item._id}
                            id={item._id}
                            image={item.image}
                            name={item.name}
                            price={item.price}
                        />
                    ))}
            </div>
        </div>
    )
}

export default CategoriesProduct