import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const formatDate = (value) => {
  if (!value) {
    return 'Recently';
  }

  return new Date(value).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const getStatusClasses = (status) => {
  if (status === 'draft') {
    return 'bg-amber-100 text-amber-800';
  }

  if (status === 'archived') {
    return 'bg-slate-200 text-slate-700';
  }

  return 'bg-emerald-100 text-emerald-800';
};

const getInventoryClasses = (inventoryState) => {
  if (inventoryState === 'out_of_stock') {
    return 'bg-rose-100 text-rose-800';
  }

  if (inventoryState === 'low_stock') {
    return 'bg-amber-100 text-amber-800';
  }

  return 'bg-emerald-100 text-emerald-800';
};

const truncateText = (value, limit = 140) => {
  const text = String(value || '').trim();

  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit).trim()}...`;
};

const List = ({ token }) => {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [inventoryFilter, setInventoryFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);

  const fetchList = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await axios.get(BACKEND_URL + '/api/product/admin-list', {
        headers: { token },
      });

      if (response.data.success) {
        setProducts(response.data.products || []);
        return;
      }

      toast.error(response.data.message || 'Failed to fetch product list');
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  const removeProduct = async (id) => {
    const shouldDelete = window.confirm('Delete this product from the catalog?');
    if (!shouldDelete) {
      return;
    }

    try {
      const response = await axios.post(
        BACKEND_URL + '/api/product/remove',
        { id },
        { headers: { token } }
      );

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to remove product');
        return;
      }

      toast.success('Product removed successfully');
      await fetchList();
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    }
  };

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const visibleProducts = useMemo(() => {
    return products.filter((product) => {
      const haystack = `${product.name} ${product.sku} ${product.category} ${product.subCategory}`
        .toLowerCase()
        .trim();
      const matchesSearch = haystack.includes(search.toLowerCase().trim());

      if (!matchesSearch) {
        return false;
      }

      if (statusFilter !== 'all' && product.status !== statusFilter) {
        return false;
      }

      if (inventoryFilter !== 'all' && product.inventoryState !== inventoryFilter) {
        return false;
      }

      return true;
    });
  }, [inventoryFilter, products, search, statusFilter]);

  const summaryCards = useMemo(() => {
    return [
      {
        label: 'Catalog items',
        value: products.length,
        tone: 'text-slate-900',
      },
      {
        label: 'Active products',
        value: products.filter((product) => product.status === 'active').length,
        tone: 'text-emerald-700',
      },
      {
        label: 'Draft products',
        value: products.filter((product) => product.status === 'draft').length,
        tone: 'text-amber-700',
      },
      {
        label: 'Low-stock alerts',
        value: products.filter((product) => product.inventoryState !== 'healthy').length,
        tone: 'text-rose-700',
      },
    ];
  }, [products]);

  return (
    <div className='flex flex-col gap-6'>
      <section className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
        <div className='flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between'>
          <div>
            <p className='text-lg font-semibold text-slate-900'>Catalog command center</p>
            <p className='text-sm text-slate-500'>
              Review every product state, monitor stock posture, and jump directly into catalog updates.
            </p>
          </div>

          <div className='flex flex-wrap gap-3'>
            <button
              type='button'
              onClick={fetchList}
              className='rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700'
            >
              Refresh
            </button>
            <Link
              to='/products/new'
              className='rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white'
            >
              Add product
            </Link>
          </div>
        </div>
      </section>

      <section className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
        {summaryCards.map((card) => (
          <article key={card.label} className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
            <p className='text-sm text-slate-500'>{card.label}</p>
            <p className={`mt-3 text-3xl font-semibold ${card.tone}`}>{card.value}</p>
          </article>
        ))}
      </section>

      <section className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
        <div className='grid gap-3 lg:grid-cols-[1.6fr_0.7fr_0.7fr]'>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className='rounded-2xl border border-slate-300 px-4 py-3'
            type='text'
            placeholder='Search by name, SKU, category, or subcategory'
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className='rounded-2xl border border-slate-300 bg-white px-4 py-3'
          >
            <option value='all'>All statuses</option>
            <option value='active'>Active</option>
            <option value='draft'>Draft</option>
            <option value='archived'>Archived</option>
          </select>
          <select
            value={inventoryFilter}
            onChange={(event) => setInventoryFilter(event.target.value)}
            className='rounded-2xl border border-slate-300 bg-white px-4 py-3'
          >
            <option value='all'>All inventory states</option>
            <option value='healthy'>Healthy</option>
            <option value='low_stock'>Low stock</option>
            <option value='out_of_stock'>Out of stock</option>
          </select>
        </div>
      </section>

      <section className='space-y-4'>
        {isLoading ? (
          <div className='ui-loading-state'>Loading products...</div>
        ) : visibleProducts.length === 0 ? (
          <div className='rounded-[32px] border border-slate-200 bg-white px-6 py-10 text-sm text-slate-500 shadow-sm'>
            No products matched the current catalog filters.
          </div>
        ) : (
          visibleProducts.map((product) => (
            <article key={product._id} className='rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm'>
              <div className='flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between'>
                <div className='flex flex-col gap-4 sm:flex-row'>
                  <img
                    className='h-28 w-24 rounded-3xl border border-slate-200 object-cover'
                    src={product.image?.[0]}
                    alt={product.name}
                  />

                  <div className='min-w-0'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <h2 className='text-lg font-semibold text-slate-900'>{product.name}</h2>
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${getStatusClasses(
                          product.status
                        )}`}
                      >
                        {product.status}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${getInventoryClasses(
                          product.inventoryState
                        )}`}
                      >
                        {product.inventoryState.replace('_', ' ')}
                      </span>
                      {product.isFeatured ? (
                        <span className='rounded-full bg-sky-100 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-sky-800'>
                          Featured
                        </span>
                      ) : null}
                    </div>

                    <p className='mt-2 text-sm text-slate-500'>
                      {product.category} / {product.subCategory}
                      {product.sku ? ` / SKU ${product.sku}` : ''}
                    </p>
                    <p className='mt-3 max-w-3xl text-sm leading-6 text-slate-600'>
                      {truncateText(product.description)}
                    </p>
                  </div>
                </div>

                <div className='flex flex-wrap gap-3'>
                  <button
                    type='button'
                    onClick={() => navigate(`/products/${product._id}/edit`)}
                    className='rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white'
                  >
                    Edit product
                  </button>
                  <button
                    type='button'
                    onClick={() => navigate('/inventory')}
                    className='rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700'
                  >
                    Open inventory
                  </button>
                  <button
                    type='button'
                    onClick={() => removeProduct(product._id)}
                    className='rounded-2xl border border-rose-200 px-4 py-3 text-sm font-medium text-rose-700'
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className='mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6'>
                <div className='rounded-2xl bg-slate-50 px-4 py-3'>
                  <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Price</p>
                  <p className='mt-2 text-lg font-semibold text-slate-900'>{formatCurrency(product.price)}</p>
                </div>
                <div className='rounded-2xl bg-slate-50 px-4 py-3'>
                  <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Stock</p>
                  <p className='mt-2 text-lg font-semibold text-slate-900'>{product.stock}</p>
                </div>
                <div className='rounded-2xl bg-slate-50 px-4 py-3'>
                  <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Threshold</p>
                  <p className='mt-2 text-lg font-semibold text-slate-900'>{product.lowStockThreshold}</p>
                </div>
                <div className='rounded-2xl bg-slate-50 px-4 py-3'>
                  <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Sizes</p>
                  <p className='mt-2 text-lg font-semibold text-slate-900'>{product.sizes?.length || 0}</p>
                </div>
                <div className='rounded-2xl bg-slate-50 px-4 py-3'>
                  <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Updated</p>
                  <p className='mt-2 text-lg font-semibold text-slate-900'>
                    {formatDate(product.updatedAt || product.date)}
                  </p>
                </div>
                <div className='rounded-2xl bg-slate-50 px-4 py-3'>
                  <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Visibility</p>
                  <p className='mt-2 text-lg font-semibold text-slate-900'>
                    {product.status === 'active' ? 'Storefront live' : 'Admin only'}
                  </p>
                </div>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
};

export default List;
