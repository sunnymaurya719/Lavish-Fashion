import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';

const formatDate = (value) => {
  if (!value) {
    return 'Not scheduled';
  }

  return new Date(value).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const toDateTimeLocalValue = (value) => {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const createEmptyFormState = () => ({
  name: '',
  campaignType: 'broadcast',
  audience: 'subscribed_users',
  automationTrigger: 'manual',
  subject: '',
  previewText: '',
  body: '',
  status: 'draft',
  sendAt: '',
});

const buildFormStateFromCampaign = (campaign) => ({
  name: campaign.name || '',
  campaignType: campaign.campaignType || 'broadcast',
  audience: campaign.audience || 'subscribed_users',
  automationTrigger: campaign.automationTrigger || 'manual',
  subject: campaign.subject || '',
  previewText: campaign.previewText || '',
  body: campaign.body || '',
  status: campaign.status || 'draft',
  sendAt: toDateTimeLocalValue(campaign.sendAt),
});

const Marketing = ({ token }) => {
  const [campaigns, setCampaigns] = useState([]);
  const [activity, setActivity] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [deliveryConfig, setDeliveryConfig] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [formMode, setFormMode] = useState('create');
  const [formData, setFormData] = useState(createEmptyFormState());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [statusLoadingId, setStatusLoadingId] = useState('');
  const [dispatchLoadingId, setDispatchLoadingId] = useState('');

  const fetchMarketingOverview = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await axios.get(BACKEND_URL + '/api/marketing/admin', {
        headers: { token },
      });

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to fetch marketing overview');
        return;
      }

      setCampaigns(response.data.campaigns || []);
      setActivity(response.data.activity || []);
      setMetrics(response.data.metrics || null);
      setDeliveryConfig(response.data.deliveryConfig || null);
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchMarketingOverview();
  }, [fetchMarketingOverview]);

  const visibleCampaigns = useMemo(() => {
    return campaigns.filter((campaign) => {
      const haystack = `${campaign.name} ${campaign.subject} ${campaign.audience}`.toLowerCase();
      const matchesSearch = haystack.includes(search.toLowerCase().trim());

      if (!matchesSearch) {
        return false;
      }

      if (statusFilter !== 'all' && campaign.status !== statusFilter) {
        return false;
      }

      return true;
    });
  }, [campaigns, search, statusFilter]);

  const summaryCards = useMemo(() => {
    if (!metrics) {
      return [];
    }

    return [
      {
        label: 'Total campaigns',
        value: metrics.totalCampaigns,
      },
      {
        label: 'Active campaigns',
        value: metrics.activeCampaigns,
      },
      {
        label: 'Emails sent',
        value: metrics.emailsSent,
      },
      {
        label: 'Emails failed',
        value: metrics.emailsFailed,
      },
      {
        label: 'Automation events',
        value: metrics.automationEvents,
      },
    ];
  }, [metrics]);

  const resetForm = () => {
    setSelectedCampaignId('');
    setFormMode('create');
    setFormData(createEmptyFormState());
  };

  const setEditingCampaign = (campaign) => {
    setSelectedCampaignId(campaign._id);
    setFormMode('edit');
    setFormData(buildFormStateFromCampaign(campaign));
  };

  const saveCampaign = async (event) => {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    setIsSaving(true);

    try {
      const endpoint = formMode === 'edit' ? '/api/marketing/admin/update' : '/api/marketing/admin/create';
      const method = formMode === 'edit' ? 'put' : 'post';
      const payload = {
        ...formData,
        sendAt: formData.sendAt || null,
        ...(formMode === 'edit' ? { campaignId: selectedCampaignId } : {}),
      };

      const response = await axios[method](BACKEND_URL + endpoint, payload, {
        headers: { token },
      });

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to save campaign');
        return;
      }

      toast.success(response.data.message || 'Campaign saved');
      await fetchMarketingOverview();
      resetForm();
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const updateCampaignStatus = async (campaign, nextStatus) => {
    setStatusLoadingId(campaign._id);

    try {
      const response = await axios.patch(
        BACKEND_URL + '/api/marketing/admin/status',
        { campaignId: campaign._id, status: nextStatus },
        { headers: { token } }
      );

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to update campaign status');
        return;
      }

      toast.success(response.data.message || 'Campaign status updated');
      await fetchMarketingOverview();
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setStatusLoadingId('');
    }
  };

  const dispatchCampaign = async (campaignId) => {
    setDispatchLoadingId(campaignId);

    try {
      const response = await axios.post(
        BACKEND_URL + '/api/marketing/admin/dispatch',
        { campaignId },
        { headers: { token } }
      );

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to dispatch campaign');
        return;
      }

      toast.success(response.data.message || 'Campaign dispatched');
      await fetchMarketingOverview();
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setDispatchLoadingId('');
    }
  };

  return (
    <div className='flex flex-col gap-6'>
      <section className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
        <div className='flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between'>
          <div>
            <p className='text-lg font-semibold text-slate-900'>Lifecycle marketing and campaign control</p>
            <p className='text-sm text-slate-500'>
              Build broadcasts, manage automation templates, and monitor the latest email delivery activity.
            </p>
            {deliveryConfig ? (
              <div className='mt-3 flex flex-wrap gap-2'>
                <span className='rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-700'>
                  Mode {deliveryConfig.mode}
                </span>
                <span className='rounded-full bg-sky-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-sky-700'>
                  Provider {deliveryConfig.provider}
                </span>
              </div>
            ) : null}
          </div>

          <div className='flex flex-wrap gap-3'>
            <button
              type='button'
              onClick={fetchMarketingOverview}
              className='rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700'
            >
              Refresh marketing
            </button>
            <button
              type='button'
              onClick={resetForm}
              className='rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white'
            >
              New campaign
            </button>
          </div>
        </div>
      </section>

      <section className='grid gap-4 md:grid-cols-2 xl:grid-cols-5'>
        {summaryCards.map((card) => (
          <article key={card.label} className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
            <p className='text-sm text-slate-500'>{card.label}</p>
            <p className='mt-3 text-3xl font-semibold text-slate-900'>{card.value}</p>
          </article>
        ))}
      </section>

      <section className='grid gap-6 xl:grid-cols-[0.95fr_1.05fr]'>
        <form onSubmit={saveCampaign} className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='flex items-center justify-between gap-4'>
            <div>
              <p className='text-lg font-semibold text-slate-900'>
                {formMode === 'edit' ? 'Edit campaign' : 'Create campaign'}
              </p>
              <p className='text-sm text-slate-500'>Changes here are saved directly to the marketing API.</p>
            </div>

            {formMode === 'edit' ? (
              <button
                type='button'
                onClick={resetForm}
                className='rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700'
              >
                Cancel edit
              </button>
            ) : null}
          </div>

          <div className='mt-5 grid gap-4'>
            <div>
              <p className='mb-2 text-sm text-slate-600'>Campaign name</p>
              <input
                value={formData.name}
                onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))}
                className='w-full rounded-2xl border border-slate-300 px-4 py-3'
                type='text'
                placeholder='Spring loyalty booster'
                required
              />
            </div>

            <div className='grid gap-4 lg:grid-cols-2'>
              <div>
                <p className='mb-2 text-sm text-slate-600'>Campaign type</p>
                <select
                  value={formData.campaignType}
                  onChange={(event) => setFormData((current) => ({ ...current, campaignType: event.target.value }))}
                  className='w-full rounded-2xl border border-slate-300 bg-white px-4 py-3'
                >
                  <option value='broadcast'>Broadcast</option>
                  <option value='automation'>Automation</option>
                </select>
              </div>

              <div>
                <p className='mb-2 text-sm text-slate-600'>Audience</p>
                <select
                  value={formData.audience}
                  onChange={(event) => setFormData((current) => ({ ...current, audience: event.target.value }))}
                  className='w-full rounded-2xl border border-slate-300 bg-white px-4 py-3'
                >
                  <option value='subscribed_users'>Subscribed users</option>
                  <option value='all_users'>All users</option>
                  <option value='loyalty_members'>Loyalty members</option>
                  <option value='recent_customers'>Recent customers</option>
                </select>
              </div>
            </div>

            <div className='grid gap-4 lg:grid-cols-2'>
              <div>
                <p className='mb-2 text-sm text-slate-600'>Automation trigger</p>
                <select
                  value={formData.automationTrigger}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, automationTrigger: event.target.value }))
                  }
                  className='w-full rounded-2xl border border-slate-300 bg-white px-4 py-3'
                >
                  <option value='manual'>Manual</option>
                  <option value='user_registered'>User registered</option>
                  <option value='order_delivered'>Order delivered</option>
                  <option value='review_published'>Review published</option>
                  <option value='points_milestone'>Points milestone</option>
                </select>
              </div>

              <div>
                <p className='mb-2 text-sm text-slate-600'>Status</p>
                <select
                  value={formData.status}
                  onChange={(event) => setFormData((current) => ({ ...current, status: event.target.value }))}
                  className='w-full rounded-2xl border border-slate-300 bg-white px-4 py-3'
                >
                  <option value='draft'>Draft</option>
                  <option value='scheduled'>Scheduled</option>
                  <option value='active'>Active</option>
                  <option value='paused'>Paused</option>
                </select>
              </div>
            </div>

            <div>
              <p className='mb-2 text-sm text-slate-600'>Subject line</p>
              <input
                value={formData.subject}
                onChange={(event) => setFormData((current) => ({ ...current, subject: event.target.value }))}
                className='w-full rounded-2xl border border-slate-300 px-4 py-3'
                type='text'
                placeholder='Your next Lavish Fashion reward is ready'
                required
              />
            </div>

            <div>
              <p className='mb-2 text-sm text-slate-600'>Preview text</p>
              <input
                value={formData.previewText}
                onChange={(event) => setFormData((current) => ({ ...current, previewText: event.target.value }))}
                className='w-full rounded-2xl border border-slate-300 px-4 py-3'
                type='text'
                placeholder='Short preheader copy for inbox previews'
              />
            </div>

            <div>
              <p className='mb-2 text-sm text-slate-600'>Message body</p>
              <textarea
                value={formData.body}
                onChange={(event) => setFormData((current) => ({ ...current, body: event.target.value }))}
                className='min-h-44 w-full rounded-2xl border border-slate-300 px-4 py-3'
                placeholder='Use placeholders like {{name}}, {{referralCode}}, and {{loyaltyPoints}} for personalized copy.'
                required
              />
            </div>

            <div>
              <p className='mb-2 text-sm text-slate-600'>Scheduled send</p>
              <input
                value={formData.sendAt}
                onChange={(event) => setFormData((current) => ({ ...current, sendAt: event.target.value }))}
                className='w-full rounded-2xl border border-slate-300 px-4 py-3'
                type='datetime-local'
              />
            </div>
          </div>

          <button
            type='submit'
            disabled={isSaving}
            className='mt-6 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white disabled:opacity-60'
          >
            {isSaving ? 'Saving campaign...' : formMode === 'edit' ? 'Update campaign' : 'Create campaign'}
          </button>
        </form>

        <div className='space-y-6'>
          <div className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
            <div className='grid gap-3 lg:grid-cols-[1.35fr_0.8fr]'>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className='rounded-2xl border border-slate-300 px-4 py-3'
                type='text'
                placeholder='Search by name, subject, or audience'
              />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className='rounded-2xl border border-slate-300 bg-white px-4 py-3'
              >
                <option value='all'>All statuses</option>
                <option value='draft'>Draft</option>
                <option value='scheduled'>Scheduled</option>
                <option value='active'>Active</option>
                <option value='paused'>Paused</option>
                <option value='sent'>Sent</option>
              </select>
            </div>

            <div className='mt-5 space-y-4'>
              {isLoading ? (
                <div className='ui-loading-state'>Loading campaigns...</div>
              ) : visibleCampaigns.length === 0 ? (
                <div className='rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500'>
                  No campaigns matched the current filters.
                </div>
              ) : (
                visibleCampaigns.map((campaign) => {
                  const isEditing = selectedCampaignId === campaign._id;
                  const nextStatus = campaign.status === 'active' ? 'paused' : 'active';

                  return (
                    <article
                      key={campaign._id}
                      className={`rounded-[28px] border p-5 shadow-sm transition ${
                        isEditing ? 'border-slate-900 bg-slate-950 text-white' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
                        <div>
                          <div className='flex flex-wrap items-center gap-2'>
                            <p className={`text-xl font-semibold ${isEditing ? 'text-white' : 'text-slate-900'}`}>
                              {campaign.name}
                            </p>
                            <span
                              className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${
                                isEditing ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {campaign.status}
                            </span>
                          </div>
                          <p className={`mt-2 text-sm ${isEditing ? 'text-slate-300' : 'text-slate-500'}`}>
                            {campaign.subject}
                          </p>
                        </div>

                        <div className='flex flex-wrap gap-3'>
                          <button
                            type='button'
                            onClick={() => setEditingCampaign(campaign)}
                            className={`rounded-2xl px-4 py-3 text-sm font-medium ${
                              isEditing ? 'bg-white text-slate-950' : 'bg-slate-950 text-white'
                            }`}
                          >
                            Edit
                          </button>
                          <button
                            type='button'
                            onClick={() => updateCampaignStatus(campaign, nextStatus)}
                            disabled={statusLoadingId === campaign._id || campaign.status === 'sent'}
                            className={`rounded-2xl border px-4 py-3 text-sm font-medium ${
                              isEditing ? 'border-white/20 text-white' : 'border-slate-300 text-slate-700'
                            } disabled:opacity-50`}
                          >
                            {statusLoadingId === campaign._id
                              ? 'Updating...'
                              : campaign.status === 'active'
                                ? 'Pause'
                                : campaign.status === 'sent'
                                  ? 'Sent'
                                  : 'Activate'}
                          </button>
                          {campaign.campaignType === 'broadcast' ? (
                            <button
                              type='button'
                              onClick={() => dispatchCampaign(campaign._id)}
                              disabled={dispatchLoadingId === campaign._id}
                              className={`rounded-2xl border px-4 py-3 text-sm font-medium ${
                                isEditing ? 'border-white/20 text-white' : 'border-slate-300 text-slate-700'
                              } disabled:opacity-50`}
                            >
                              {dispatchLoadingId === campaign._id ? 'Dispatching...' : 'Dispatch'}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div className='mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
                        <div className={`rounded-2xl px-4 py-3 ${isEditing ? 'bg-white/8' : 'bg-slate-50'}`}>
                          <p className={`text-xs uppercase tracking-[0.2em] ${isEditing ? 'text-slate-300' : 'text-slate-400'}`}>Type</p>
                          <p className={`mt-2 font-semibold ${isEditing ? 'text-white' : 'text-slate-900'}`}>
                            {campaign.campaignType}
                          </p>
                        </div>
                        <div className={`rounded-2xl px-4 py-3 ${isEditing ? 'bg-white/8' : 'bg-slate-50'}`}>
                          <p className={`text-xs uppercase tracking-[0.2em] ${isEditing ? 'text-slate-300' : 'text-slate-400'}`}>Audience</p>
                          <p className={`mt-2 font-semibold ${isEditing ? 'text-white' : 'text-slate-900'}`}>
                            {campaign.audience.replaceAll('_', ' ')}
                          </p>
                        </div>
                        <div className={`rounded-2xl px-4 py-3 ${isEditing ? 'bg-white/8' : 'bg-slate-50'}`}>
                          <p className={`text-xs uppercase tracking-[0.2em] ${isEditing ? 'text-slate-300' : 'text-slate-400'}`}>Sent</p>
                          <p className={`mt-2 font-semibold ${isEditing ? 'text-white' : 'text-slate-900'}`}>
                            {campaign.sentCount || 0}
                          </p>
                        </div>
                        <div className={`rounded-2xl px-4 py-3 ${isEditing ? 'bg-white/8' : 'bg-slate-50'}`}>
                          <p className={`text-xs uppercase tracking-[0.2em] ${isEditing ? 'text-slate-300' : 'text-slate-400'}`}>Scheduled</p>
                          <p className={`mt-2 font-semibold ${isEditing ? 'text-white' : 'text-slate-900'}`}>
                            {formatDate(campaign.sendAt)}
                          </p>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>

          <div className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>
            <div className='mb-5'>
              <p className='text-lg font-semibold text-slate-900'>Recent email activity</p>
              <p className='text-sm text-slate-500'>Latest sends, skips, and automation-triggered messages.</p>
            </div>

            <div className='space-y-3'>
              {activity.length === 0 ? (
                <div className='rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500'>
                  Email activity will appear here after the first automation or dispatch.
                </div>
              ) : (
                activity.map((item) => {
                  const campaign = campaigns.find((campaignEntry) => campaignEntry._id === item.campaignId);

                  return (
                    <div key={item._id} className='rounded-[28px] border border-slate-200 p-4'>
                      <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
                        <div>
                          <p className='font-semibold text-slate-900'>{item.subject}</p>
                          <p className='mt-1 text-sm text-slate-500'>{item.email}</p>
                          <p className='mt-2 text-sm text-slate-600'>
                            {campaign?.name || item.automationKey?.replaceAll('_', ' ') || 'Campaign event'}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] ${
                            item.status === 'sent'
                              ? 'bg-emerald-50 text-emerald-700'
                              : item.status === 'failed'
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>
                      <p className='mt-3 text-xs uppercase tracking-[0.2em] text-slate-400'>
                        {formatDate(item.sentAt || item.createdAt)}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Marketing;
