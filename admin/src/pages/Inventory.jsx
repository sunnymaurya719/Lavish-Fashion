import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';

const statusOptions = ['active', 'draft', 'archived'];

const getInventoryBadgeClasses = (inventoryState) => {
  if (inventoryState === 'out_of_stock') {
    return 'bg-rose-100 text-rose-700';
  }

  if (inventoryState === 'low_stock') {
    return 'bg-amber-100 text-amber-700';
  }

  return 'bg-emerald-100 text-emerald-700';
};

const getStatusBadgeClasses = (status) => {
  if (status === 'draft') {
    return 'bg-amber-100 text-amber-800';
  }

  if (status === 'archived') {
    return 'bg-slate-200 text-slate-700';
  }

  return 'bg-emerald-100 text-emerald-800';
};

const Inventory = ({ token }) => {
  const [products, setProducts] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [savingId, setSavingId] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const fetchInventory = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await axios.get(BACKEND_URL + '/api/product/inventory', {
        headers: { token },
      });

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to fetch inventory');
        return;
      }

      setProducts(response.data.products || []);
      setDrafts(
        Object.fromEntries(
          (response.data.products || []).map((product) => [
            product._id,
            {
              stock: String(product.stock ?? 0),
              lowStockThreshold: String(product.lowStockThreshold ?? 0),
              status: product.status || 'active',
            },
          ])
        )
      );
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const visibleProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesSearch = `${product.name} ${product.sku} ${product.category} ${product.subCategory}`
        .toLowerCase()
        .includes(search.toLowerCase());

      if (!matchesSearch) {
        return false;
      }

      if (filter === 'all') {
        return true;
      }

      return product.inventoryState === filter;
    });
  }, [filter, products, search]);

  const inventoryTotals = useMemo(() => {
    return {
      units: products.reduce((sum, product) => sum + Number(product.stock || 0), 0),
      lowStock: products.filter((product) => product.inventoryState === 'low_stock').length,
      outOfStock: products.filter((product) => product.inventoryState === 'out_of_stock').length,
      active: products.filter((product) => product.status === 'active').length,
    };
  }, [products]);

  const updateDraft = (productId, field, value) => {
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [productId]: {
        ...currentDrafts[productId],
        [field]: value,
      },
    }));
  };

  const hasDraftChanges = (product, draft) =>
    String(product.stock ?? 0) !== String(draft.stock ?? '') ||
    String(product.lowStockThreshold ?? 0) !== String(draft.lowStockThreshold ?? '') ||
    String(product.status || 'active') !== String(draft.status || 'active');

  const saveInventory = async (productId) => {
    const draft = drafts[productId];
    if (!draft) {
      return;
    }

    setSavingId(productId);

    try {
      const response = await axios.patch(
        BACKEND_URL + '/api/product/inventory',
        {
          id: productId,
          stock: Number(draft.stock),
          lowStockThreshold: Number(draft.lowStockThreshold),
          status: draft.status,
        },
        { headers: { token } }
      );

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to update inventory');
        return;
      }

      setProducts((currentProducts) =>
        currentProducts.map((product) => (product._id === productId ? response.data.product : product))
      );
      setDrafts((currentDrafts) => ({
        ...currentDrafts,
        [productId]: {
          stock: String(response.data.product.stock),
          lowStockThreshold: String(response.data.product.lowStockThreshold),
          status: response.data.product.status,
        },
      }));
      toast.success('Inventory updated');
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setSavingId('');
    }
  };

  return (
    <div className='flex flex-col gap-6'>
      <section className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
        <div className='flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between'>
          <div>
            <p className='text-lg font-semibold text-slate-900'>Inventory control room</p>
            <p className='text-sm text-slate-500'>
              Adjust live stock, tune low-stock thresholds, and archive or draft items without leaving the table.
            </p>
          </div>

          <div className='flex flex-wrap gap-3'>
            <Link
              to='/products/new'
              className='rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white'
            >
              Add product
            </Link>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className='min-w-72 rounded-2xl border border-slate-300 px-4 py-3'
              type='text'
              placeholder='Search by name, SKU, or category'
            />
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className='rounded-2xl border border-slate-300 bg-white px-4 py-3'
            >
              <option value='all'>All products</option>
              <option value='healthy'>Healthy</option>
              <option value='low_stock'>Low stock</option>
              <option value='out_of_stock'>Out of stock</option>
            </select>
          </div>
        </div>
      </section>

      <section className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
        <article className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
          <p className='text-sm text-slate-500'>Inventory units</p>
          <p className='mt-3 text-3xl font-semibold text-slate-900'>{inventoryTotals.units}</p>
        </article>
        <article className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
          <p className='text-sm text-slate-500'>Active products</p>
          <p className='mt-3 text-3xl font-semibold text-slate-900'>{inventoryTotals.active}</p>
        </article>
        <article className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
          <p className='text-sm text-slate-500'>Low stock alerts</p>
          <p className='mt-3 text-3xl font-semibold text-amber-700'>{inventoryTotals.lowStock}</p>
        </article>
        <article className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
          <p className='text-sm text-slate-500'>Out of stock</p>
          <p className='mt-3 text-3xl font-semibold text-rose-700'>{inventoryTotals.outOfStock}</p>
        </article>
      </section>

      <section className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
        <div className='mb-5 flex items-center justify-between'>
          <div>
            <p className='text-lg font-semibold text-slate-900'>Inventory table</p>
            <p className='text-sm text-slate-500'>Every value here is connected directly to the server.</p>
          </div>
          <button
            type='button'
            onClick={fetchInventory}
            className='rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700'
          >
            Refresh
          </button>
        </div>

        {isLoading ? (
          <div className='ui-loading-state'>Loading inventory...</div>
        ) : (
          <div className='space-y-3'>
            {visibleProducts.map((product) => {
              const draft = drafts[product._id] || {
                stock: String(product.stock ?? 0),
                lowStockThreshold: String(product.lowStockThreshold ?? 0),
                status: product.status,
              };
              const isDirty = hasDraftChanges(product, draft);

              return (
                <div
                  key={product._id}
                  className='grid gap-4 rounded-3xl border border-slate-200 p-4 xl:grid-cols-[1.6fr_0.7fr_0.7fr_0.7fr_auto]'
                >
                  <div>
                    <div className='flex flex-col gap-4 sm:flex-row sm:items-start'>
                      <img
                        className='h-24 w-20 rounded-3xl border border-slate-200 object-cover'
                        src={product.image?.[0]}
                        alt={product.name}
                      />
                      <div>
                        <div className='flex flex-wrap items-center gap-2'>
                          <p className='font-medium text-slate-900'>{product.name}</p>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] ${getInventoryBadgeClasses(
                              product.inventoryState
                            )}`}
                          >
                            {product.inventoryState.replace('_', ' ')}
                          </span>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] ${getStatusBadgeClasses(
                              product.status
                            )}`}
                          >
                            {product.status}
                          </span>
                          {product.isFeatured ? (
                            <span className='rounded-full bg-sky-100 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-sky-800'>
                              Featured
                            </span>
                          ) : null}
                        </div>
                        <p className='mt-1 text-sm text-slate-500'>
                          {product.category} / {product.subCategory}
                          {product.sku ? ` / SKU ${product.sku}` : ''}
                        </p>
                        <div className='mt-4 flex flex-wrap gap-2'>
                          <Link
                            to={`/products/${product._id}/edit`}
                            className='rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700'
                          >
                            Edit product
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className='mb-2 text-xs uppercase tracking-[0.2em] text-slate-400'>Stock</p>
                    <input
                      value={draft.stock}
                      onChange={(event) => updateDraft(product._id, 'stock', event.target.value)}
                      className='w-full rounded-2xl border border-slate-300 px-3 py-2'
                      type='number'
                      min='0'
                    />
                  </div>

                  <div>
                    <p className='mb-2 text-xs uppercase tracking-[0.2em] text-slate-400'>Threshold</p>
                    <input
                      value={draft.lowStockThreshold}
                      onChange={(event) => updateDraft(product._id, 'lowStockThreshold', event.target.value)}
                      className='w-full rounded-2xl border border-slate-300 px-3 py-2'
                      type='number'
                      min='0'
                    />
                  </div>

                  <div>
                    <p className='mb-2 text-xs uppercase tracking-[0.2em] text-slate-400'>Status</p>
                    <select
                      value={draft.status}
                      onChange={(event) => updateDraft(product._id, 'status', event.target.value)}
                      className='w-full rounded-2xl border border-slate-300 bg-white px-3 py-2'
                    >
                      {statusOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className='flex items-end'>
                    <button
                      type='button'
                      onClick={() => saveInventory(product._id)}
                      disabled={savingId === product._id || !isDirty}
                      className='w-full rounded-2xl bg-slate-900 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60'
                    >
                      {savingId === product._id ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              );
            })}

            {visibleProducts.length === 0 ? (
              <div className='rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500'>
                No products matched the current inventory filters.
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
};

export default Inventory;
