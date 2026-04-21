import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';
import {
  PageHeader,
  Toolbar,
  DataTable,
  ConfirmDialog,
  Drawer,
  StatusBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  formatDate,
} from '../components/ui';
import PermissionMatrix from '../components/PermissionMatrix';
import { useAuth } from '../store/authStore';
import usePermission from '../hooks/usePermission';

const ROLE_OPTIONS = [
  { value: 'manager', label: 'Manager' },
  { value: 'staff', label: 'Staff' },
  { value: 'admin', label: 'Admin' }
];

const ROLE_TONE = {
  admin: 'danger',
  manager: 'info',
  staff: 'neutral'
};

const emptyForm = () => ({
  name: '',
  email: '',
  password: '',
  role: 'staff',
  permissions: [],
  isActive: true
});

const Users = ({ token }) => {
  const { user: actor, refreshProfile } = useAuth();
  const canCreate = usePermission('users.create');
  const canUpdate = usePermission('users.update');
  const canAssign = usePermission('users.assign_permissions');
  const canDelete = usePermission('users.delete');
  const isSuperAdmin = Boolean(actor?.isSuperAdmin);

  const [users, setUsers] = useState([]);
  const [catalog, setCatalog] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null); // null = create mode
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const authHeaders = useMemo(
    () => ({ headers: { Authorization: `Bearer ${token}` } }),
    [token]
  );

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [usersRes, catalogRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/admin/users`, authHeaders),
        axios.get(`${BACKEND_URL}/api/admin/users/permissions/catalog`, authHeaders)
      ]);
      if (usersRes.data?.success) setUsers(usersRes.data.users || []);
      if (catalogRes.data?.success) setCatalog(catalogRes.data.catalog || null);
    } catch (error) {
      setLoadError(error?.response?.data?.message || error.message || 'Failed to load admin users');
    } finally {
      setIsLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openCreate = () => {
    setEditingUser(null);
    setForm({
      ...emptyForm(),
      // Pre-fill with the staff template if we have it.
      permissions: catalog?.roleTemplates?.staff ? [...catalog.roleTemplates.staff] : []
    });
    setDrawerOpen(true);
  };

  const openEdit = (target) => {
    setEditingUser(target);
    setForm({
      name: target.name || '',
      email: target.email || '',
      password: '',
      role: target.role || 'staff',
      permissions: Array.isArray(target.permissions) ? [...target.permissions] : [],
      isActive: target.isActive !== false
    });
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingUser(null);
  };

  const handleRoleChange = (nextRole) => {
    setForm((prev) => {
      // When switching role, suggest the matching template (only if the
      // current set is empty or matched the previous template, to avoid
      // wiping deliberate selections).
      const tpl = catalog?.roleTemplates?.[nextRole];
      const prevTpl = catalog?.roleTemplates?.[prev.role];
      const looksLikeTemplate =
        !prev.permissions ||
        prev.permissions.length === 0 ||
        (Array.isArray(prevTpl) &&
          prevTpl.length === prev.permissions.length &&
          prevTpl.every((p) => prev.permissions.includes(p)));
      return {
        ...prev,
        role: nextRole,
        permissions: looksLikeTemplate && Array.isArray(tpl) ? [...tpl] : prev.permissions
      };
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    if (isSaving) return;

    if (!editingUser) {
      if (!form.name.trim() || !form.email.trim() || !form.password) {
        toast.error('Name, email, and password are required');
        return;
      }
      if (form.password.length < 8) {
        toast.error('Password must be at least 8 characters');
        return;
      }
    }

    setIsSaving(true);
    try {
      if (editingUser) {
        const payload = {
          name: form.name.trim(),
          role: form.role,
          permissions: form.permissions,
          isActive: form.isActive
        };
        if (form.password) payload.password = form.password;
        const res = await axios.put(
          `${BACKEND_URL}/api/admin/users/${editingUser.id}`,
          payload,
          authHeaders
        );
        if (res.data?.success) {
          toast.success('User updated');
          await loadUsers();
          // If we edited ourselves, refresh the cached profile so the
          // sidebar/permissions react immediately.
          if (actor?.id && editingUser.id === actor.id) await refreshProfile();
          closeDrawer();
        }
      } else {
        const res = await axios.post(
          `${BACKEND_URL}/api/admin/users`,
          {
            name: form.name.trim(),
            email: form.email.trim().toLowerCase(),
            password: form.password,
            role: form.role,
            permissions: form.permissions,
            isActive: form.isActive
          },
          authHeaders
        );
        if (res.data?.success) {
          toast.success('User created');
          await loadUsers();
          closeDrawer();
        }
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message || 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleStatus = async (target) => {
    try {
      const res = await axios.patch(
        `${BACKEND_URL}/api/admin/users/${target.id}/status`,
        { isActive: !target.isActive },
        authHeaders
      );
      if (res.data?.success) {
        toast.success(target.isActive ? 'User disabled' : 'User enabled');
        await loadUsers();
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message || 'Status change failed');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await axios.delete(
        `${BACKEND_URL}/api/admin/users/${deleteTarget.id}`,
        authHeaders
      );
      if (res.data?.success) {
        toast.success('User deleted');
        await loadUsers();
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || error.message || 'Delete failed');
    } finally {
      setDeleteTarget(null);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => (
        <div className='min-w-0'>
          <p className='truncate font-medium text-slate-900'>{row.name}</p>
          <p className='truncate text-xs text-slate-500'>{row.email}</p>
        </div>
      )
    },
    {
      key: 'role',
      header: 'Role',
      render: (row) => (
        <StatusBadge tone={ROLE_TONE[row.role] || 'neutral'}>{row.role}</StatusBadge>
      )
    },
    {
      key: 'permissions',
      header: 'Permissions',
      render: (row) => {
        if (row.isSuperAdmin) {
          return <span className='text-xs font-semibold text-emerald-700'>Full access (*)</span>;
        }
        const count = Array.isArray(row.permissions) ? row.permissions.length : 0;
        return <span className='text-xs text-slate-600'>{count} granted</span>;
      }
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusBadge tone={row.isActive ? 'success' : 'danger'}>
          {row.isActive ? 'Active' : 'Disabled'}
        </StatusBadge>
      )
    },
    {
      key: 'lastLoginAt',
      header: 'Last login',
      render: (row) =>
        row.lastLoginAt ? (
          <span className='text-xs text-slate-600'>{formatDate(row.lastLoginAt)}</span>
        ) : (
          <span className='text-xs text-slate-400'>Never</span>
        )
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => {
        const isSelf = actor?.id && row.id === actor.id;
        return (
          <div className='flex items-center justify-end gap-2'>
            {canUpdate ? (
              <button
                type='button'
                onClick={() => openEdit(row)}
                className='rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50'
              >
                Edit
              </button>
            ) : null}
            {canUpdate && !isSelf ? (
              <button
                type='button'
                onClick={() => toggleStatus(row)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                  row.isActive
                    ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                {row.isActive ? 'Disable' : 'Enable'}
              </button>
            ) : null}
            {canDelete && !isSelf ? (
              <button
                type='button'
                onClick={() => setDeleteTarget(row)}
                className='rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50'
              >
                Delete
              </button>
            ) : null}
          </div>
        );
      }
    }
  ];

  // Edit-mode permission matrix is read-only when the actor lacks
  // users.assign_permissions (they can rename / toggle status but not edit grants).
  const matrixDisabled = editingUser ? !canAssign : false;

  return (
    <div className='space-y-6'>
      <PageHeader
        title='Admin Users'
        description='Manage admin team roles, granular permissions, and account access.'
        actions={
          canCreate ? (
            <button
              type='button'
              onClick={openCreate}
              className='inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800'
            >
              <svg width='14' height='14' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
                <path d='M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z' fill='currentColor' />
              </svg>
              New user
            </button>
          ) : null
        }
      />

      <Toolbar>
        <div className='text-sm text-slate-600'>
          {users.length} admin {users.length === 1 ? 'user' : 'users'}
          {actor ? (
            <span className='ml-2 text-xs text-slate-400'>
              Signed in as <span className='font-medium text-slate-600'>{actor.email}</span>
              {' • '}
              role <span className='font-medium text-slate-600'>{actor.role}</span>
            </span>
          ) : null}
        </div>
      </Toolbar>

      {isLoading ? (
        <LoadingState variant='spinner' message='Loading admin users…' />
      ) : loadError ? (
        <ErrorState description={loadError} onRetry={loadUsers} />
      ) : users.length === 0 ? (
        <EmptyState
          title='No admin users yet'
          description='Create your first manager or staff account to start delegating access.'
          action={
            canCreate ? (
              <button
                type='button'
                onClick={openCreate}
                className='rounded-2xl bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800'
              >
                Create first user
              </button>
            ) : null
          }
        />
      ) : (
        <DataTable columns={columns} rows={users} rowKey={(row) => row.id} />
      )}

      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        title={editingUser ? `Edit ${editingUser.name}` : 'Create admin user'}
        width='xl'
      >
        <form onSubmit={submit} className='space-y-6'>
          <div className='grid gap-4 sm:grid-cols-2'>
            <label className='block'>
              <span className='mb-1.5 block text-xs font-medium text-slate-600'>Name</span>
              <input
                type='text'
                required
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className='w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm ui-focus-ring'
              />
            </label>
            <label className='block'>
              <span className='mb-1.5 block text-xs font-medium text-slate-600'>Email</span>
              <input
                type='email'
                required
                disabled={Boolean(editingUser)}
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                className='w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm ui-focus-ring disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500'
              />
            </label>
            <label className='block'>
              <span className='mb-1.5 block text-xs font-medium text-slate-600'>
                {editingUser ? 'New password (leave blank to keep current)' : 'Password'}
              </span>
              <input
                type='password'
                autoComplete='new-password'
                required={!editingUser}
                minLength={8}
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                className='w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm ui-focus-ring'
              />
            </label>
            <label className='block'>
              <span className='mb-1.5 block text-xs font-medium text-slate-600'>Role</span>
              <select
                value={form.role}
                onChange={(e) => handleRoleChange(e.target.value)}
                className='w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm ui-focus-ring'
              >
                {ROLE_OPTIONS.filter((opt) => isSuperAdmin || opt.value !== 'admin').map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className='inline-flex items-center gap-2 text-sm text-slate-700'>
            <input
              type='checkbox'
              className='h-4 w-4 accent-slate-900'
              checked={form.isActive}
              onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
            />
            Account active
          </label>

          <div>
            <div className='mb-2 flex items-center justify-between'>
              <h3 className='text-sm font-semibold text-slate-900'>Permissions</h3>
              {!matrixDisabled ? (
                <button
                  type='button'
                  onClick={() => {
                    const tpl = catalog?.roleTemplates?.[form.role];
                    if (Array.isArray(tpl)) setForm((p) => ({ ...p, permissions: [...tpl] }));
                  }}
                  className='text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline'
                >
                  Reset to {form.role} template
                </button>
              ) : null}
            </div>
            <PermissionMatrix
              catalog={catalog}
              value={form.permissions}
              onChange={(next) => setForm((p) => ({ ...p, permissions: next }))}
              disabled={matrixDisabled}
              allowWildcard={isSuperAdmin}
            />
            {matrixDisabled ? (
              <p className='mt-2 text-xs text-amber-700'>
                You need <span className='font-mono'>users.assign_permissions</span> to edit grants.
              </p>
            ) : null}
          </div>

          <div className='flex items-center justify-end gap-3 border-t border-slate-200 pt-4'>
            <button
              type='button'
              onClick={closeDrawer}
              className='rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50'
            >
              Cancel
            </button>
            <button
              type='submit'
              disabled={isSaving}
              className='inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60'
            >
              {isSaving ? (
                <>
                  <span className='inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white' />
                  Saving…
                </>
              ) : editingUser ? (
                'Save changes'
              ) : (
                'Create user'
              )}
            </button>
          </div>
        </form>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title='Delete admin user?'
        description={
          deleteTarget
            ? `${deleteTarget.name} (${deleteTarget.email}) will lose access immediately. This cannot be undone.`
            : ''
        }
        confirmLabel='Delete user'
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
};

export default Users;
