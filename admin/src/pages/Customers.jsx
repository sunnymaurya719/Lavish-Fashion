import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
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
    return 'Not yet';
  }

  return new Date(value).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const truncateText = (value, limit = 100) => {
  const text = String(value || '').trim();

  if (!text) {
    return 'No internal notes yet.';
  }

  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit).trim()}...`;
};

const Customers = ({ token }) => {
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerDetail, setCustomerDetail] = useState(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  const fetchCustomers = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await axios.get(BACKEND_URL + '/api/customers', {
        headers: { token },
      });

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to fetch customers');
        return;
      }

      setCustomers(response.data.customers || []);
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  const fetchCustomerDetail = useCallback(
    async (customerId) => {
      if (!customerId) {
        return;
      }

      setSelectedCustomerId(customerId);
      setIsDetailLoading(true);

      try {
        const response = await axios.post(
          BACKEND_URL + '/api/customers/detail',
          { customerId },
          { headers: { token } }
        );

        if (!response.data.success) {
          toast.error(response.data.message || 'Failed to fetch customer detail');
          return;
        }

        setCustomerDetail(response.data);
        setNotesDraft(response.data.customer?.adminNotes || '');
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
    return customers.filter((customer) => {
      const haystack = `${customer.name} ${customer.email} ${customer.phone}`.toLowerCase();
      const matchesSearch = haystack.includes(search.toLowerCase().trim());

      if (!matchesSearch) {
        return false;
      }

      if (segment === 'buyers') {
        return customer.ordersCount > 0;
      }

      if (segment === 'wishlist') {
        return customer.wishlistCount > 0;
      }

      if (segment === 'vip') {
        return Number(customer.totalSpent || 0) >= 5000;
      }

      return true;
    });
  }, [customers, search, segment]);

  useEffect(() => {
    if (visibleCustomers.length === 0) {
      setSelectedCustomerId('');
      setCustomerDetail(null);
      setNotesDraft('');
      return;
    }

    if (!visibleCustomers.some((customer) => customer._id === selectedCustomerId)) {
      fetchCustomerDetail(visibleCustomers[0]._id);
    }
  }, [fetchCustomerDetail, selectedCustomerId, visibleCustomers]);

  const summaryCards = useMemo(() => {
    return [
      {
        label: 'Total customers',
        value: customers.length,
        tone: 'text-slate-900',
      },
      {
        label: 'Ordering customers',
        value: customers.filter((customer) => customer.ordersCount > 0).length,
        tone: 'text-emerald-700',
      },
      {
        label: 'Wishlist active',
        value: customers.filter((customer) => customer.wishlistCount > 0).length,
        tone: 'text-sky-700',
      },
      {
        label: 'Revenue tracked',
        value: formatCurrency(customers.reduce((sum, customer) => sum + Number(customer.totalSpent || 0), 0)),
        tone: 'text-slate-900',
      },
    ];
  }, [customers]);

  const saveNotes = async () => {
    if (!selectedCustomerId) {
      return;
    }

    setIsSavingNotes(true);

    try {
      const response = await axios.put(
        BACKEND_URL + '/api/customers/notes',
        { customerId: selectedCustomerId, adminNotes: notesDraft },
        { headers: { token } }
      );

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to save notes');
        return;
      }

      setCustomers((currentCustomers) =>
        currentCustomers.map((customer) =>
          customer._id === selectedCustomerId ? { ...customer, adminNotes: response.data.customer.adminNotes } : customer
        )
      );
      setCustomerDetail((currentDetail) =>
        currentDetail
          ? {
              ...currentDetail,
              customer: {
                ...currentDetail.customer,
                adminNotes: response.data.customer.adminNotes,
              },
            }
          : currentDetail
      );
      toast.success('Customer notes updated');
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsSavingNotes(false);
    }
  };

  return (
    <div className='flex flex-col gap-6'>
      <section className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
        <div className='flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between'>
          <div>
            <p className='text-lg font-semibold text-slate-900'>Customer operating system</p>
            <p className='text-sm text-slate-500'>
              Review account health, order history, wishlist intent, and private admin notes from one server-backed view.
            </p>
          </div>

          <button
            type='button'
            onClick={fetchCustomers}
            className='rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700'
          >
            Refresh customers
          </button>
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

      <section className='grid gap-6 xl:grid-cols-[0.95fr_1.35fr]'>
        <div className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='grid gap-3 lg:grid-cols-[1.35fr_0.8fr]'>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className='rounded-2xl border border-slate-300 px-4 py-3'
              type='text'
              placeholder='Search by name, email, or phone'
            />
            <select
              value={segment}
              onChange={(event) => setSegment(event.target.value)}
              className='rounded-2xl border border-slate-300 bg-white px-4 py-3'
            >
              <option value='all'>All customers</option>
              <option value='buyers'>Buyers</option>
              <option value='wishlist'>Wishlist active</option>
              <option value='vip'>VIP value</option>
            </select>
          </div>

          <div className='mt-5 space-y-3'>
            {isLoading ? (
              <div className='ui-loading-state'>Loading customers...</div>
            ) : visibleCustomers.length === 0 ? (
              <div className='rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500'>
                No customers matched the current filters.
              </div>
            ) : (
              visibleCustomers.map((customer) => {
                const isActive = customer._id === selectedCustomerId;

                return (
                  <button
                    key={customer._id}
                    type='button'
                    onClick={() => fetchCustomerDetail(customer._id)}
                    className={`w-full rounded-3xl border p-4 text-left transition ${
                      isActive ? 'border-slate-900 bg-slate-950 text-white shadow-lg' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className='flex items-start justify-between gap-4'>
                      <div>
                        <p className={`font-semibold ${isActive ? 'text-white' : 'text-slate-900'}`}>{customer.name}</p>
                        <p className={`text-sm ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>{customer.email}</p>
                        <p className='mt-1 text-xs uppercase tracking-[0.2em] text-slate-400'>
                          Joined {formatDate(customer.createdAt)}
                        </p>
                      </div>
                      <div className={`rounded-2xl px-3 py-2 text-right ${isActive ? 'bg-white/10' : 'bg-slate-50'}`}>
                        <p className={`text-xs uppercase tracking-[0.2em] ${isActive ? 'text-slate-300' : 'text-slate-400'}`}>Spent</p>
                        <p className={`mt-1 text-sm font-semibold ${isActive ? 'text-white' : 'text-slate-900'}`}>
                          {formatCurrency(customer.totalSpent)}
                        </p>
                      </div>
                    </div>

                    <div className='mt-4 grid grid-cols-3 gap-3'>
                      <div className={`rounded-2xl px-3 py-3 ${isActive ? 'bg-white/8' : 'bg-slate-50'}`}>
                        <p className={`text-xs uppercase tracking-[0.2em] ${isActive ? 'text-slate-300' : 'text-slate-400'}`}>Orders</p>
                        <p className={`mt-2 text-lg font-semibold ${isActive ? 'text-white' : 'text-slate-900'}`}>
                          {customer.ordersCount}
                        </p>
                      </div>
                      <div className={`rounded-2xl px-3 py-3 ${isActive ? 'bg-white/8' : 'bg-slate-50'}`}>
                        <p className={`text-xs uppercase tracking-[0.2em] ${isActive ? 'text-slate-300' : 'text-slate-400'}`}>Wishlist</p>
                        <p className={`mt-2 text-lg font-semibold ${isActive ? 'text-white' : 'text-slate-900'}`}>
                          {customer.wishlistCount}
                        </p>
                      </div>
                      <div className={`rounded-2xl px-3 py-3 ${isActive ? 'bg-white/8' : 'bg-slate-50'}`}>
                        <p className={`text-xs uppercase tracking-[0.2em] ${isActive ? 'text-slate-300' : 'text-slate-400'}`}>Last order</p>
                        <p className={`mt-2 text-sm font-semibold ${isActive ? 'text-white' : 'text-slate-900'}`}>
                          {formatDate(customer.lastOrderDate)}
                        </p>
                      </div>
                    </div>

                    <p className={`mt-4 text-sm leading-6 ${isActive ? 'text-slate-200' : 'text-slate-500'}`}>
                      {truncateText(customer.adminNotes)}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          {isDetailLoading ? (
            <div className='ui-loading-state'>Loading customer detail...</div>
          ) : !customerDetail?.customer ? (
            <div className='rounded-2xl bg-slate-50 px-4 py-8 text-sm text-slate-500'>
              Select a customer to inspect account details.
            </div>
          ) : (
            <div className='space-y-6'>
              <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
                <div>
                  <p className='text-2xl font-semibold text-slate-900'>{customerDetail.customer.name}</p>
                  <p className='mt-2 text-sm text-slate-500'>{customerDetail.customer.email}</p>
                  <p className='mt-1 text-sm text-slate-500'>
                    {customerDetail.customer.phone || 'No phone number on file'}
                  </p>
                </div>
                <div className='grid grid-cols-2 gap-3 sm:min-w-[320px]'>
                  <div className='rounded-2xl bg-slate-50 px-4 py-3'>
                    <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Total spent</p>
                    <p className='mt-2 text-lg font-semibold text-slate-900'>
                      {formatCurrency(customerDetail.customer.totalSpent)}
                    </p>
                  </div>
                  <div className='rounded-2xl bg-slate-50 px-4 py-3'>
                    <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Paid orders</p>
                    <p className='mt-2 text-lg font-semibold text-slate-900'>
                      {customerDetail.customer.paidOrdersCount}
                    </p>
                  </div>
                </div>
              </div>

              <section className='rounded-3xl border border-slate-200 bg-slate-50 p-5'>
                <div className='flex items-center justify-between gap-4'>
                  <div>
                    <p className='text-lg font-semibold text-slate-900'>Admin notes</p>
                    <p className='text-sm text-slate-500'>Keep internal context for support, retention, or VIP follow-up.</p>
                  </div>
                  <button
                    type='button'
                    onClick={saveNotes}
                    disabled={isSavingNotes}
                    className='rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white disabled:opacity-60'
                  >
                    {isSavingNotes ? 'Saving...' : 'Save notes'}
                  </button>
                </div>
                <textarea
                  value={notesDraft}
                  onChange={(event) => setNotesDraft(event.target.value)}
                  className='mt-4 min-h-32 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3'
                  placeholder='Add support history, VIP preferences, fraud notes, or retention context'
                  maxLength={1000}
                />
              </section>

              <section className='grid gap-6 xl:grid-cols-[1.05fr_0.95fr]'>
                <div className='rounded-3xl border border-slate-200 bg-slate-50 p-5'>
                  <div className='mb-4 flex items-center justify-between gap-4'>
                    <div>
                      <p className='text-lg font-semibold text-slate-900'>Recent orders</p>
                      <p className='text-sm text-slate-500'>Latest transaction history for this customer.</p>
                    </div>
                    <span className='rounded-full bg-white px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-slate-500'>
                      {customerDetail.recentOrders.length} tracked
                    </span>
                  </div>

                  {customerDetail.recentOrders.length === 0 ? (
                    <div className='rounded-2xl bg-white px-4 py-6 text-sm text-slate-500'>
                      This customer has not placed an order yet.
                    </div>
                  ) : (
                    <div className='space-y-3'>
                      {customerDetail.recentOrders.map((order) => (
                        <div key={order._id} className='rounded-2xl bg-white px-4 py-4'>
                          <div className='flex items-start justify-between gap-4'>
                            <div>
                              <p className='font-medium text-slate-900'>#{String(order._id).slice(-8).toUpperCase()}</p>
                              <p className='mt-1 text-sm text-slate-500'>{formatDate(order.date)}</p>
                            </div>
                            <span className='rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-700'>
                              {order.status}
                            </span>
                          </div>
                          <div className='mt-4 grid gap-3 sm:grid-cols-3'>
                            <div>
                              <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Amount</p>
                              <p className='mt-2 font-semibold text-slate-900'>{formatCurrency(order.amount)}</p>
                            </div>
                            <div>
                              <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Payment</p>
                              <p className='mt-2 font-semibold text-slate-900'>{order.paymentMethod}</p>
                            </div>
                            <div>
                              <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>Items</p>
                              <p className='mt-2 font-semibold text-slate-900'>{order.items?.length || 0}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className='rounded-3xl border border-slate-200 bg-slate-50 p-5'>
                  <div className='mb-4 flex items-center justify-between gap-4'>
                    <div>
                      <p className='text-lg font-semibold text-slate-900'>Wishlist intent</p>
                      <p className='text-sm text-slate-500'>Products this customer is still considering.</p>
                    </div>
                    <span className='rounded-full bg-white px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-slate-500'>
                      {customerDetail.wishlistProducts.length} saved
                    </span>
                  </div>

                  {customerDetail.wishlistProducts.length === 0 ? (
                    <div className='rounded-2xl bg-white px-4 py-6 text-sm text-slate-500'>
                      This customer does not currently have saved products.
                    </div>
                  ) : (
                    <div className='space-y-3'>
                      {customerDetail.wishlistProducts.map((product) => (
                        <div key={product._id} className='flex gap-4 rounded-2xl bg-white px-4 py-4'>
                          <img
                            src={product.image?.[0]}
                            alt={product.name}
                            className='h-20 w-16 rounded-2xl border border-slate-200 object-cover'
                          />
                          <div className='min-w-0 flex-1'>
                            <p className='font-medium text-slate-900'>{product.name}</p>
                            <p className='mt-1 text-sm text-slate-500'>
                              {product.category} / {product.subCategory}
                            </p>
                            <div className='mt-3 flex items-center justify-between gap-4'>
                              <p className='font-semibold text-slate-900'>{formatCurrency(product.price)}</p>
                              <span className='rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-700'>
                                {product.status}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default Customers;
