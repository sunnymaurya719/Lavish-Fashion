import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';
import {
  PageHeader,
  MetricGrid,
  MetricCard,
  Toolbar,
  Tabs,
  DataTable,
  ConfirmDialog,
  StatusBadge,
  Drawer,
  formatDate,
} from '../components/ui';
import {
  useAdminQuery,
  useDebouncedValue,
  usePersistedState,
} from '../hooks';

/* ── helpers ───────────────────────────────────────────── */

const toDateTimeLocalValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

/* shared field styles */
const inputCls = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10 transition';
const selectCls = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10 transition';
const labelCls = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500';

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

const STATUS_TAB_IDS = ['all', 'draft', 'scheduled', 'active', 'paused', 'sent'];

const AUDIENCE_LABELS = {
  subscribed_users: 'Subscribed users',
  all_users: 'All users',
  loyalty_members: 'Loyalty members',
  recent_customers: 'Recent customers',
};

/* ── main component ────────────────────────────────────── */

const Marketing = ({ token }) => {
  /* data */
  const {
    data: overviewRaw,
    isLoading,
    error: fetchError,
    refetch: fetchOverview,
  } = useAdminQuery(
    'marketing',
    ({ token: t, signal }) =>
      axios.get(BACKEND_URL + '/api/marketing/admin', { headers: { token: t }, signal }).then((r) => r.data),
    { token },
  );

  const campaigns = overviewRaw?.campaigns || [];
  const activity = overviewRaw?.activity || [];
  const metrics = overviewRaw?.metrics || null;
  const deliveryConfig = overviewRaw?.deliveryConfig || null;

  /* persisted filters */
  const [statusFilter, setStatusFilter] = usePersistedState('marketing.statusFilter', 'all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);

  /* form */
  const [formMode, setFormMode] = useState('create');
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [formData, setFormData] = useState(createEmptyFormState());
  const [drawerOpen, setDrawerOpen] = useState(false);

  /* confirm dialog */
  const [dispatchConfirmOpen, setDispatchConfirmOpen] = useState(false);
  const [pendingDispatchCampaign, setPendingDispatchCampaign] = useState(null);

  /* activity rail */
  const [activityFilter, setActivityFilter] = usePersistedState('marketing.activityFilter', 'all');

  /* derived lists */
  const visibleCampaigns = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    return campaigns.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (q && !`${c.name} ${c.subject} ${c.audience}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [campaigns, debouncedSearch, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts = { all: campaigns.length, draft: 0, scheduled: 0, active: 0, paused: 0, sent: 0 };
    campaigns.forEach((c) => {
      if (counts[c.status] !== undefined) counts[c.status]++;
    });
    return counts;
  }, [campaigns]);

  const tabs = useMemo(
    () =>
      STATUS_TAB_IDS.map((id) => ({
        id,
        label: id === 'all' ? 'All' : id.charAt(0).toUpperCase() + id.slice(1),
        count: statusCounts[id],
      })),
    [statusCounts],
  );

  const filteredActivity = useMemo(() => {
    if (activityFilter === 'all') return activity;
    return activity.filter((a) => a.status === activityFilter);
  }, [activity, activityFilter]);

  /* mutations */
  const [isSaving, setIsSaving] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);

  /* form helpers */
  const openCreate = () => {
    setFormMode('create');
    setSelectedCampaignId('');
    setFormData(createEmptyFormState());
    setDrawerOpen(true);
  };

  const openEdit = (campaign) => {
    setFormMode('edit');
    setSelectedCampaignId(campaign._id);
    setFormData(buildFormStateFromCampaign(campaign));
    setDrawerOpen(true);
  };

  const openClone = (campaign) => {
    setFormMode('create');
    setSelectedCampaignId('');
    const base = buildFormStateFromCampaign(campaign);
    setFormData({
      ...base,
      name: (base.name || '') + ' (copy)',
      sendAt: '',
      status: 'draft',
    });
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setFormMode('create');
    setSelectedCampaignId('');
    setFormData(createEmptyFormState());
  };

  const handleSaveCampaign = async (e) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    try {
      const isEdit = formMode === 'edit';
      const endpoint = isEdit ? '/api/marketing/admin/update' : '/api/marketing/admin/create';
      const method = isEdit ? 'put' : 'post';
      const payload = {
        ...formData,
        sendAt: formData.sendAt || null,
        ...(isEdit ? { campaignId: selectedCampaignId } : {}),
      };
      const response = await axios[method](BACKEND_URL + endpoint, payload, { headers: { token } });
      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to save campaign');
        return;
      }
      toast.success(response.data.message || 'Campaign saved');
      fetchOverview();
      closeDrawer();
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleStatusChange = async (campaign, nextStatus) => {
    try {
      const response = await axios.patch(
        BACKEND_URL + '/api/marketing/admin/status',
        { campaignId: campaign._id, status: nextStatus },
        { headers: { token } },
      );
      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to update status');
        return;
      }
      toast.success(response.data.message || 'Status updated');
      fetchOverview();
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    }
  };

  const handleDispatchClick = (campaign) => {
    setPendingDispatchCampaign(campaign);
    setDispatchConfirmOpen(true);
  };

  const confirmDispatch = async () => {
    if (!pendingDispatchCampaign) return;
    setIsDispatching(true);
    try {
      const response = await axios.post(
        BACKEND_URL + '/api/marketing/admin/dispatch',
        { campaignId: pendingDispatchCampaign._id },
        { headers: { token } },
      );
      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to dispatch campaign');
        return;
      }
      toast.success(response.data.message || 'Campaign dispatched');
      fetchOverview();
      setDispatchConfirmOpen(false);
      setPendingDispatchCampaign(null);
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message);
    } finally {
      setIsDispatching(false);
    }
  };

  /* columns */
  const columns = useMemo(
    () => [
      {
        key: 'name',
        header: 'Campaign',
        render: (row) => (
          <div>
            <p className="font-semibold text-slate-900">{row.name}</p>
            <p className="mt-0.5 text-xs text-slate-500 truncate max-w-xs">{row.subject}</p>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => <StatusBadge status={row.status} size="sm" />,
      },
      {
        key: 'campaignType',
        header: 'Type',
        render: (row) => (
          <span className="text-sm capitalize text-slate-700">{row.campaignType}</span>
        ),
      },
      {
        key: 'audience',
        header: 'Audience',
        render: (row) => (
          <span className="text-sm text-slate-700">
            {AUDIENCE_LABELS[row.audience] || row.audience?.replaceAll('_', ' ')}
          </span>
        ),
      },
      {
        key: 'sentCount',
        header: 'Sent',
        sortable: true,
        align: 'right',
        render: (row) => <span className="tabular-nums">{row.sentCount || 0}</span>,
      },
      {
        key: 'sendAt',
        header: 'Scheduled',
        sortable: true,
        render: (row) => (
          <span className="text-sm text-slate-500">
            {row.sendAt ? formatDate(row.sendAt) : 'Not scheduled'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        width: '180px',
        render: (row) => {
          const nextStatus = row.status === 'active' ? 'paused' : 'active';
          return (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); openEdit(row); }}
                className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); openClone(row); }}
                className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Clone
              </button>
              {row.status !== 'sent' && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleStatusChange(row, nextStatus); }}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  {row.status === 'active' ? 'Pause' : 'Activate'}
                </button>
              )}
              {row.campaignType === 'broadcast' && row.status !== 'sent' && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleDispatchClick(row); }}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
                >
                  Dispatch
                </button>
              )}
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* sort */
  const [sortKey, setSortKey] = usePersistedState('marketing.sortKey', '');
  const [sortDirection, setSortDirection] = usePersistedState('marketing.sortDir', 'asc');

  const handleSortChange = (key, dir) => {
    setSortKey(key);
    setSortDirection(dir);
  };

  const sortedCampaigns = useMemo(() => {
    if (!sortKey) return visibleCampaigns;
    const sorted = [...visibleCampaigns].sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === 'sendAt') {
        av = av ? new Date(av).getTime() : Infinity;
        bv = bv ? new Date(bv).getTime() : Infinity;
      }
      if (typeof av === 'string') return av.localeCompare(bv);
      return (Number(av) || 0) - (Number(bv) || 0);
    });
    return sortDirection === 'desc' ? sorted.reverse() : sorted;
  }, [visibleCampaigns, sortKey, sortDirection]);

  /* body word count */
  const bodyWordCount = useMemo(() => {
    const words = formData.body.trim().split(/\s+/).filter(Boolean);
    return words.length;
  }, [formData.body]);

  /* ── render ──────────────────────────────────────────── */

  return (
    <div className="flex flex-col gap-6">
      {/* header */}
      <PageHeader
        title="Lifecycle marketing"
        description="Build broadcasts, manage automation templates, and monitor email delivery."
        actions={
          <>
            {deliveryConfig && (
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone="neutral" size="sm" withDot={false}>
                  Mode {deliveryConfig.mode}
                </StatusBadge>
                <StatusBadge tone="info" size="sm" withDot={false}>
                  Provider {deliveryConfig.provider}
                </StatusBadge>
              </div>
            )}
            <button
              type="button"
              onClick={fetchOverview}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
            >
              + New campaign
            </button>
          </>
        }
      />

      {/* metrics */}
      {metrics && (
        <MetricGrid>
          <MetricCard label="Total campaigns" value={metrics.totalCampaigns} />
          <MetricCard label="Active" value={metrics.activeCampaigns} />
          <MetricCard label="Emails sent" value={metrics.emailsSent} />
          <MetricCard label="Emails failed" value={metrics.emailsFailed} />
          <MetricCard label="Automation events" value={metrics.automationEvents} />
        </MetricGrid>
      )}

      {/* two-pane: campaigns left, activity right */}
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        {/* campaigns pane */}
        <div className="flex flex-col gap-4">
          <Tabs tabs={tabs} value={statusFilter} onChange={setStatusFilter} />
          <Toolbar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search by name, subject, or audience…"
            actions={
              <button
                type="button"
                onClick={openCreate}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
              >
                + New campaign
              </button>
            }
          />
          <DataTable
            columns={columns}
            rows={sortedCampaigns}
            rowKey="_id"
            loading={isLoading}
            error={fetchError}
            onRetry={fetchOverview}
            emptyTitle="No campaigns found"
            emptyDescription="Create a campaign to get started, or adjust your filters."
            emptyAction={
              <button
                type="button"
                onClick={openCreate}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
              >
                + Create your first campaign
              </button>
            }
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSortChange={handleSortChange}
            onRowClick={openEdit}
          />
        </div>

        {/* activity rail */}
        <aside className="flex flex-col gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <p className="text-base font-semibold text-slate-900">Recent email activity</p>
              <p className="mt-1 text-sm text-slate-500">
                Latest sends, skips, and automation-triggered messages.
              </p>
            </div>

            <div className="mb-4">
              <select
                value={activityFilter}
                onChange={(e) => setActivityFilter(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                aria-label="Filter activity by status"
              >
                <option value="all">All activity</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
                <option value="queued">Queued</option>
                <option value="skipped">Skipped</option>
              </select>
            </div>

            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {filteredActivity.length === 0 ? (
                <div className="rounded-xl bg-slate-50 px-4 py-5 text-sm text-slate-500">
                  Email activity will appear here after the first automation or dispatch.
                </div>
              ) : (
                filteredActivity.map((item) => {
                  const campaign = campaigns.find((c) => c._id === item.campaignId);
                  return (
                    <div
                      key={item._id}
                      className="rounded-xl border border-slate-200 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 truncate">{item.subject}</p>
                          <p className="mt-0.5 text-xs text-slate-500 truncate">{item.email}</p>
                          <p className="mt-1 text-xs text-slate-600">
                            {campaign?.name || item.automationKey?.replaceAll('_', ' ') || 'Campaign event'}
                          </p>
                        </div>
                        <StatusBadge status={item.status} size="sm" />
                      </div>
                      <p className="mt-2 text-xs text-slate-400">
                        {formatDate(item.sentAt || item.createdAt)}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* form drawer */}
      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        title={formMode === 'edit' ? 'Edit campaign' : formMode === 'clone' ? 'Clone campaign' : 'Create campaign'}
        description="Changes are saved to the marketing API."
        width="lg"
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={closeDrawer}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="campaign-form"
              disabled={isSaving}
              className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : formMode === 'edit' ? 'Update campaign' : 'Create campaign'}
            </button>
          </div>
        }
      >
        <form id="campaign-form" onSubmit={handleSaveCampaign} className="grid gap-5">

          {/* Campaign name */}
          <div>
            <label htmlFor="campaign-name" className={labelCls}>Campaign name</label>
            <input
              id="campaign-name"
              value={formData.name}
              onChange={(e) => setFormData((s) => ({ ...s, name: e.target.value }))}
              className={inputCls}
              placeholder="e.g. Spring loyalty booster"
              required
            />
          </div>

          {/* Type + Audience */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="campaign-type" className={labelCls}>Campaign type</label>
              <select
                id="campaign-type"
                value={formData.campaignType}
                onChange={(e) => setFormData((s) => ({ ...s, campaignType: e.target.value }))}
                className={selectCls}
              >
                <option value="broadcast">Broadcast — send once to all</option>
                <option value="automation">Automation — triggered by event</option>
              </select>
            </div>
            <div>
              <label htmlFor="campaign-audience" className={labelCls}>Audience</label>
              <select
                id="campaign-audience"
                value={formData.audience}
                onChange={(e) => setFormData((s) => ({ ...s, audience: e.target.value }))}
                className={selectCls}
              >
                <option value="subscribed_users">Subscribed users</option>
                <option value="all_users">All users</option>
                <option value="loyalty_members">Loyalty members</option>
                <option value="recent_customers">Recent customers</option>
              </select>
            </div>
          </div>

          {/* Trigger + Status */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="campaign-trigger" className={labelCls}>Automation trigger</label>
              <select
                id="campaign-trigger"
                value={formData.automationTrigger}
                onChange={(e) => setFormData((s) => ({ ...s, automationTrigger: e.target.value }))}
                className={selectCls}
                disabled={formData.campaignType !== 'automation'}
              >
                <option value="manual">Manual</option>
                <option value="user_registered">User registered</option>
                <option value="order_delivered">Order delivered</option>
                <option value="review_published">Review published</option>
                <option value="points_milestone">Points milestone</option>
              </select>
              {formData.campaignType !== 'automation' && (
                <p className="mt-1 text-[11px] text-slate-400">Only used for automation campaigns</p>
              )}
            </div>
            <div>
              <label htmlFor="campaign-status" className={labelCls}>Status</label>
              <select
                id="campaign-status"
                value={formData.status}
                onChange={(e) => setFormData((s) => ({ ...s, status: e.target.value }))}
                className={selectCls}
              >
                <option value="draft">Draft — not sent yet</option>
                <option value="scheduled">Scheduled — queued to send</option>
                <option value="active">Active — sending now</option>
                <option value="paused">Paused</option>
              </select>
            </div>
          </div>

          {/* Subject + Preview */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 grid gap-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 -mb-1">Email content</p>
            <div>
              <label htmlFor="campaign-subject" className={labelCls}>Subject line</label>
              <input
                id="campaign-subject"
                value={formData.subject}
                onChange={(e) => setFormData((s) => ({ ...s, subject: e.target.value }))}
                className={inputCls}
                placeholder="Your next Lavish Fashion reward is ready"
                required
              />
            </div>
            <div>
              <label htmlFor="campaign-preview" className={labelCls}>Preview text <span className="normal-case tracking-normal font-normal text-slate-400">— shown in inbox as preheader</span></label>
              <input
                id="campaign-preview"
                value={formData.previewText}
                onChange={(e) => setFormData((s) => ({ ...s, previewText: e.target.value }))}
                className={inputCls}
                placeholder="Short copy that appears after the subject line in the inbox"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="campaign-body" className={labelCls}>Message body</label>
                <span className="text-[11px] text-slate-400">{bodyWordCount} {bodyWordCount === 1 ? 'word' : 'words'}</span>
              </div>
              <textarea
                id="campaign-body"
                value={formData.body}
                onChange={(e) => setFormData((s) => ({ ...s, body: e.target.value }))}
                className={inputCls + ' min-h-36 resize-y'}
                placeholder="Use placeholders like {{name}}, {{referralCode}}, and {{loyaltyPoints}}."
                required
              />
              <p className="mt-1 text-[11px] text-slate-400">{'Supports {{name}}, {{loyaltyPoints}}, {{referralCode}}, {{orderStatus}}'}</p>
            </div>
          </div>

          {/* Scheduled send */}
          <div>
            <label htmlFor="campaign-send-at" className={labelCls}>Scheduled send <span className="normal-case tracking-normal font-normal text-slate-400">(IST) — leave empty to send manually</span></label>
            <input
              id="campaign-send-at"
              value={formData.sendAt}
              onChange={(e) => setFormData((s) => ({ ...s, sendAt: e.target.value }))}
              className={inputCls}
              type="datetime-local"
            />
          </div>
        </form>
      </Drawer>

      {/* dispatch confirm */}
      <ConfirmDialog
        open={dispatchConfirmOpen}
        title="Dispatch campaign?"
        description={
          pendingDispatchCampaign
            ? `You are about to send "${pendingDispatchCampaign.name}" to ${AUDIENCE_LABELS[pendingDispatchCampaign.audience] || pendingDispatchCampaign.audience}${deliveryConfig ? ` via ${deliveryConfig.provider}` : ''}. This action cannot be undone.`
            : ''
        }
        confirmLabel="Send now"
        onConfirm={confirmDispatch}
        onCancel={() => {
          setDispatchConfirmOpen(false);
          setPendingDispatchCampaign(null);
        }}
        busy={isDispatching}
      />
    </div>
  );
};

export default Marketing;
