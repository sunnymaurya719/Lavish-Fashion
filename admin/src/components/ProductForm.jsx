import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import { BACKEND_URL } from '../config/api';
import { assets } from '../assets/assets';

const imageFieldNames = ['image1', 'image2', 'image3', 'image4'];
const categoryOptions = ['Men', 'Women', 'Kids'];
const subCategoryOptions = ['Topwear', 'Bottomwear', 'Winterwear'];
const statusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
];

const createFileSlot = (file) => ({
  kind: 'file',
  file,
  preview: URL.createObjectURL(file),
});

const revokeFilePreview = (slot) => {
  if (slot?.kind === 'file' && slot.preview) {
    URL.revokeObjectURL(slot.preview);
  }
};

const ProductForm = ({ token, mode = 'create', productId = '', serverBootstrap, serverStatus }) => {
  const navigate = useNavigate();
  const isEditMode = mode === 'edit';
  const mediaUploadsEnabled =
    serverStatus === 'online' ? Boolean(serverBootstrap?.integrations?.cloudinaryConfigured) : true;

  const [imageSlots, setImageSlots] = useState([null, null, null, null]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('Men');
  const [subCategory, setSubCategory] = useState('Topwear');
  const [sku, setSku] = useState('');
  const [stock, setStock] = useState('25');
  const [lowStockThreshold, setLowStockThreshold] = useState('5');
  const [status, setStatus] = useState('active');
  const [isFeatured, setIsFeatured] = useState(false);
  const [sizeInput, setSizeInput] = useState('');
  const [sizes, setSizes] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingProduct, setIsLoadingProduct] = useState(isEditMode);
  const submitDisabled = isSubmitting || (!mediaUploadsEnabled && !isEditMode);

  useEffect(() => {
    if (!isEditMode || !productId) {
      return;
    }

    const fetchProduct = async () => {
      setIsLoadingProduct(true);

      try {
        const response = await axios.post(
          BACKEND_URL + '/api/product/admin-single',
          { id: productId },
          { headers: { token } }
        );

        if (!response.data.success) {
          toast.error(response.data.message || 'Failed to load product details');
          navigate('/products');
          return;
        }

        const product = response.data.product;
        setName(product.name || '');
        setDescription(product.description || '');
        setPrice(String(product.price || ''));
        setCategory(product.category || 'Men');
        setSubCategory(product.subCategory || 'Topwear');
        setSku(product.sku || '');
        setStock(String(product.stock ?? 25));
        setLowStockThreshold(String(product.lowStockThreshold ?? 5));
        setStatus(product.status || 'active');
        setIsFeatured(Boolean(product.isFeatured));
        setSizes(Array.isArray(product.sizes) ? product.sizes : []);
        setImageSlots(
          imageFieldNames.map((_, index) => {
            const existingImage = product.image?.[index];
            return existingImage ? { kind: 'existing', preview: existingImage } : null;
          })
        );
      } catch (error) {
        toast.error(error?.response?.data?.message || error.message);
        navigate('/products');
      } finally {
        setIsLoadingProduct(false);
      }
    };

    fetchProduct();
  }, [isEditMode, navigate, productId, token]);

  useEffect(() => () => {
    imageSlots.forEach(revokeFilePreview);
  }, [imageSlots]);

  const resetCreateForm = () => {
    setName('');
    setDescription('');
    setPrice('');
    setCategory('Men');
    setSubCategory('Topwear');
    setSku('');
    setStock('25');
    setLowStockThreshold('5');
    setStatus('active');
    setIsFeatured(false);
    setSizeInput('');
    setSizes([]);
    setImageSlots([null, null, null, null]);
  };

  const handleImageChange = (index, file) => {
    if (!file) {
      return;
    }

    if (!mediaUploadsEnabled) {
      toast.error('Product media uploads are not configured on the server');
      return;
    }

    setImageSlots((currentSlots) =>
      currentSlots.map((slot, slotIndex) => (slotIndex === index ? createFileSlot(file) : slot))
    );
  };

  const clearImageSlot = (index) => {
    setImageSlots((currentSlots) =>
      currentSlots.map((slot, slotIndex) => (slotIndex === index ? null : slot))
    );
  };

  const addSize = () => {
    const normalizedSize = sizeInput.trim().toUpperCase();

    if (!normalizedSize) {
      return;
    }

    if (sizes.includes(normalizedSize)) {
      setSizeInput('');
      return;
    }

    setSizes((currentSizes) => [...currentSizes, normalizedSize]);
    setSizeInput('');
  };

  const removeSize = (sizeToRemove) => {
    setSizes((currentSizes) => currentSizes.filter((size) => size !== sizeToRemove));
  };

  const buildFormData = () => {
    const formData = new FormData();
    formData.append('name', name.trim());
    formData.append('description', description.trim());
    formData.append('price', price);
    formData.append('category', category);
    formData.append('subCategory', subCategory);
    formData.append('sku', sku.trim().toUpperCase());
    formData.append('stock', stock);
    formData.append('lowStockThreshold', lowStockThreshold);
    formData.append('status', status);
    formData.append('isFeatured', String(isFeatured));
    formData.append('sizes', JSON.stringify(sizes));

    if (isEditMode) {
      formData.append('id', productId);
      formData.append(
        'existingImages',
        JSON.stringify(imageSlots.map((slot) => (slot?.kind === 'existing' ? slot.preview : '')))
      );
    }

    imageSlots.forEach((slot, index) => {
      if (slot?.kind === 'file') {
        formData.append(imageFieldNames[index], slot.file);
      }
    });

    return formData;
  };

  const onSubmitHandler = async (event) => {
    event.preventDefault();

    if (submitDisabled) {
      if (!mediaUploadsEnabled && !isEditMode) {
        toast.error('Configure Cloudinary on the server before creating new products');
      }
      return;
    }

    if (sizes.length === 0) {
      toast.error('Please add at least one size');
      return;
    }

    if (imageSlots.every((slot) => slot === null)) {
      toast.error('Please upload at least one image');
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = buildFormData();
      const response = isEditMode
        ? await axios.put(BACKEND_URL + '/api/product/update', formData, { headers: { token } })
        : await axios.post(BACKEND_URL + '/api/product/add', formData, { headers: { token } });

      if (!response.data.success) {
        toast.error(response.data.message || 'Unable to save product');
        return;
      }

      toast.success(isEditMode ? 'Product updated successfully' : 'Product added successfully');

      if (isEditMode) {
        navigate('/products');
        return;
      }

      resetCreateForm();
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingProduct) {
    return <p className='text-sm text-gray-500'>Loading product details...</p>;
  }

  return (
    <form onSubmit={onSubmitHandler} className='flex flex-col gap-6'>
      <div className='grid gap-6 xl:grid-cols-[1.7fr_1fr]'>
        <div className='bg-white border border-slate-200 rounded-3xl p-6 shadow-sm'>
          <div className='flex items-center justify-between mb-5'>
            <div>
              <p className='text-lg font-semibold text-slate-900'>
                {isEditMode ? 'Edit Product' : 'Create Product'}
              </p>
              <p className='text-sm text-slate-500'>
                Manage catalog details, media, inventory, and publishing status in one workflow.
              </p>
            </div>
            <span className='px-3 py-1 rounded-full bg-slate-100 text-xs text-slate-600 uppercase tracking-[0.2em]'>
              {status}
            </span>
          </div>

          <div className='grid gap-5'>
            {!mediaUploadsEnabled ? (
              <div className='rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800'>
                Cloudinary is not configured on the server. You can still update non-media product details for existing
                products, but new image uploads are currently disabled.
              </div>
            ) : null}

            <div>
              <p className='mb-3 text-sm font-medium text-slate-700'>Product media</p>
              <div className='flex flex-wrap gap-3'>
                {imageFieldNames.map((fieldName, index) => (
                  <div key={fieldName} className='relative'>
                    <label htmlFor={fieldName} className='cursor-pointer block'>
                      <img
                        className='w-24 h-24 object-cover rounded-2xl border border-slate-200'
                        src={imageSlots[index]?.preview || assets.upload_area}
                        alt='Product slot preview'
                      />
                      <input
                        id={fieldName}
                        hidden
                        type='file'
                        accept='image/*'
                        disabled={!mediaUploadsEnabled}
                        onChange={(event) => handleImageChange(index, event.target.files?.[0])}
                      />
                    </label>
                    {imageSlots[index] ? (
                      <button
                        type='button'
                        onClick={() => clearImageSlot(index)}
                        className='absolute -top-2 -right-2 rounded-full bg-white p-1 shadow'
                        aria-label='Remove image'
                      >
                        <img className='w-4 h-4' src={assets.close} alt='' />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className='grid gap-5 md:grid-cols-2'>
              <div className='md:col-span-2'>
                <p className='mb-2 text-sm font-medium text-slate-700'>Product name</p>
                <input
                  onChange={(event) => setName(event.target.value)}
                  value={name}
                  className='w-full px-4 py-3 border border-slate-300 rounded-2xl'
                  type='text'
                  placeholder='Type here'
                  required
                />
              </div>

              <div className='md:col-span-2'>
                <p className='mb-2 text-sm font-medium text-slate-700'>Product description</p>
                <textarea
                  onChange={(event) => setDescription(event.target.value)}
                  value={description}
                  className='w-full min-h-36 px-4 py-3 border border-slate-300 rounded-2xl'
                  placeholder='Write product details here'
                  required
                />
              </div>

              <div>
                <p className='mb-2 text-sm font-medium text-slate-700'>Category</p>
                <select
                  onChange={(event) => setCategory(event.target.value)}
                  value={category}
                  className='w-full px-4 py-3 border border-slate-300 rounded-2xl'
                >
                  {categoryOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <p className='mb-2 text-sm font-medium text-slate-700'>Subcategory</p>
                <select
                  onChange={(event) => setSubCategory(event.target.value)}
                  value={subCategory}
                  className='w-full px-4 py-3 border border-slate-300 rounded-2xl'
                >
                  {subCategoryOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <p className='mb-2 text-sm font-medium text-slate-700'>Price</p>
                <input
                  onChange={(event) => setPrice(event.target.value)}
                  value={price}
                  className='w-full px-4 py-3 border border-slate-300 rounded-2xl'
                  type='number'
                  min='1'
                  placeholder='999'
                  required
                />
              </div>

              <div>
                <p className='mb-2 text-sm font-medium text-slate-700'>SKU</p>
                <input
                  onChange={(event) => setSku(event.target.value)}
                  value={sku}
                  className='w-full px-4 py-3 border border-slate-300 rounded-2xl'
                  type='text'
                  placeholder='LAV-TSHIRT-001'
                />
              </div>
            </div>
          </div>
        </div>

        <div className='flex flex-col gap-6'>
          <div className='bg-white border border-slate-200 rounded-3xl p-6 shadow-sm'>
            <p className='text-lg font-semibold text-slate-900'>Inventory</p>
            <p className='text-sm text-slate-500 mb-5'>
              Keep stock and alert thresholds up to date so the dashboard can surface risk early.
            </p>

            <div className='grid gap-4'>
              <div>
                <p className='mb-2 text-sm font-medium text-slate-700'>Available stock</p>
                <input
                  onChange={(event) => setStock(event.target.value)}
                  value={stock}
                  className='w-full px-4 py-3 border border-slate-300 rounded-2xl'
                  type='number'
                  min='0'
                  required
                />
              </div>
              <div>
                <p className='mb-2 text-sm font-medium text-slate-700'>Low-stock threshold</p>
                <input
                  onChange={(event) => setLowStockThreshold(event.target.value)}
                  value={lowStockThreshold}
                  className='w-full px-4 py-3 border border-slate-300 rounded-2xl'
                  type='number'
                  min='0'
                  required
                />
              </div>
              <div>
                <p className='mb-2 text-sm font-medium text-slate-700'>Product status</p>
                <select
                  onChange={(event) => setStatus(event.target.value)}
                  value={status}
                  className='w-full px-4 py-3 border border-slate-300 rounded-2xl'
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <label className='flex items-center justify-between border border-slate-200 rounded-2xl px-4 py-3 cursor-pointer'>
                <div>
                  <p className='text-sm font-medium text-slate-700'>Feature on dashboard</p>
                  <p className='text-xs text-slate-500'>Use featured products for merchandising moments later.</p>
                </div>
                <input
                  type='checkbox'
                  checked={isFeatured}
                  onChange={(event) => setIsFeatured(event.target.checked)}
                  className='h-4 w-4'
                />
              </label>
            </div>
          </div>

          <div className='bg-white border border-slate-200 rounded-3xl p-6 shadow-sm'>
            <p className='text-lg font-semibold text-slate-900'>Sizes</p>
            <p className='text-sm text-slate-500 mb-5'>Add every sellable size for this product.</p>

            <div className='flex gap-3 items-center'>
              <input
                className='w-full max-w-[110px] px-4 py-3 border border-slate-300 rounded-2xl'
                onChange={(event) => setSizeInput(event.target.value)}
                value={sizeInput}
                placeholder='Size'
              />
              <button
                type='button'
                className='px-4 py-3 bg-slate-900 hover:bg-slate-700 text-white rounded-2xl'
                onClick={addSize}
              >
                Add
              </button>
            </div>

            {sizes.length > 0 ? (
              <div className='flex flex-wrap gap-2 mt-4'>
                {sizes.map((size) => (
                  <button
                    key={size}
                    type='button'
                    onClick={() => removeSize(size)}
                    className='px-3 py-1.5 bg-slate-100 rounded-full text-sm text-slate-700'
                  >
                    {size} x
                  </button>
                ))}
              </div>
            ) : (
              <p className='mt-4 text-sm text-slate-500'>No sizes added yet.</p>
            )}
          </div>
        </div>
      </div>

      <div className='flex items-center gap-3'>
        <button
          type='submit'
          disabled={submitDisabled}
          className='px-6 py-3 bg-slate-900 text-white rounded-2xl hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed'
        >
          {isSubmitting ? 'Saving...' : isEditMode ? 'Update Product' : 'Create Product'}
        </button>
        <button
          type='button'
          onClick={() => navigate('/products')}
          className='px-6 py-3 border border-slate-300 text-slate-700 rounded-2xl'
        >
          Back to products
        </button>
      </div>
    </form>
  );
};

export default ProductForm;
