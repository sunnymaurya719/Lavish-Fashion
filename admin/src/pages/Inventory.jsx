/**
 * Inventory page — Phase 3 §3.3 of ADMIN_UI_OPTIMIZATION_PLAN.md
 *
 * Improvements vs prior version:
 *  - Dirty-row indicator (left border + "Unsaved" pill).
 *  - Floating "Save all changes (n)" sticky bar; Promise.allSettled with per-row outcome.
 *  - Discard changes per-row + global.
 *  - Threshold helper text under input.
 *  - Filter tab "Unsaved" added alongside All/Healthy/Low/Out.
 *  - Bulk restock "Add N units to selected rows" dialog.
 *  - Recent adjustments timeline (session memory only) on the right.
 *  - Debounced search; persisted filter; shared ui/* primitives.
 *  - Backwards-compat: same /api/product/inventory GET + PATCH endpoint, same adminToken header.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';
import {
  PageHeader,
  MetricGrid,
  MetricCard,
  Toolbar,
  Tabs,
  StatusBadge,
  ConfirmDialog,
  LoadingState,
  EmptyState,
} from '../components/ui';
import { useDebouncedValue, usePersistedState, useTableSelection } from '../hooks';

const STATUS_OPTIONS = ['active', 'draft', 'archived'];

const buildDraft = (product) => ({
  stock: String(product.stock ?? 0),
  lowStockThreshold: String(product.lowStockThreshold ?? 0),
  status: product.status || 'active',
});

const isDraftDirty = (product, draft) =>
  String(product.stock ?? 0) !== String(draft?.stock ?? '') ||
  String(product.lowStockThreshold ?? 0) !== String(draft?.lowStockThreshold ?? '') ||
  String(product.status || 'active') !== String(draft?.status || 'active');

const Inventory = ({ token }) => {
  const [products, setProducts] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const [filter, setFilter] = usePersistedState('admin.inventory.filter', 'all');
  const [savingId, setSavingId] = useState('');
  const [savingAll, setSavingAll] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [restockDialog, setRestockDialog] = useState(null); // { ids, units, busy }
  const [recentAdjustments, setRecentAdjustments] = useState([]); // session-only
  const cellRefs = useRef(new Map());

  const recordAdjustment = useCallback((entry) => {
    setRecentAdjustments((cur) => [{ ...entry, at: new Date().toISOString() }, ...cur].slice(0, 50));
  }, []);

  const fetchInventory = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await axios.get(BACKEND_URL + '/api/product/inventory', { headers: { token } });
      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to fetch inventory');
        return;
      }
      const list = response.data.products || [];
      setProducts(list);
      setDrafts(Object.fromEntries(list.map((p) => [p._id, buildDraft(p)])));
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const dirtyIds = useMemo(
    () => products.filter((p) => isDraftDirty(p, drafts[p._id])).map((p) => p._id),
    [products, drafts]
  );
  const dirtyIdSet = useMemo(() => new Set(dirtyIds), [dirtyIds]);

  const visibleProducts = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    return products.filter((product) => {
      const matchesSearch = `${product.name} ${product.sku} ${product.category} ${product.subCategory}`
        .toLowerCase()
        .includes(q);
      if (!matchesSearch) return false;
      if (filter === 'all') return true;
      if (filter === 'unsaved') return dirtyIdSet.has(product._id);
      return product.inventoryState === filter;
    });
  }, [products, debouncedSearch, filter, dirtyIdSet]);

  const selection = useTableSelection(visibleProducts, '_id');

  const totals = useMemo(
    () => ({
      units: products.reduce((sum, p) => sum + Number(p.stock || 0), 0),
      lowStock: products.filter((p) => p.inventoryState === 'low_stock').length,
      outOfStock: products.filter((p) => p.inventoryState === 'out_of_stock').length,
      active: products.filter((p) => p.status === 'active').length,
    }),
    [products]
  );

  const updateDraft = (productId, field, value) => {
    setDrafts((cur) => ({
      ...cur,
      [productId]: { ...(cur[productId] || {}), [field]: value },
    }));
  };

  const discardRow = (productId) => {
    const product = products.find((p) => p._id === productId);
    if (!product) return;
    setDrafts((cur) => ({ ...cur, [productId]: buildDraft(product) }));
  };

  const discardAll = () => {
    setDrafts(Object.fromEntries(products.map((p) => [p._id, buildDraft(p)])));
    toast.info('All unsaved changes discarded');
  };

  const persistOne = async (productId) => {
    const draft = drafts[productId];
    if (!draft) return { ok: false };
    const original = products.find((p) => p._id === productId);
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
        return { ok: false, message: response.data.message };
      }
      const updated = response.data.product;
      setProducts((cur) => cur.map((p) => (p._id === productId ? updated : p)));
      setDrafts((cur) => ({ ...cur, [productId]: buildDraft(updated) }));
      recordAdjustment({
        productId,
        name: original?.name || updated.name,
        deltaStock: Number(updated.stock) - Number(original?.stock || 0),
        newStock: updated.stock,
        status: updated.status,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error?.response?.data?.message || error.message };
    }
  };

  const saveOne = async (productId) => {
    setSavingId(productId);
    const result = await persistOne(productId);
    setSavingId('');
    if (result.ok) {
      toast.success('Inventory updated');
    } else {
      toast.error(result.message || 'Failed to update inventory');
    }
  };

  const saveAll = async () => {
    if (dirtyIds.length === 0) return;
    setSavingAll(true);
    const results = await Promise.allSettled(dirtyIds.map((id) => persistOne(id)));
    setSavingAll(false);
    const failed = [];
    results.forEach((res, idx) => {
      if (res.status !== 'fulfilled' || !res.value?.ok) {
        failed.push({ id: dirtyIds[idx], message: res.value?.message });
      }
    });
    if (failed.length === 0) {
      toast.success(`Saved ${results.length} row${results.length === 1 ? '' : 's'}`);
    } else {
      toast.error(`Saved ${results.length - failed.length} of ${results.length}; ${failed.length} failed`);
    }
  };

  const onRestockConfirm = async () => {
    if (!restockDialog) return;
    const units = Number(restockDialog.units);
    if (!Number.isFinite(units) || units === 0) {
      toast.error('Enter a non-zero number of units');
      return;
    }
    setRestockDialog((d) => ({ ...d, busy: true }));
    const ids = restockDialog.ids;
    // Stage drafts first.
    setDrafts((cur) => {
      const next = { ...cur };
      ids.forEach((id) => {
        const product = products.find((p) => p._id === id);
        const baseStock = Number(next[id]?.stock ?? product?.stock ?? 0);
        next[id] = { ...(next[id] || buildDraft(product || {})), stock: String(Math.max(0, baseStock + units)) };
      });
      return next;
    });
    setRestockDialog(null);
    toast.info(`${ids.length} row${ids.length === 1 ? '' : 's'} staged with ${units > 0 ? '+' : ''}${units}. Use Save all to commit.`);
  };

  // Keyboard nav inside the cell grid: ArrowUp/Down move between same-field cells across rows.
  const onCellKeyDown = (event, productId, field) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Enter') return;
    if (event.key === 'Enter') {
      event.preventDefault();
      saveOne(productId);
      return;
    }
    event.preventDefault();
    const idx = visibleProducts.findIndex((p) => p._id === productId);
    if (idx < 0) return;
    const nextIdx = event.key === 'ArrowDown' ? idx + 1 : idx - 1;
    const target = visibleProducts[nextIdx];
    if (!target) return;
    const node = cellRefs.current.get(`${target._id}.${field}`);
    node?.focus();
    node?.select?.();
  };

  const filterTabs = (
    <Tabs
      value={filter}
      onChange={setFilter}
      tabs={[
        { id: 'all', label: 'All', count: products.length },
        { id: 'healthy', label: 'Healthy', count: products.filter((p) => p.inventoryState === 'healthy').length },
        { id: 'low_stock', label: 'Low', count: totals.lowStock },
        { id: 'out_of_stock', label: 'Out', count: totals.outOfStock },
        { id: 'unsaved', label: 'Unsaved', count: dirtyIds.length },
      ]}
    />
  );

  const headerActions = (
    <>
      <button
        type='button'
        onClick={fetchInventory}
        className='rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50'
      >
        Refresh
      </button>
      <Link
        to='/products/new'
        className='rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800'
      >
        + Add product
      </Link>
    </>
  );

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        eyebrow='Catalog'
        title='Inventory'
        description='Adjust live stock, tune low-stock thresholds, and archive items in bulk.'
        actions={headerActions}
      />

      <MetricGrid columns={4}>
        <MetricCard label='Inventory units' value={totals.units} />
        <MetricCard label='Active products' value={totals.active} tone='success' />
        <MetricCard label='Low stock' value={totals.lowStock} tone='warning' />
        <MetricCard label='Out of stock' value={totals.outOfStock} tone='danger' />
      </MetricGrid>

      <Toolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder='Search by name, SKU, category…'
        filters={filterTabs}
        actions={
          <span className='text-xs text-slate-500'>
            {visibleProducts.length} of {products.length}
          </span>
        }
      />

      <div className='grid gap-6 xl:grid-cols-[1fr_320px]'>
        <section className='space-y-3'>
          {isLoading ? (
            <LoadingState variant='card' />
          ) : visibleProducts.length === 0 ? (
            <EmptyState
              title='No products match'
              description='Try clearing filters or refreshing inventory.'
            />
          ) : (
            visibleProducts.map((product) => {
              const draft = drafts[product._id] || buildDraft(product);
              const dirty = isDraftDirty(product, draft);
              const isSelected = selection.isSelected(product._id);
              return (
                <div
                  key={product._id}
                  className={`grid gap-4 rounded-3xl border bg-white p-4 xl:grid-cols-[auto_1.6fr_0.8fr_0.8fr_0.8fr_auto] ${
                    dirty ? 'border-l-4 border-l-amber-400 border-slate-200' : 'border-slate-200'
                  }`}
                >
                  <div className='flex items-start pt-1'>
                    <input
                      type='checkbox'
                      checked={isSelected}
                      onChange={() => selection.toggle(product._id)}
                      aria-label={`Select ${product.name}`}
                      className='h-4 w-4 rounded border-slate-300'
                    />
                  </div>

                  <div>
                    <div className='flex flex-col gap-3 sm:flex-row sm:items-start'>
                      <img
                        className='h-20 w-16 flex-shrink-0 rounded-2xl border border-slate-200 object-cover'
                        src={product.image?.[0]}
                        alt=''
                      />
                      <div className='min-w-0'>
                        <div className='flex flex-wrap items-center gap-2'>
                          <p className='font-medium text-slate-900'>{product.name}</p>
                          <StatusBadge status={product.inventoryState} size='sm' />
                          <StatusBadge status={product.status} size='sm' />
                          {dirty ? (
                            <span className='rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800'>
                              Unsaved
                            </span>
                          ) : null}
                        </div>
                        <p className='mt-1 text-xs text-slate-500'>
                          {product.category} / {product.subCategory}
                          {product.sku ? ` · SKU ${product.sku}` : ''}
                        </p>
                        <div className='mt-2'>
                          <Link
                            to={`/products/${product._id}/edit`}
                            className='text-xs font-medium text-slate-600 underline-offset-2 hover:underline'
                          >
                            Edit product
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className='mb-1 text-xs uppercase tracking-[0.2em] text-slate-400'>Stock</p>
                    <input
                      ref={(el) => {
                        if (el) cellRefs.current.set(`${product._id}.stock`, el);
                      }}
                      value={draft.stock}
                      onChange={(e) => updateDraft(product._id, 'stock', e.target.value)}
                      onKeyDown={(e) => onCellKeyDown(e, product._id, 'stock')}
                      className='w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums'
                      type='number'
                      min='0'
                    />
                  </div>

                  <div>
                    <p className='mb-1 text-xs uppercase tracking-[0.2em] text-slate-400'>Threshold</p>
                    <input
                      ref={(el) => {
                        if (el) cellRefs.current.set(`${product._id}.lowStockThreshold`, el);
                      }}
                      value={draft.lowStockThreshold}
                      onChange={(e) => updateDraft(product._id, 'lowStockThreshold', e.target.value)}
                      onKeyDown={(e) => onCellKeyDown(e, product._id, 'lowStockThreshold')}
                      className='w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums'
                      type='number'
                      min='0'
                    />
                    <p className='mt-1 text-[10px] text-slate-400'>Email triggered when stock ≤ this value</p>
                  </div>

                  <div>
                    <p className='mb-1 text-xs uppercase tracking-[0.2em] text-slate-400'>Status</p>
                    <select
                      value={draft.status}
                      onChange={(e) => updateDraft(product._id, 'status', e.target.value)}
                      className='w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm'
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>

                  <div className='flex items-end gap-2'>
                    {dirty ? (
                      <button
                        type='button'
                        onClick={() => discardRow(product._id)}
                        className='rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50'
                      >
                        Discard
                      </button>
                    ) : null}
                    <button
                      type='button'
                      onClick={() => saveOne(product._id)}
                      disabled={savingId === product._id || !dirty}
                      className='rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-slate-800'
                    >
                      {savingId === product._id ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </section>

        <aside className='space-y-4'>
          <div className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
            <p className='text-sm font-semibold text-slate-900'>Recent adjustments</p>
            <p className='text-xs text-slate-400'>Session-only · resets on refresh.</p>
            {recentAdjustments.length === 0 ? (
              <p className='mt-3 text-xs text-slate-500'>No adjustments yet.</p>
            ) : (
              <ul className='mt-3 space-y-2'>
                {recentAdjustments.map((entry, idx) => (
                  <li
                    key={`${entry.productId}-${idx}`}
                    className='rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-700'
                  >
                    <div className='font-medium text-slate-900 truncate'>{entry.name}</div>
                    <div className='mt-0.5 flex items-center justify-between text-slate-500'>
                      <span>
                        {entry.deltaStock > 0 ? '+' : ''}
                        {entry.deltaStock} → {entry.newStock} · {entry.status}
                      </span>
                      <span className='text-[10px] text-slate-400'>
                        {new Date(entry.at).toLocaleTimeString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {selection.selectedIds.length > 0 ? (
        <div className='sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-300 bg-white px-4 py-3 shadow-md'>
          <div className='text-sm font-medium text-slate-800'>
            {selection.selectedIds.length} selected
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <button
              type='button'
              onClick={() => setRestockDialog({ ids: selection.selectedIds, units: '10', busy: false })}
              className='rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100'
            >
              Bulk restock…
            </button>
            <button
              type='button'
              onClick={selection.clear}
              className='text-xs font-medium text-slate-500 hover:text-slate-800'
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

      {dirtyIds.length > 0 ? (
        <div className='sticky bottom-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-md'>
          <div className='text-sm font-medium text-amber-900'>
            {dirtyIds.length} row{dirtyIds.length === 1 ? '' : 's'} with unsaved changes
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <button
              type='button'
              onClick={discardAll}
              disabled={savingAll}
              className='rounded-xl border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60'
            >
              Discard all
            </button>
            <button
              type='button'
              onClick={saveAll}
              disabled={savingAll}
              className='rounded-xl bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60'
            >
              {savingAll ? 'Saving…' : `Save all changes (${dirtyIds.length})`}
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(restockDialog)}
        title={`Bulk restock ${restockDialog?.ids?.length || 0} products`}
        description='Adds the given delta to each selected product. Negative numbers reduce stock. Changes are staged as drafts; click "Save all changes" to commit.'
        confirmLabel='Stage changes'
        busy={Boolean(restockDialog?.busy)}
        confirmDisabled={
          restockDialog
            ? restockDialog.units === '' || Number.isNaN(Number(restockDialog.units))
            : false
        }
        onConfirm={onRestockConfirm}
        onCancel={() => setRestockDialog(null)}
      >
        {restockDialog ? (
          <div className='mt-4'>
            <label className='block text-xs font-medium text-slate-700'>
              Units to add (use negative to reduce)
            </label>
            <input
              type='number'
              value={restockDialog.units}
              onChange={(e) => setRestockDialog((d) => ({ ...d, units: e.target.value }))}
              className='mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm'
              autoFocus
            />
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
};

export default Inventory;
