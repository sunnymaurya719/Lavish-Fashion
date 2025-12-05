import React, { useState } from 'react'
import { assets } from '../assets/assets'
import axios from 'axios';
import { BACKEND_URL } from '../App';
import { toast } from 'react-toastify';

const Add = ({token}) => {

  const [image1,setImage1] = useState(false);
  const [image2,setImage2] = useState(false);
  const [image3,setImage3] = useState(false);
  const [image4,setImage4] = useState(false);

  const [name,setName] = useState("");
  const [description,setDescription] = useState("");
  const [price,setPrice] = useState("");
  const [category,setCategory] = useState("Men");
  const [subCategory,setSubCategory]= useState("Topwear");
  const [size,setSize] = useState("");
  const [sizes,setSizes] = useState([]);

  const addSize = () => {
    if(size === ""){
      return;
    }
    if(sizes.includes(size.toUpperCase())){
      setSize("");
      return;
    }

    setSizes(prev => [...prev,size.toUpperCase()]);
    setSize("");
  }

  const removeSize = () => {
    setSizes(prev => prev.slice(0,-1))
  }

  const onSubmitHandler =async (e) =>{
    e.preventDefault();

    if(sizes.length === 0){
      toast.error("Please add at least one size");
      return;
    }
    if(!image1){
      toast.error("Please upload at least one image");
      return;
    }

    try{
      const formData = new FormData();
      formData.append("name",name);
      formData.append("description",description);
      formData.append("price",price);
      formData.append("category",category);
      formData.append("subCategory",subCategory);

      formData.append("sizes",JSON.stringify(sizes));

      image1 && formData.append("image1",image1);
      image2 && formData.append("image2",image2);
      image3 && formData.append("image3",image3);
      image4 && formData.append("image4",image4);
 
      const response = await axios.post(BACKEND_URL+"/api/product/add",formData,{headers:{token}});
      
      if(response.data.success){
        toast.success("Product added successfully");
        setName("");
        setDescription("");
        setPrice(""); 
        setSizes([]);
        setImage1(false);
        setImage2(false);
        setImage3(false);
        setImage4(false);
      }
      else{
        toast.error(response.data.message);
      }

    }
    catch(error){
      console.log("Error adding product:",error);
    }
  }
  


  return (
    <form onSubmit={onSubmitHandler} className='flex flex-col w-full items-start gap-3'>

      <div>
        <p>Upload Image</p>
        <div className='flex gap-2'>
          <label htmlFor='image1'>
            <img className='w-20' src={!image1 ? assets.upload_area :URL.createObjectURL(image1)} alt=''/>
            <input onChange={(e) => setImage1(e.target.files[0])} type="file" id="image1" hidden />
          </label>
          <label htmlFor='image2'>
            <img className='w-20' src={!image2 ? assets.upload_area :URL.createObjectURL(image2)} alt=''/>
            <input onChange={(e) => setImage2(e.target.files[0])} type="file" id='image2' hidden/>
          </label>
          <label htmlFor='image3'>
            <img className='w-20' src={!image3 ? assets.upload_area :URL.createObjectURL(image3)} alt=''/>
            <input onChange={(e) => setImage3(e.target.files[0])} type="file" id='image3' hidden/>
          </label>
          <label htmlFor='image4'>
            <img className='w-20' src={!image4 ? assets.upload_area :URL.createObjectURL(image4)} alt=''/>
            <input onChange={(e) => setImage4(e.target.files[0])} type="file" id='image4' hidden/>
          </label>
        </div>
      </div>

      <div className='w-full'>
        <p className='mb-2'>Product name</p>
        <input onChange={(e) => setName(e.target.value)} value={name} className='w-full max-w-[500px] px-3 py-2'type="text" placeholder='Type here' required/>
      </div>

      <div className='w-full'>
        <p className='mb-2'>Product description</p>
        <textarea onChange={(e) => setDescription(e.target.value)} value={description} className='w-full max-w-[500px] px-3 py-2'type="text" placeholder='Write content here' required/>
      </div>

      <div className='flex flex-col sm:flex-row gap-2 w-full sm:gap-8'>

        <div>
          <p className='mb-2'>Product category</p>
          <select onChange={(e) => setCategory(e.target.value)} value={category} className='w-full px-3 py-2'>
            <option value="Men">Men</option>
            <option value="Women">Women</option>
            <option value="Kids">Kids</option>
          </select>
        </div>

        <div>
          <p className='mb-2'>Sub category</p>
          <select onChange={(e) => setSubCategory(e.target.value)} value={subCategory} className='w-full px-3 py-2'>
            <option value="Topwear">Topwear</option>
            <option value="Bottomwear">Bottomwear</option>
            <option value="Winter">Winter</option>
          </select>
        </div>

        <div>
          <p className='mb-2'>Product Price</p>
          <input onChange={(e) => setPrice(e.target.value)} value={price} className='w-full px-3 py-2 sm:w-[120px]' type="number" placeholder='25' required></input>
        </div>

      </div>

      <div>

        <p>Product Sizes</p>

        <div className='flex gap-3 mr-5'>
          <input className='w-full max-w-[55px] px-3 py-2' onChange={(e) => setSize(e.target.value)} value={size} placeholder='Size'/>
          <p className='px-2 pt-2 bg-slate-400 hover:bg-slate-700 text-white rounded cursor-pointer' onClick={addSize}>Add</p>
        </div>

        <div className='max-w-[240px]'>
         { 
          sizes.length > 0 && (
            <div className="grid grid-cols-5 gap-3 mt-2 justify-center items-center">
              {sizes.map((item,index) => (
                <div key={index}>
                  <p className='text-center bg-slate-200 rounded'>{item}</p>
                </div>
                ))
              }
              <img onClick={removeSize} className='w-5 p-1 bg-slate-400 hover:bg-slate-700 rounded-full' src={assets.close} alt=''/>
            </div>           
            )            
          }
        </div>
      </div>

      <button type="submit" className='w-28 py-3 mt-10 bg-slate-400 text-white rounded hover:bg-slate-700'>ADD</button>
    </form>
  )
}

export default Add