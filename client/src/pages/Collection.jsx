import React, { useCallback, useContext, useEffect, useState } from 'react'
import { ShopContext } from '../context/ShopContext'
import { assets } from '../assets/assets';
import ProductItem from '../components/ProductItem';
import ProductShimmer from '../components/ProductShimmer';

const CATEGORY_OPTIONS = ['Men', 'Women', 'Kids'];
const TYPE_OPTIONS = ['Topwear', 'Bottomwear', 'Winterwear'];

const Collection = () => {

  const { products, search, showSearch, loadingProductsData } = useContext(ShopContext);
  const [showFilter, setShowFilter] = useState(false);
  const [openSections, setOpenSections] = useState({ categories: true, type: true });
  const [filterProducts, setFilterProducts] = useState([]);
  const [category, setCategory] = useState([]);
  const [subCategory, setSubCategory] = useState([]);

  const toggleCategory = (value) => {
    if (category.includes(value)) {
      setCategory((prev) => prev.filter((item) => item !== value));
    }
    else {
      setCategory((prev) => [...prev, value]);
    }
  };

  const toggleSubCategory = (value) => {
    if (subCategory.includes(value)) {
      setSubCategory((prev) => prev.filter((item) => item !== value));
    }
    else {
      setSubCategory((prev) => [...prev, value]);
    }
  };

  const toggleSection = (sectionKey) => {
    setOpenSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  };

  const applyFilter = useCallback(() => {
    let productsCopy = products.slice();

    if (showSearch && search) {
      productsCopy = productsCopy.filter(item => item.name.toLowerCase().includes(search.toLowerCase()));
    }

    if (category.length > 0) {
      productsCopy = productsCopy.filter(item => category.includes(item.category));
    }
    if (subCategory.length > 0) {
      productsCopy = productsCopy.filter(item => subCategory.includes(item.subCategory));
    }
    setFilterProducts(productsCopy);
  }, [products, showSearch, search, category, subCategory]);

  useEffect(() => {
    setFilterProducts(products);
  }, [products]);

  useEffect(() => {
    applyFilter();
  }, [applyFilter]);

  const renderFilterChips = (options, selectedItems, onToggle) => (
    <div className='flex flex-wrap gap-2.5 pt-3'>
      {options.map((option) => {
        const isSelected = selectedItems.includes(option);

        return (
          <button
            key={option}
            type='button'
            onClick={() => onToggle(option)}
            className={`rounded-full px-4 py-2 text-sm transition-colors ${
              isSelected
                ? 'bg-[#111] text-white'
                : 'bg-[#f5f5f5] text-[#4a4a4a] hover:bg-[#ececec] active:bg-[#e3e3e3]'
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );

  return (
    <section className='flex flex-col sm:flex-row gap-8 sm:gap-10 pt-6 sm:pt-10'>

      {/* Filter options */}
      <aside className='sm:w-[260px]'>
        <button
          type='button'
          onClick={() => setShowFilter(!showFilter)}
          className='w-full sm:w-auto flex items-center justify-between gap-3 px-4 py-3 sm:p-0 text-left'
        >
          <span className='text-[11px] uppercase tracking-[0.24em] text-[#777]'>Filters</span>
          <img
            className={`h-3 sm:hidden transition-transform ${showFilter ? 'rotate-90' : ''}`}
            src={assets.dropdown_icon}
            alt='toggle filters'
          />
        </button>

        <div className={`${showFilter ? 'block' : 'hidden'} sm:block px-4 sm:px-0 space-y-4`}>
          <div className='py-1'>
            <button
              type='button'
              onClick={() => toggleSection('categories')}
              className='w-full flex items-center justify-between py-2 text-left'
              aria-expanded={openSections.categories}
            >
              <span className='text-[11px] uppercase tracking-[0.2em] text-[#777]'>Categories</span>
              <img
                src={assets.dropdown_icon}
                alt='toggle categories'
                className={`h-2.5 transition-transform ${openSections.categories ? 'rotate-90' : ''}`}
              />
            </button>

            <div className={`grid transition-all duration-300 ${openSections.categories ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className='overflow-hidden'>
                {renderFilterChips(CATEGORY_OPTIONS, category, toggleCategory)}
              </div>
            </div>
          </div>

          <div className='py-1'>
            <button
              type='button'
              onClick={() => toggleSection('type')}
              className='w-full flex items-center justify-between py-2 text-left'
              aria-expanded={openSections.type}
            >
              <span className='text-[11px] uppercase tracking-[0.2em] text-[#777]'>Type</span>
              <img
                src={assets.dropdown_icon}
                alt='toggle type'
                className={`h-2.5 transition-transform ${openSections.type ? 'rotate-90' : ''}`}
              />
            </button>

            <div className={`grid transition-all duration-300 ${openSections.type ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className='overflow-hidden'>
                {renderFilterChips(TYPE_OPTIONS, subCategory, toggleSubCategory)}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/*Right side */}

      <div className='flex-1'>
        <div className='mb-5 px-4 sm:px-0'>
          <p className='text-[11px] uppercase tracking-[0.24em] text-[#777]'>Collections</p>
          <h1 className='mt-2 text-[1.9rem] sm:text-[2.2rem] leading-[0.95] font-semibold tracking-[-0.015em] text-[#111]'>
            All Collections
          </h1>
        </div>

        {/*Map products */}
        <div className='grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 gap-y-6 px-4 sm:px-0'>
          {loadingProductsData
            ? Array.from({ length: 10 }).map((_, i) => (
              <ProductShimmer key={i} />
            ))
            : filterProducts.map((item) => (
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

    </section>
  )
}

export default Collection
