import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import { BACKEND_URL } from '../config/api';
import { assets } from '../assets/assets';

const CREATE_DRAFT_KEY = 'admin.productForm.createDraft.v1';

const imageFieldNames = ['image1', 'image2', 'image3', 'image4'];
const categoryOptions = ['Men', 'Women', 'Kids'];
const subCategoryOptions = ['Topwear', 'Bottomwear', 'Winterwear'];
const statusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
];
const sizeScaleOptions = [
  { value: 'alpha', label: 'Alpha sizes' },
  { value: 'numeric', label: 'Numeric sizes' },
  { value: 'waist', label: 'Waist sizes' },
  { value: 'custom', label: 'Custom labels' },
];
const fitBiasOptions = [
  { value: 'true_to_size', label: 'True to size' },
  { value: 'runs_small', label: 'Runs small' },
  { value: 'runs_large', label: 'Runs large' },
];
const measurementTemplateConfig = {
  topwear: {
    label: 'Topwear',
    fields: ['chest', 'shoulder', 'garmentLength'],
  },
  bottomwear: {
    label: 'Bottomwear',
    fields: ['waist', 'hip', 'inseam'],
  },
  dress: {
    label: 'Dress',
    fields: ['chest', 'waist', 'hip', 'garmentLength'],
  },
  outerwear: {
    label: 'Outerwear',
    fields: ['chest', 'shoulder', 'sleeveLength', 'garmentLength'],
  },
  kids_general: {
    label: 'Kids general',
    fields: ['chest', 'waist', 'hip', 'garmentLength'],
  },
};
const measurementFieldLabels = {
  chest: 'Chest',
  waist: 'Waist',
  hip: 'Hip',
  shoulder: 'Shoulder',
  sleeveLength: 'Sleeve',
  inseam: 'Inseam',
  garmentLength: 'Length',
};

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

const createEmptyMeasurementRow = (size = '') => ({
  size,
  chest: '',
  waist: '',
  hip: '',
  shoulder: '',
  sleeveLength: '',
  inseam: '',
  garmentLength: '',
});

const syncSizeMeasurements = (sizes = [], measurementRows = []) =>
  sizes.map((size) => {
    const existingRow = measurementRows.find((row) => row.size === size);
    return {
      ...createEmptyMeasurementRow(size),
      ...(existingRow || {}),
      size,
    };
  });

