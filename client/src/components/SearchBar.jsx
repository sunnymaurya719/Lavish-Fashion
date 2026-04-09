import React, { memo, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { ShopContext } from '../context/ShopContext';
import { assets } from '../assets/assets';
import { useLocation } from 'react-router-dom';

const DEBOUNCE_MS = 300;

const SearchBar = () => {

    const { search, setSearch, showSearch, setShowSearch } = useContext(ShopContext);
    const [localQuery, setLocalQuery] = useState(search);
    const [visible, setVisible] = useState(false);
    const location = useLocation();
    const debounceRef = useRef(null);

    // Sync external search changes into local state
    useEffect(() => { setLocalQuery(search); }, [search]);

    useEffect(() => {
        if (location.pathname.includes('collection')) {
            setVisible(true);
        }
        else {
            setVisible(false);
        }
    }, [location])

    const handleChange = useCallback((e) => {
        const value = e.target.value;
        setLocalQuery(value);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setSearch(value), DEBOUNCE_MS);
    }, [setSearch]);

    // Cleanup timeout on unmount
    useEffect(() => () => clearTimeout(debounceRef.current), []);

  return showSearch && visible ? (
    <div className='bg-white text-center px-4 py-4 sm:py-5'>
        <div className='mx-auto flex items-center gap-3 rounded-full bg-[#f5f5f5] px-4 py-3 w-full sm:w-[min(560px,78%)]'>
            <img className='w-4 opacity-60' src={assets.search_icon} alt='search icon' />
            <input
                value={localQuery}
                onChange={handleChange}
                className='flex-1 outline-none bg-transparent text-[15px] text-[#111] placeholder:text-[#8a8a8a]'
                type='text'
                placeholder='Search products'
            />
        </div>

        <button
            type='button'
            onClick={() => setShowSearch(false)}
            className='mt-3 text-[11px] uppercase tracking-[0.2em] text-[#777] hover:text-[#111] transition-colors'
        >
            Close
        </button>
    </div>
  ) : null
}

export default memo(SearchBar)