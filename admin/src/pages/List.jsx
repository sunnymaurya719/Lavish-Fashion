/**
 * Products / Catalog list — Phase 3 §3.2 of ADMIN_UI_OPTIMIZATION_PLAN.md
 *
 * - Shared ui/* primitives (PageHeader, MetricGrid, Toolbar, DataTable, ConfirmDialog, StatusBadge)
 * - Debounced search (useDebouncedValue 200ms)
 * - Persisted filters/sort (usePersistedState)
 * - Bulk select + bulk archive / set draft / set active / delete
 * - ConfirmDialog for destructive actions (replaces window.confirm)
 * - Optimistic delete with 8s toast undo (queues real DELETE only after undo window expires)
 * - Column sort (stock, price, updatedAt)
 * - Backwards-compatible: same /api/product/admin-list, /api/product/remove, /api/product/inventory endpoints, same adminToken header.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';
import {
  PageHeader,
  MetricGrid,
  MetricCard,
  Toolbar,
  DataTable,
  ConfirmDialog,
  StatusBadge,
  Money,
  formatDate,
} from '../components/ui';
import { useDebouncedValue, usePersistedState } from '../hooks';

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
];

const INVENTORY_FILTER_OPTIONS = [
  { value: 'all', label: 'All inventory states' },
  { value: 'healthy', label: 'Healthy' },
  { value: 'low_stock', label: 'Low stock' },
  { value: 'out_of_stock', label: 'Out of stock' },
];

const truncateText = (value, limit = 90) => {
  const text = String(value || '').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}...`;
};

const sortRows = (rows, sortKey, sortDirection) => {
  if (!sortKey || !sortDirection) return rows;
  const dir = sortDirection === 'asc' ? 1 : -1;
  const copy = [...rows];
  copy.sort((a, b) => {
    let av = a[sortKey];
    let bv = b[sortKey];
    if (sortKey === 'updatedAt') {
      av = new Date(av || a.date || 0).getTime();
      bv = new Date(bv || b.date || 0).getTime();
    } else if (sortKey === 'stock' || sortKey === 'price') {
      av = Number(av || 0);
      bv = Number(bv || 0);
    } else {
      av = String(av || '').toLowerCase();
      bv = String(bv || '').toLowerCase();
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
  return copy;
};

const List = ({ token }) => {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const [statusFilter, setStatusFilter] = usePersistedState('admin.products.statusFilter', 'all');
  const [inventoryFilter, setInventoryFilter] = usePersistedState('admin.products.inventoryFilter', 'all');
  const [sortKey, setSortKey] = usePersistedState('admin.products.sortKey', 'updatedAt');
  const [sortDirection, setSortDirection] = usePersistedState('admin.products.sortDirection', 'desc');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(null); // { ids: [], busy: bool }
  const [bulkConfirm, setBulkConfirm] = useState(null); // { kind, ids, label }
  const [busyBulk, setBusyBulk] = useState(false);
  const pendingUndoRef = useRef(new Map()); // id -> timeoutId

  const fetchList = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await axios.get(BACKEND_URL + '/api/product/admin-list', { headers: { token } });
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

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // Cleanup pending undo timers on unmount.
  useEffect(() => {
    const timers = pendingUndoRef.current;
    return () => {
      timers.forEach((tid) => clearTimeout(tid));
      timers.clear();
    };
  }, []);

  const visibleProducts = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    const filtered = products.filter((product) => {
      if (product.__pendingDelete) return false;
      const haystack = `${product.name} ${product.sku} ${product.category} ${product.subCategory}`
        .toLowerCase();
      if (q && !haystack.includes(q)) return false;
      if (statusFilter !== 'all' && product.status !== statusFilter) return false;
      if (inventoryFilter !== 'all' && product.inventoryState !== inventoryFilter) return false;
      return true;
    });
    return sortRows(filtered, sortKey, sortDirection);
  }, [products, debouncedSearch, statusFilter, inventoryFilter, sortKey, sortDirection]);

  const summary = useMemo(() => {
    const live = products.filter((p) => !p.__pendingDelete);
    return {
      total: live.length,
      active: live.filter((p) => p.status === 'active').length,
      draft: live.filter((p) => p.status === 'draft').length,
      lowStock: live.filter((p) => p.inventoryState && p.inventoryState !== 'healthy').length,
    };
  }, [products]);

  const performDelete = useCallback(
    async (id) => {
      try {
        const response = await axios.post(
          BACKEND_URL + '/api/product/remove',
          { id },
          { headers: { token } }
        );
        if (!response.data.success) {
          toast.error(response.data.message || 'Failed to remove product');
          // Restore on failure.
          setProducts((cur) => cur.map((p) => (p._id === id ? { ...p, __pendingDelete: false } : p)));
          return false;
        }
        setProducts((cur) => cur.filter((p) => p._id !== id));
        return true;
      } catch (error) {
        toast.error(error?.response?.data?.message || error.message);
        setProducts((cur) => cur.map((p) => (p._id === id ? { ...p, __pendingDelete: false } : p)));
        return false;
      }
    },
    [token]
  );

  const scheduleDeleteWithUndo = useCallback(
    (ids) => {
      // Mark as pendingDelete immediately so the rows disappear from view.
      setProducts((cur) => cur.map((p) => (ids.includes(p._id) ? { ...p, __pendingDelete: true } : p)));
      setSelectedIds((cur) => cur.filter((id) => !ids.includes(id)));

      ids.forEach((id) => {
        const product = products.find((p) => p._id === id);
        const label = product?.name || 'Product';
        const toastId = toast(
          ({ closeToast }) => (
            <div className='flex items-center justify-between gap-3'>
              <span className='text-sm'>
                Removed “{label}”. Undo within 8s.
              </span>
              <button
                type='button'
                onClick={() => {
                  const tid = pendingUndoRef.current.get(id);
                  if (tid) clearTimeout(tid);
                  pendingUndoRef.current.delete(id);
                  setProducts((cur) => cur.map((p) => (p._id === id ? { ...p, __pendingDelete: false } : p)));
                  closeToast?.();
                  toast.success('Restored');
                }}
                className='rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50'
              >
                Undo
              </button>
            </div>
          ),
          { autoClose: 8000, closeOnClick: false }
        );

        const tid = setTimeout(() => {
          pendingUndoRef.current.delete(id);
          performDelete(id);
          toast.dismiss(toastId);
        }, 8000);
        pendingUndoRef.current.set(id, tid);
      });
    },
    [performDelete, products]
  );

  const requestDelete = (ids) => {
    if (!ids || ids.length === 0) return;
    setConfirmDelete({ ids, busy: false });
  };

  const onConfirmDelete = () => {
    if (!confirmDelete) return;
    scheduleDeleteWithUndo(confirmDelete.ids);
    setConfirmDelete(null);
  };

  const performBulkStatus = async (ids, nextStatus) => {
    setBusyBulk(true);
    let successCount = 0;
    const previous = new Map(products.map((p) => [p._id, p.status]));
    // Optimistic update.
    setProducts((cur) => cur.map((p) => (ids.includes(p._id) ? { ...p, status: nextStatus } : p)));
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          axios.patch(
            BACKEND_URL + '/api/product/inventory',
            { id, status: nextStatus },
            { headers: { token } }
          )
        )
      );
      const failedIds = [];
      results.forEach((res, idx) => {
        if (res.status === 'fulfilled' && res.value?.data?.success) {
          successCount += 1;
        } else {
          failedIds.push(ids[idx]);
        }
      });
      if (failedIds.length > 0) {
        // Rollback failed ones.
        setProducts((cur) =>
          cur.map((p) => (failedIds.includes(p._id) ? { ...p, status: previous.get(p._id) || p.status } : p))
        );
        toast.error(`${failedIds.length} of ${ids.length} updates failed`);
      }
      if (successCount > 0) {
        toast.success(`Updated ${successCount} product${successCount === 1 ? '' : 's'} to ${nextStatus}`);
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
      // Restore all
      setProducts((cur) => cur.map((p) => (ids.includes(p._id) ? { ...p, status: previous.get(p._id) || p.status } : p)));
    } finally {
      setBusyBulk(false);
      setSelectedIds([]);
    }
  };

  const onConfirmBulk = async () => {
    if (!bulkConfirm) return;
    const { kind, ids } = bulkConfirm;
    setBulkConfirm(null);
    if (kind === 'delete') {
      scheduleDeleteWithUndo(ids);
      return;
    }
    await performBulkStatus(ids, kind);
  };

  const exportCsv = (rows) => {
    const headers = ['_id', 'name', 'sku', 'category', 'subCategory', 'status', 'inventoryState', 'stock', 'lowStockThreshold', 'price', 'updatedAt'];
    const escape = (v) => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const lines = [headers.join(',')];
    rows.forEach((r) => lines.push(headers.map((h) => escape(r[h])).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'}`);
  };

  const handleSortChange = (key, dir) => {
    setSortKey(key);
    setSortDirection(dir);
  };

  const columns = useMemo(
    () => [
      {
        key: 'name',
        header: 'Product',
        sortable: true,
        render: (row) => (
          <div className='flex items-center gap-3 min-w-0'>
            <img
              src={row.image?.[0]}
              alt=''
              className='h-12 w-10 rounded-xl border border-slate-200 object-cover flex-shrink-0'
            />
            <div className='min-w-0'>
              <div className='font-medium text-slate-900 truncate'>{row.name}</div>
              <div className='text-xs text-slate-500 truncate'>
                {row.category} / {row.subCategory}
                {row.sku ? ` · ${row.sku}` : ''}
              </div>
              {row.description ? (
                <div className='mt-1 text-xs text-slate-400 truncate'>{truncateText(row.description, 70)}</div>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: 'inventoryState',
        header: 'Inventory',
        render: (row) => <StatusBadge status={row.inventoryState} />,
      },
      {
        key: 'stock',
        header: 'Stock',
        sortable: true,
        align: 'right',
        render: (row) => <span className='tabular-nums'>{row.stock}</span>,
      },
      {
        key: 'price',
        header: 'Price',
        sortable: true,
        align: 'right',
        render: (row) => <Money value={row.price} />,
      },
      {
        key: 'updatedAt',
        header: 'Updated',
        sortable: true,
        render: (row) => (
          <span className='text-xs text-slate-500'>{formatDate(row.updatedAt || row.date)}</span>
        ),
      },
      {
        key: '__actions',
        header: '',
        align: 'right',
        render: (row) => (
          <div className='flex items-center justify-end gap-2'>
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/products/${row._id}/edit`);
              }}
              className='rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50'
            >
              Edit
            </button>
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation();
                requestDelete([row._id]);
              }}
              className='rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50'
            >
              Delete
            </button>
          </div>
        ),
      },
    ],
    [navigate]
  );

  const filterControls = (
    <>
      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        className='rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm'
        aria-label='Status filter'
      >
        {STATUS_FILTER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <select
        value={inventoryFilter}
        onChange={(e) => setInventoryFilter(e.target.value)}
        className='rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm'
        aria-label='Inventory filter'
      >
        {INVENTORY_FILTER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {(statusFilter !== 'all' || inventoryFilter !== 'all' || debouncedSearch) ? (
        <button
          type='button'
          onClick={() => {
            setStatusFilter('all');
            setInventoryFilter('all');
            setSearch('');
          }}
          className='text-xs font-medium text-slate-500 hover:text-slate-800'
        >
          Clear filters
        </button>
      ) : null}
    </>
  );

  const headerActions = (
    <>
      <button
        type='button'
        onClick={fetchList}
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
        title='Products'
        description='Review every product state, monitor stock posture, and act in bulk without leaving the table.'
        actions={headerActions}
      />

      <MetricGrid columns={4}>
        <MetricCard label='Catalog items' value={summary.total} />
        <MetricCard label='Active' value={summary.active} tone='success' />
        <MetricCard label='Drafts' value={summary.draft} tone='warning' />
        <MetricCard label='Low / out of stock' value={summary.lowStock} tone='danger' />
      </MetricGrid>

      <Toolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder='Search by name, SKU, category…'
        filters={filterControls}
        actions={
          <span className='text-xs text-slate-500'>
            {visibleProducts.length} of {summary.total}
          </span>
        }
      />

      {selectedIds.length > 0 ? (
        <div className='sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-300 bg-white px-4 py-3 shadow-md'>
          <div className='text-sm font-medium text-slate-800'>
            {selectedIds.length} selected
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <button
              type='button'
              disabled={busyBulk}
              onClick={() => setBulkConfirm({ kind: 'active', ids: selectedIds, label: 'Set active' })}
              className='rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60'
            >
              Set active
            </button>
            <button
              type='button'
              disabled={busyBulk}
              onClick={() => setBulkConfirm({ kind: 'draft', ids: selectedIds, label: 'Set draft' })}
              className='rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60'
            >
              Set draft
            </button>
            <button
              type='button'
              disabled={busyBulk}
              onClick={() => setBulkConfirm({ kind: 'archived', ids: selectedIds, label: 'Archive' })}
              className='rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60'
            >
              Archive
            </button>
            <button
              type='button'
              disabled={busyBulk}
              onClick={() => exportCsv(products.filter((p) => selectedIds.includes(p._id)))}
              className='rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60'
            >
              Export CSV
            </button>
            <button
              type='button'
              disabled={busyBulk}
              onClick={() => setBulkConfirm({ kind: 'delete', ids: selectedIds, label: 'Delete' })}
              className='rounded-xl border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60'
            >
              Delete
            </button>
            <button
              type='button'
              onClick={() => setSelectedIds([])}
              className='text-xs font-medium text-slate-500 hover:text-slate-800'
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={visibleProducts}
        rowKey='_id'
        loading={isLoading}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
        emptyTitle='No products match your filters'
        emptyDescription='Try clearing filters or refreshing the catalog.'
        onRowClick={(row) => navigate(`/products/${row._id}/edit`)}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={
          confirmDelete?.ids?.length === 1
            ? 'Delete this product?'
            : `Delete ${confirmDelete?.ids?.length || 0} products?`
        }
        description='You will have 8 seconds to undo from the toast notification.'
        confirmLabel='Delete'
        destructive
        onConfirm={onConfirmDelete}
        onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmDialog
        open={Boolean(bulkConfirm)}
        title={
          bulkConfirm?.kind === 'delete'
            ? `Delete ${bulkConfirm?.ids?.length || 0} products?`
            : `${bulkConfirm?.label} ${bulkConfirm?.ids?.length || 0} products?`
        }
        description={
          bulkConfirm?.kind === 'delete'
            ? 'You will have 8 seconds to undo from the toast.'
            : 'This will update the status for all selected products.'
        }
        confirmLabel={bulkConfirm?.label || 'Confirm'}
        destructive={bulkConfirm?.kind === 'delete' || bulkConfirm?.kind === 'archived'}
        busy={busyBulk}
        onConfirm={onConfirmBulk}
        onCancel={() => setBulkConfirm(null)}
      />
    </div>
  );
};

export default List;