const calculateFitCompleteness = ({ sizes, sizeMeasurements, measurementTemplate }) => {
  const requiredFields = measurementTemplateConfig[measurementTemplate]?.fields || measurementTemplateConfig.topwear.fields;
  const totalFields = sizes.length * requiredFields.length;

  if (totalFields === 0) {
    return {
      completedSizes: 0,
      minimumReadySizes: 0,
      ratio: 0,
      requiredFields,
      ready: false,
    };
  }

  let completedFields = 0;
  let completedSizes = 0;

  sizeMeasurements.forEach((row) => {
    const completedFieldsForRow = requiredFields.filter((field) => String(row[field] ?? '').trim() !== '');
    completedFields += completedFieldsForRow.length;

    if (completedFieldsForRow.length === requiredFields.length) {
      completedSizes += 1;
    }
  });

  const minimumReadySizes = sizes.length > 1 ? 2 : 1;

  return {
    completedSizes,
    minimumReadySizes,
    ratio: Number((completedFields / totalFields).toFixed(2)),
    requiredFields,
    ready: completedSizes >= minimumReadySizes && sizes.length >= minimumReadySizes,
  };
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
  const [fitEnabled, setFitEnabled] = useState(false);
  const [sizeScale, setSizeScale] = useState('alpha');
  const [measurementTemplate, setMeasurementTemplate] = useState('topwear');
  const [fitBias, setFitBias] = useState('true_to_size');
  const [stretchScore, setStretchScore] = useState('0.25');
  const [sizeMeasurements, setSizeMeasurements] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingProduct, setIsLoadingProduct] = useState(isEditMode);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const initialMountRef = useRef(true);
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
        const productSizes = Array.isArray(product.sizes) ? product.sizes : [];
        const fitProfile = product.fitProfile || {};
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
        setSizes(productSizes);
        setFitEnabled(Boolean(product.fitEnabled));
        setSizeScale(product.sizeScale || 'alpha');
        setMeasurementTemplate(fitProfile.measurementTemplate || 'topwear');
        setFitBias(fitProfile.fitBias || 'true_to_size');
        setStretchScore(String(fitProfile.stretchScore ?? '0.25'));
        setSizeMeasurements(syncSizeMeasurements(productSizes, fitProfile.sizeMeasurements || []));
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

  useEffect(() => {
    setSizeMeasurements((currentRows) => syncSizeMeasurements(sizes, currentRows));
  }, [sizes]);

  const fitCompleteness = useMemo(
    () => calculateFitCompleteness({ sizes, sizeMeasurements, measurementTemplate }),
    [measurementTemplate, sizeMeasurements, sizes]
  );

  // Track form dirty state for confirm-on-leave + autosave (create mode only).
  const formSnapshot = useMemo(
    () => ({
      name,
      description,
      price,
      category,
      subCategory,
      sku,
      stock,
      lowStockThreshold,
      status,
      isFeatured,
      sizes,
      fitEnabled,
      sizeScale,
      measurementTemplate,
      fitBias,
      stretchScore,
      sizeMeasurements,
    }),
    [
      name, description, price, category, subCategory, sku, stock,
      lowStockThreshold, status, isFeatured, sizes, fitEnabled, sizeScale,
      measurementTemplate, fitBias, stretchScore, sizeMeasurements,
    ]
  );

  const isDirty = useMemo(() => {
    return (
      name.trim() !== '' ||
      description.trim() !== '' ||
      price !== '' ||
      sku.trim() !== '' ||
      sizes.length > 0 ||
      imageSlots.some((slot) => slot?.kind === 'file')
    );
  }, [name, description, price, sku, sizes, imageSlots]);

  // Validation summary (computed every render; banner shows after submit attempt or whenever invalid in edit mode).
  const validationIssues = useMemo(() => {
    const issues = [];
    if (!name.trim()) issues.push('Product name is required');
    if (!description.trim()) issues.push('Product description is required');
    if (price === '' || Number(price) < 1) issues.push('Price must be at least 1');
    if (sizes.length === 0) issues.push('Add at least one size');
    if (!isEditMode && imageSlots.every((slot) => slot === null)) {
      issues.push('Upload at least one product image');
    }
    if (fitEnabled && !fitCompleteness.ready) {
      issues.push(
        `AI fit needs complete measurements for at least ${fitCompleteness.minimumReadySizes} size(s)`
      );
    }
    return issues;
  }, [name, description, price, sizes, imageSlots, fitEnabled, fitCompleteness, isEditMode]);

  // Restore create-mode draft from localStorage on mount.
  useEffect(() => {
    if (isEditMode) return;
    try {
      const raw = localStorage.getItem(CREATE_DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== 'object') return;
      if (draft.name) setName(draft.name);
      if (draft.description) setDescription(draft.description);
      if (draft.price !== undefined) setPrice(String(draft.price));
      if (draft.category) setCategory(draft.category);
      if (draft.subCategory) setSubCategory(draft.subCategory);
      if (draft.sku) setSku(draft.sku);
      if (draft.stock !== undefined) setStock(String(draft.stock));
      if (draft.lowStockThreshold !== undefined) setLowStockThreshold(String(draft.lowStockThreshold));
      if (draft.status) setStatus(draft.status);
      if (typeof draft.isFeatured === 'boolean') setIsFeatured(draft.isFeatured);
      if (Array.isArray(draft.sizes)) setSizes(draft.sizes);
      if (typeof draft.fitEnabled === 'boolean') setFitEnabled(draft.fitEnabled);
      if (draft.sizeScale) setSizeScale(draft.sizeScale);
      if (draft.measurementTemplate) setMeasurementTemplate(draft.measurementTemplate);
      if (draft.fitBias) setFitBias(draft.fitBias);
      if (draft.stretchScore !== undefined) setStretchScore(String(draft.stretchScore));
      if (Array.isArray(draft.sizeMeasurements)) setSizeMeasurements(draft.sizeMeasurements);
    } catch (error) {
      // Ignore corrupt drafts silently.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave create-mode drafts to localStorage (debounced).
  useEffect(() => {
    if (isEditMode) return;
    if (initialMountRef.current) {
      initialMountRef.current = false;
      return;
    }
    const tid = setTimeout(() => {
      try {
        // Strip non-serializable bits (image files); only persist text fields.
        localStorage.setItem(CREATE_DRAFT_KEY, JSON.stringify(formSnapshot));
        setDraftSavedAt(new Date());
      } catch (error) {
        // Quota errors are non-fatal.
      }
    }, 600);
    return () => clearTimeout(tid);
  }, [formSnapshot, isEditMode]);

  // Confirm-on-leave guard for unsaved changes.
  useEffect(() => {
    if (!isDirty) return undefined;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

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
    setFitEnabled(false);
    setSizeScale('alpha');
    setMeasurementTemplate('topwear');
    setFitBias('true_to_size');
    setStretchScore('0.25');
    setSizeMeasurements([]);
    setImageSlots([null, null, null, null]);
    setSubmitAttempted(false);
    setDraftSavedAt(null);
    try {
      localStorage.removeItem(CREATE_DRAFT_KEY);
    } catch (error) {
      // ignore
    }
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

  const updateMeasurementField = (size, field, value) => {
    setSizeMeasurements((currentRows) =>
      currentRows.map((row) => (row.size === size ? { ...row, [field]: value } : row))
    );
  };

  const buildFormData = () => {
    const formData = new FormData();
    formData.append('name', name.trim());
    formData.append('description', description.trim());
    formData.append('price', price);
    formData.append('category', category);
    formData.append('subCategory', subCategory);
    formData.append('fitEnabled', String(fitEnabled));
    formData.append('sizeScale', sizeScale);
    formData.append('measurementTemplate', measurementTemplate);
    formData.append('fitBias', fitBias);
    formData.append('stretchScore', stretchScore);
    formData.append(
      'sizeMeasurements',
      JSON.stringify(
        syncSizeMeasurements(sizes, sizeMeasurements).map((row) => ({
          size: row.size,
          chest: row.chest,
          waist: row.waist,
          hip: row.hip,
          shoulder: row.shoulder,
          sleeveLength: row.sleeveLength,
          inseam: row.inseam,
          garmentLength: row.garmentLength,
        }))
      )
    );
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
    setSubmitAttempted(true);

    if (submitDisabled) {
      if (!mediaUploadsEnabled && !isEditMode) {
        toast.error('Configure Cloudinary on the server before creating new products');
      }
      return;
    }

    if (validationIssues.length > 0) {
      toast.error(`Fix ${validationIssues.length} issue${validationIssues.length === 1 ? '' : 's'} before saving`);
      // Scroll to validation banner if present.
      document.getElementById('product-form-issues')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    <form onSubmit={onSubmitHandler} className='flex flex-col gap-6 pb-24'>
      {submitAttempted && validationIssues.length > 0 ? (
        <div
          id='product-form-issues'
          className='rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-900'
          role='alert'
        >
          <p className='font-semibold'>
            {validationIssues.length} issue{validationIssues.length === 1 ? '' : 's'} to fix before saving
          </p>
          <ul className='mt-2 list-inside list-disc space-y-1 text-rose-800'>
            {validationIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className='grid gap-6 xl:grid-cols-[1.7fr_1fr]'>
        <div className='bg-white border border-slate-200 rounded-3xl p-6 shadow-sm'>
          <div className='flex items-center justify-between mb-5'>
            <div>
              <p className='text-lg font-semibold text-slate-900'>
                {isEditMode ? 'Edit Product' : 'Create Product'}
              </p>
              <p className='text-sm text-slate-500'>
                Manage catalog details, media, inventory, fit metadata, and publishing status in one workflow.
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

      <div className='bg-white border border-slate-200 rounded-3xl p-6 shadow-sm'>
        <div className='flex flex-col gap-3 md:flex-row md:items-start md:justify-between'>
          <div>
            <p className='text-lg font-semibold text-slate-900'>AI Fit Assistant</p>
            <p className='text-sm text-slate-500'>
              Configure garment measurements so the storefront can recommend sizes with confidence.
            </p>
          </div>
          <label className='inline-flex items-center gap-3 rounded-full bg-slate-100 px-4 py-2 text-sm text-slate-700'>
            <span>Enable fit assistant</span>
            <input
              type='checkbox'
              checked={fitEnabled}
              onChange={(event) => setFitEnabled(event.target.checked)}
              className='h-4 w-4'
            />
          </label>
        </div>

        <div className='grid gap-5 md:grid-cols-2 xl:grid-cols-4 mt-6'>
          <div>
            <p className='mb-2 text-sm font-medium text-slate-700'>Size scale</p>
            <select
              value={sizeScale}
              onChange={(event) => setSizeScale(event.target.value)}
              className='w-full px-4 py-3 border border-slate-300 rounded-2xl'
            >
              {sizeScaleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className='mb-2 text-sm font-medium text-slate-700'>Measurement template</p>
            <select
              value={measurementTemplate}
              onChange={(event) => setMeasurementTemplate(event.target.value)}
              className='w-full px-4 py-3 border border-slate-300 rounded-2xl'
            >
              {Object.entries(measurementTemplateConfig).map(([value, config]) => (
                <option key={value} value={value}>
                  {config.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className='mb-2 text-sm font-medium text-slate-700'>Fit bias</p>
            <select
              value={fitBias}
              onChange={(event) => setFitBias(event.target.value)}
              className='w-full px-4 py-3 border border-slate-300 rounded-2xl'
            >
              {fitBiasOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className='mb-2 text-sm font-medium text-slate-700'>Stretch score</p>
            <input
              value={stretchScore}
              onChange={(event) => setStretchScore(event.target.value)}
              className='w-full px-4 py-3 border border-slate-300 rounded-2xl'
              type='number'
              min='0'
              max='1'
              step='0.05'
              placeholder='0.25'
            />
          </div>
        </div>

        <div className='mt-6 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-600'>
          Required fields for this template: {fitCompleteness.requiredFields.map((field) => measurementFieldLabels[field]).join(', ')}.
          Measurements are stored in centimeters.
        </div>

        {fitEnabled && !fitCompleteness.ready ? (
          <div className='mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800'>
            AI fit is enabled, but the product is not ready yet. Complete measurements for at least{' '}
            {fitCompleteness.minimumReadySizes} size{fitCompleteness.minimumReadySizes > 1 ? 's' : ''}. Current readiness:{' '}
            {Math.round(fitCompleteness.ratio * 100)}%.
          </div>
        ) : null}

        {fitEnabled && fitCompleteness.ready ? (
          <div className='mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800'>
            This product has enough fit data to support the manual recommendation flow.
          </div>
        ) : null}

        <div className='mt-6 overflow-hidden rounded-3xl border border-slate-200'>
          <div className='overflow-x-auto'>
            <table className='min-w-full text-sm'>
              <thead className='bg-slate-100 text-slate-600 uppercase tracking-[0.18em] text-[11px]'>
                <tr>
                  <th className='px-4 py-3 text-left'>Size</th>
                  {fitCompleteness.requiredFields.map((field) => (
                    <th key={field} className='px-4 py-3 text-left'>
                      {measurementFieldLabels[field]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className='divide-y divide-slate-200 bg-white'>
                {sizes.length === 0 ? (
                  <tr>
                    <td colSpan={fitCompleteness.requiredFields.length + 1} className='px-4 py-6 text-slate-500'>
                      Add sizes first to enter garment measurements.
                    </td>
                  </tr>
                ) : (
                  syncSizeMeasurements(sizes, sizeMeasurements).map((row) => (
                    <tr key={row.size}>
                      <td className='px-4 py-3 font-medium text-slate-800'>{row.size}</td>
                      {fitCompleteness.requiredFields.map((field) => (
                        <td key={`${row.size}-${field}`} className='px-4 py-3'>
                          <input
                            type='number'
                            min='0'
                            step='0.1'
                            value={row[field]}
                            onChange={(event) => updateMeasurementField(row.size, field, event.target.value)}
                            className='w-28 px-3 py-2 border border-slate-300 rounded-xl'
                            placeholder='cm'
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className='fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur lg:left-72'>
        <div className='mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3'>
          <div className='flex flex-wrap items-center gap-3 text-xs text-slate-500'>
            {!isEditMode && draftSavedAt ? (
              <span>
                Draft saved {new Date(draftSavedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : null}
            {validationIssues.length > 0 ? (
              <span className='rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700'>
                {validationIssues.length} issue{validationIssues.length === 1 ? '' : 's'}
              </span>
            ) : (
              <span className='rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700'>
                Ready to save
              </span>
            )}
          </div>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={() => {
                if (isDirty && !window.confirm('Discard unsaved changes and leave?')) return;
                navigate('/products');
              }}
              className='rounded-2xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50'
            >
              Cancel
            </button>
            <button
              type='submit'
              disabled={submitDisabled}
              className='rounded-2xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60'
            >
              {isSubmitting ? 'Saving…' : isEditMode ? 'Update product' : 'Create product'}
            </button>
          </div>
        </div>
      </div>

      <div className='hidden items-center gap-3'>
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
