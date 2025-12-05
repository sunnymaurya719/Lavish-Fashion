import React, { useState } from 'react'
import { useEffect } from 'react';
import axios from 'axios'
import { BACKEND_URL } from '../App.jsx'
import { toast } from 'react-toastify';


const List = ({ token }) => {

  const width = window.innerWidth;

  const [list, setList] = useState([]);
  const fetchList = async () => {
    try {
      const response = await axios.get(BACKEND_URL + '/api/product/list');
      if (response.data.success) {
        setList(response.data.products);

      }
      else {
        toast.error("Failed to fetch product list", response.data.message);
      }


    }
    catch (error) {
      console.error("Error fetching list:", error);
      toast.error(error.message)
    }
  }

  const removeProduct = async (id) =>{
    try {
      const response = await axios.post(BACKEND_URL + '/api/product/remove',{id},{headers:{token}});
      if(response.data.success){
        toast.success("Product removed successfully");
        await fetchList();
      }
      else{
        toast.error("Failed to remove product :"+ response.data.message);
      }
    }
    catch(error){
      console.error("Error removing product :",error);
      toast.error(error.message);
    }
  }

  useEffect(() => {
    fetchList();
  }, []);


  return (
    <>
      <p className='mb-2'>All Products List</p>
      <div className='flex flex-col gap-2'>

        {/* List Table Title */}

        <div className='hidden md:grid grid-cols-[1fr_3fr_1fr_1fr_1fr] items-center py-1 px-2 bg-gray-100 text-sm'>
          <b>Image</b>
          <b>Name</b>
          <b>Category</b>
          <b>Price</b>
          <b className='text-center'>Action</b>
        </div>

        {/* List Table Items */}

        {
          list.map((item, index) => (
            <div className='grid grid-cols-[1fr_3fr_1fr_1fr] md:grid-cols-[1fr_3fr_1fr_1fr_1fr] items-center gap-2 py-1 px-2 border border-slate-200 text-sm' key={index}>
              {
                width < 768 ?
                  <>
                    <img src={item.image[0]} alt="" />
                    <p className={width<425 ?'text-[10px]':''}>{item.name}</p>
                    <p className={width<425 ?'text-[10px]':''}>₹ {item.price}</p>
                    <p onClick={() => removeProduct(item._id)} className={`${width<425 ? 'text-[10px]':''} text-right md:text-center cursor-pointer text-lg`}>X</p>
                  </>
                  :
                  <>
                    <img className='w-20' src={item.image[0]} alt="" />
                    <p>{item.name}</p>
                    <p className='ml-2'>{item.category}</p>
                    <p>₹ {item.price}</p>
                    <p onClick={() => removeProduct(item._id)} className='text-right md:text-center cursor-pointer text-lg'>X</p>
                  </>


              }

            </div>
          ))
        }

      </div>

    </>
  )
}

export default List