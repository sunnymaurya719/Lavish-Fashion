import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  Money,
  PageHeader,
  StatusBadge,
  Tabs,
  formatDate,
  formatMoney,
} from '../components/ui';
import { useDebouncedValue, usePersistedState } from '../hooks';

const VIP_THRESHOLD = 5000;

const SEGMENT_TABS = [
  { id: 'all', label: 'All' },
  { id: 'buyers', label: 'Buyers' },
  { id: 'wishlist', label: 'Wishlist' },
  { id: 'vip', label: `VIP · ≥ ${formatMoney(VIP_THRESHOLD)}` },
];

const DETAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Orders' },
  { id: 'wishlist', label: 'Wishlist' },
];

// Simple copy helper that surfaces success/failure via toasts so support
// agents always know whether the clipboard write went through.
const copyToClipboard = async (value, label) => {
  if (!value) {
    toast.info(`No ${label} to copy`);
    return;
  }
  try {
    await navigator.clipboard.writeText(String(value));
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Could not copy ${label}`);
  }
};

const orderShortId = (id) => String(id || '').slice(-8).toUpperCase();

const Customers = ({ token }) => {
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerDetail, setCustomerDetail] = useState(null);

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const [segment, setSegment] = usePersistedState('admin.customers.segment', 'all');
  const [detailTab, setDetailTab] = usePersistedState('admin.customers.detailTab', 'overview');

  const [notesDraft, setNotesDraft] = useState('');
  const [savedNotes, setSavedNotes] = useState('');
  const [notesSavedAt, setNotesSavedAt] = useState(null);
  const [notesAutosaveStatus, setNotesAutosaveStatus] = useState('idle'); // idle | saving | saved | error

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  const notesAutosaveTimer = useRef(null);
  const lastSaveRequest = useRef(0);

  const fetchCustomers = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await axios.get(BACKEND_URL + '/api/customers', { headers: { token } });
      if (!response.data.success) {
        throw new Error(response.data.message || 'Failed to fetch customers');
      }
      setCustomers(response.data.customers || []);
    } catch (error) {
      setLoadError(error?.response?.data?.message || error.message || 'Failed to fetch customers');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  const fetchCustomerDetail = useCallback(
    async (customerId) => {
      if (!customerId) return;
      setSelectedCustomerId(customerId);
      setIsDetailLoading(true);
      try {
        const response = await axios.post(
          BACKEND_URL + '/api/customers/detail',
          { customerId },
          { headers: { token } }
        );
        if (!response.data.success) {
          throw new Error(response.data.message || 'Failed to fetch customer detail');
        }
        setCustomerDetail(response.data);
        const serverNotes = response.data.customer?.adminNotes || '';
        setNotesDraft(serverNotes);
        setSavedNotes(serverNotes);
        setNotesSavedAt(response.data.customer?.updatedAt || null);
        setNotesAutosaveStatus('idle');
      } catch (error) {
        toast.error(error?.response?.data?.message || error.message);
      } finally {
        setIsDetailLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const visibleCustomers = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    return customers.filter((customer) => {
      if (needle) {
        const haystack = `${customer.name || ''} ${customer.email || ''} ${customer.phone || ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (segment === 'buyers') return customer.ordersCount > 0;
      if (segment === 'wishlist') return customer.wishlistCount > 0;
      if (segment === 'vip') return Number(customer.totalSpent || 0) >= VIP_THRESHOLD;
      return true;
    });
  }, [customers, debouncedSearch, segment]);

  // Adopt the first visible customer when nothing is selected or the previous
  // selection has been filtered out.
  useEffect(() => {
    if (visibleCustomers.length === 0) {
      if (selectedCustomerId) {
        setSelectedCustomerId('');
        setCustomerDetail(null);
      }
      return;
    }
    if (!visibleCustomers.some((customer) => customer._id === selectedCustomerId)) {
      fetchCustomerDetail(visibleCustomers[0]._id);
    }
  }, [fetchCustomerDetail, selectedCustomerId, visibleCustomers]);

  const segmentCounts = useMemo(() => {
    const counts = { all: customers.length, buyers: 0, wishlist: 0, vip: 0 };
    customers.forEach((customer) => {
      if (customer.ordersCount > 0) counts.buyers += 1;
      if (customer.wishlistCount > 0) counts.wishlist += 1;
      if (Number(customer.totalSpent || 0) >= VIP_THRESHOLD) counts.vip += 1;
    });
    return counts;
  }, [customers]);

  const summaryCards = useMemo(
    () => [
      { label: 'Total customers', value: customers.length },
      {
        label: 'Ordering customers',
        value: segmentCounts.buyers,
        tone: 'success',
      },
      {
        label: 'Wishlist active',
        value: segmentCounts.wishlist,
        tone: 'info',
      },
      {
        label: 'Revenue tracked',
        value: formatMoney(
          customers.reduce((sum, customer) => sum + Number(customer.totalSpent || 0), 0)
        ),
      },
    ],
    [customers, segmentCounts]
  );

  // Persist notes via the existing PUT /api/customers/notes endpoint. We
  // serialize requests with a request counter so a stale response from a
  // slower request can never overwrite the result of a newer save.
  const persistNotes = useCallback(
    async (notesToSave, { silent } = {}) => {
      if (!selectedCustomerId) return;
      if (notesToSave === savedNotes) return;
      const requestId = lastSaveRequest.current + 1;
      lastSaveRequest.current = requestId;
      setNotesAutosaveStatus('saving');
      try {
        const response = await axios.put(
          BACKEND_URL + '/api/customers/notes',
          { customerId: selectedCustomerId, adminNotes: notesToSave },
          { headers: { token } }
        );
        if (!response.data.success) {
          throw new Error(response.data.message || 'Failed to save notes');
        }
        if (lastSaveRequest.current !== requestId) return;
        const persisted = response.data.customer?.adminNotes || '';
        setSavedNotes(persisted);
        setNotesSavedAt(response.data.customer?.updatedAt || new Date().toISOString());
        setNotesAutosaveStatus('saved');
        setCustomers((prev) =>
          prev.map((customer) =>
            customer._id === selectedCustomerId ? { ...customer, adminNotes: persisted } : customer
          )
        );
        setCustomerDetail((prev) =>
          prev
            ? { ...prev, customer: { ...prev.customer, adminNotes: persisted } }
            : prev
        );
        if (!silent) toast.success('Notes saved');
      } catch (error) {
        if (lastSaveRequest.current !== requestId) return;
        setNotesAutosaveStatus('error');
        toast.error(error?.response?.data?.message || error.message);
      }
    },
    [selectedCustomerId, savedNotes, token]
  );

  // Schedule autosave 1.5s after the agent stops typing.
  useEffect(() => {
    if (notesDraft === savedNotes) return undefined;
    if (!selectedCustomerId) return undefined;
    if (notesAutosaveTimer.current) clearTimeout(notesAutosaveTimer.current);
    notesAutosaveTimer.current = setTimeout(() => {
      persistNotes(notesDraft, { silent: true });
    }, 1500);
    return () => {
      if (notesAutosaveTimer.current) clearTimeout(notesAutosaveTimer.current);
    };
  }, [notesDraft, savedNotes, selectedCustomerId, persistNotes]);

  const lastOrder = customerDetail?.recentOrders?.[0];

  const detailHeader = customerDetail?.customer
    ? (
      <div className='space-y-3'>
        {/* Row 1: Name + quick actions */}
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <h2 className='truncate text-lg font-semibold text-slate-900'>{customerDetail.customer.name}</h2>
              {Number(customerDetail.customer.totalSpent || 0) >= VIP_THRESHOLD && (
                <span className='shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700'>VIP</span>
              )}
            </div>
            <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500'>
              <button type='button' onClick={() => copyToClipboard(customerDetail.customer.email, 'Email')} className='font-mono text-[12px] hover:text-slate-800 hover:underline' title='Click to copy email'>{customerDetail.customer.email}</button>
              <span>·</span>
              <button type='button' onClick={() => copyToClipboard(customerDetail.customer.phone, 'Phone')} className='hover:text-slate-800 hover:underline' title='Click to copy phone' disabled={!customerDetail.customer.phone}>{customerDetail.customer.phone || 'No phone'}</button>
              <span>·</span>
              <span>Joined {formatDate(customerDetail.customer.createdAt)}</span>
            </div>
          </div>
          <div className='flex shrink-0 items-center gap-1.5'>
            {lastOrder && (
              <Link
                to='/orders'
                state={{ focusOrderId: lastOrder._id }}
                className='rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50'
              >
                Last order
              </Link>
            )}
            <Link
              to='/loyalty'
              state={{ focusCustomerId: customerDetail.customer._id }}
              className='rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50'
            >
              Loyalty
            </Link>
          </div>
        </div>

        {/* Row 2: Compact stat chips */}
        <div className='flex flex-wrap gap-2'>
          <span className='rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700'>
            <Money value={customerDetail.customer.totalSpent} /> spent
          </span>
          <span className='rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700'>
            {customerDetail.customer.ordersCount ?? 0} orders
          </span>
          <span className='rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700'>
            {customerDetail.customer.wishlistCount ?? 0} wishlist
          </span>
          {customerDetail.customer.lastOrderDate && (
            <span className='rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700'>
              Last order {formatDate(customerDetail.customer.lastOrderDate)}
            </span>
          )}
        </div>
      </div>
    )
    : null;

  const renderOverview = () => (
    <div className='space-y-4'>
      {/* Admin notes — moved to top since this is what agents need first */}
      <section className='rounded-xl border border-slate-200 bg-slate-50 p-4'>
        <div className='flex items-center justify-between gap-3'>
          <p className='text-sm font-semibold text-slate-700'>Admin notes</p>
          <span className='text-[11px] text-slate-400'>
            {notesAutosaveStatus === 'saving'
              ? 'Saving…'
              : notesAutosaveStatus === 'error'
                ? 'Save failed'
                : notesDraft !== savedNotes
                  ? 'Unsaved'
                  : notesSavedAt
                    ? `Saved ${formatDate(notesSavedAt)}`
                    : ''}
          </span>
        </div>
        <textarea
          value={notesDraft}
          onChange={(event) => setNotesDraft(event.target.value)}
          className='mt-2 min-h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm ui-focus-ring'
          placeholder='VIP preferences, support history, retention context…'
          maxLength={1000}
        />
        <div className='mt-2 flex items-center justify-end gap-2'>
          <button
            type='button'
            onClick={() => setNotesDraft(savedNotes)}
            disabled={notesDraft === savedNotes}
            className='rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40'
          >
            Discard
          </button>
          <button
            type='button'
            onClick={() => persistNotes(notesDraft)}
            disabled={notesDraft === savedNotes || notesAutosaveStatus === 'saving'}
            className='rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40'
          >
            {notesAutosaveStatus === 'saving' ? 'Saving…' : 'Save now'}
          </button>
        </div>
      </section>

      {/* Stats grid */}
      <div className='grid grid-cols-3 gap-3'>
        <div className='rounded-xl border border-slate-200 bg-white p-3 text-center'>
          <p className='text-lg font-semibold text-slate-900 tabular-nums'>{customerDetail.customer.paidOrdersCount ?? 0}</p>
          <p className='text-[11px] text-slate-500'>Paid orders</p>
        </div>
        <div className='rounded-xl border border-slate-200 bg-white p-3 text-center'>
          <p className='text-lg font-semibold text-slate-900 tabular-nums'><Money value={customerDetail.customer.totalSpent} /></p>
          <p className='text-[11px] text-slate-500'>Total spent</p>
        </div>
        <div className='rounded-xl border border-slate-200 bg-white p-3 text-center'>
          <p className='text-lg font-semibold text-slate-900 tabular-nums'>{customerDetail.customer.wishlistCount ?? 0}</p>
          <p className='text-[11px] text-slate-500'>Wishlist</p>
        </div>
      </div>
    </div>
  );

  const renderOrders = () => {
    const orders = customerDetail?.recentOrders || [];
    if (orders.length === 0) {
      return (
        <EmptyState
          title='No orders yet'
          description='This customer has not placed an order. They may still be browsing or saving items to their wishlist.'
        />
      );
    }
    return (
      <div className='space-y-3'>
        {orders.map((order) => (
          <article
            key={order._id}
            className='rounded-2xl border border-slate-200 bg-white p-4 shadow-sm'
          >
            <div className='flex items-start justify-between gap-3'>
              <div>
                <p className='font-semibold text-slate-900'>#{orderShortId(order._id)}</p>
                <p className='mt-0.5 text-xs text-slate-500'>{formatDate(order.date)}</p>
              </div>
              <StatusBadge status={order.status} size='sm' />
            </div>
            <div className='mt-3 grid grid-cols-3 gap-3 text-sm'>
              <div>
                <p className='text-xs uppercase tracking-[0.18em] text-slate-400'>Amount</p>
                <p className='mt-1 font-semibold text-slate-900'>
                  <Money value={order.amount} />
                </p>
              </div>
              <div>
                <p className='text-xs uppercase tracking-[0.18em] text-slate-400'>Payment</p>
                <p className='mt-1 font-medium text-slate-700'>{order.paymentMethod}</p>
              </div>
              <div>
                <p className='text-xs uppercase tracking-[0.18em] text-slate-400'>Items</p>
                <p className='mt-1 font-medium text-slate-700'>{order.items?.length || 0}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  };

  const renderWishlist = () => {
    const products = customerDetail?.wishlistProducts || [];
    if (products.length === 0) {
      return (
        <EmptyState
          title='No saved products'
          description='This customer does not currently have items on their wishlist.'
        />
      );
    }
    return (
      <div className='space-y-3'>
        {products.map((product) => (
          <article
            key={product._id}
            className='flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm'
          >
            <img
              src={product.image?.[0]}
              alt={product.name}
              className='h-20 w-16 rounded-2xl border border-slate-200 object-cover'
              loading='lazy'
            />
            <div className='min-w-0 flex-1'>
              <p className='font-medium text-slate-900'>{product.name}</p>
              <p className='mt-0.5 text-sm text-slate-500'>
                {product.category} · {product.subCategory}
              </p>
              <div className='mt-2 flex items-center justify-between gap-3'>
                <p className='font-semibold text-slate-900'>
                  <Money value={product.price} />
                </p>
                <StatusBadge status={product.status} size='sm' />
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  };

  return (
    <div className='flex flex-col gap-6'>
      <PageHeader
        eyebrow='People'
        title='Customer operating system'
        description='Resolve any support ticket against a customer in one screen — orders, wishlist, notes, and quick actions.'
        actions={
          <button
            type='button'
            onClick={fetchCustomers}
            className='rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 ui-focus-ring'
          >
            Refresh
          </button>
        }
      />

      {/* Compact inline metrics */}
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
        {summaryCards.map((card) => (
          <MetricCard key={card.label} label={card.label} value={card.value} tone={card.tone} />
        ))}
      </div>

      {/* Search + Segment tabs in a single row */}
      <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
        <Tabs
          tabs={SEGMENT_TABS.map((tab) => ({ ...tab, count: segmentCounts[tab.id] || 0 }))}
          value={segment}
          onChange={setSegment}
        />
        <div className='relative w-full max-w-xs'>
          <span className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400'>
            <svg width='14' height='14' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
              <path d='M10.5 3a7.5 7.5 0 1 0 4.55 13.43l4.51 4.51 1.41-1.41-4.5-4.51A7.5 7.5 0 0 0 10.5 3Zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z' fill='currentColor' />
            </svg>
          </span>
          <input
            type='search'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Search name, email, phone…'
            className='w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400'
          />
        </div>
      </div>

      <section className='grid gap-5 xl:grid-cols-[340px_1fr]' style={{ height: 'calc(100vh - 280px)', minHeight: '480px' }}>
        {/* List pane — independently scrollable */}
        <div className='flex flex-col gap-1.5 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm'>
          {isLoading ? (
            <LoadingState variant='list' rows={6} />
          ) : loadError ? (
            <ErrorState description={loadError} onRetry={fetchCustomers} />
          ) : visibleCustomers.length === 0 ? (
            <EmptyState
              title='No customers matched'
              description='Try a different search or switch segment.'
            />
          ) : (
            visibleCustomers.map((customer) => {
              const isActive = customer._id === selectedCustomerId;
              const isVip = Number(customer.totalSpent || 0) >= VIP_THRESHOLD;
              return (
                <button
                  key={customer._id}
                  type='button'
                  onClick={() => fetchCustomerDetail(customer._id)}
                  className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                    isActive
                      ? 'bg-slate-900 text-white shadow-md'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className='flex items-center justify-between gap-2'>
                    <div className='min-w-0 flex-1'>
                      <div className='flex items-center gap-2'>
                        <p className={`truncate text-sm font-semibold ${isActive ? 'text-white' : 'text-slate-900'}`}>
                          {customer.name}
                        </p>
                        {isVip && (
                          <span className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold leading-none ${isActive ? 'bg-amber-400/20 text-amber-300' : 'bg-amber-50 text-amber-700'}`}>VIP</span>
                        )}
                      </div>
                      <p className={`truncate text-xs ${isActive ? 'text-slate-400' : 'text-slate-500'}`}>
                        {customer.email}
                      </p>
                    </div>
                    <div className='shrink-0 text-right'>
                      <p className={`text-sm font-semibold tabular-nums ${isActive ? 'text-white' : 'text-slate-900'}`}>
                        <Money value={customer.totalSpent} />
                      </p>
                      <p className={`text-[10px] tabular-nums ${isActive ? 'text-slate-400' : 'text-slate-400'}`}>
                        {customer.ordersCount} orders
                      </p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Detail pane — independently scrollable */}
        <div className='overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'>
          {isDetailLoading ? (
            <LoadingState variant='card' />
          ) : !customerDetail?.customer ? (
            <EmptyState
              title='Select a customer'
              description='Pick a customer from the list to see their full profile.'
            />
          ) : (
            <div className='space-y-4'>
              {detailHeader}
              <Tabs tabs={DETAIL_TABS} value={detailTab} onChange={setDetailTab} />
              {detailTab === 'overview' && renderOverview()}
              {detailTab === 'orders' && renderOrders()}
              {detailTab === 'wishlist' && renderWishlist()}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default Customers;
