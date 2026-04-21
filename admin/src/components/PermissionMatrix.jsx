import { useMemo } from 'react';

/**
 * Grouped permission selector.
 *
 * Renders one column per module (matches the catalog returned by
 * GET /api/admin/users/permissions/catalog). Each module has:
 *   • a "Select all" checkbox that toggles every action under it
 *   • one checkbox per action
 *
 * A footer "Select all permissions" toggles the wildcard '*'. While '*' is
 * checked, the per-module rows are disabled and shown as universally granted.
 *
 * Props:
 *   catalog          : { modules: [{ key, label, actions: [{action, permission}] }], wildcard: '*' }
 *   value            : string[] currently selected permissions
 *   onChange         : (next: string[]) => void
 *   disabled         : boolean
 *   allowWildcard    : boolean — show "Select all permissions" row (super-admin only)
 */
const PermissionMatrix = ({
  catalog,
  value = [],
  onChange,
  disabled = false,
  allowWildcard = false
}) => {
  const wildcard = catalog?.wildcard || '*';
  const selected = useMemo(() => new Set(value || []), [value]);
  const hasWildcard = selected.has(wildcard);

  const togglePermission = (perm, on) => {
    const next = new Set(selected);
    if (on) next.add(perm);
    else next.delete(perm);
    onChange?.(Array.from(next));
  };

  const toggleModule = (module, on) => {
    const next = new Set(selected);
    module.actions.forEach((a) => {
      if (on) next.add(a.permission);
      else next.delete(a.permission);
    });
    onChange?.(Array.from(next));
  };

  const toggleWildcard = (on) => {
    if (on) {
      onChange?.([wildcard]);
    } else {
      onChange?.([]);
    }
  };

  if (!catalog?.modules?.length) {
    return (
      <div className='rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500'>
        Loading permission catalog…
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      {allowWildcard ? (
        <label
          className={`flex items-start gap-3 rounded-2xl border px-4 py-3 transition ${
            hasWildcard
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-white text-slate-700'
          } ${disabled ? 'opacity-60' : 'cursor-pointer'}`}
        >
          <input
            type='checkbox'
            className='mt-1 h-4 w-4 accent-current'
            checked={hasWildcard}
            disabled={disabled}
            onChange={(e) => toggleWildcard(e.target.checked)}
          />
          <span className='text-sm'>
            <span className='block font-semibold'>Full access (super admin)</span>
            <span className={`mt-0.5 block text-xs ${hasWildcard ? 'text-slate-300' : 'text-slate-500'}`}>
              Grants every current and future permission. Use sparingly.
            </span>
          </span>
        </label>
      ) : null}

      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
        {catalog.modules.map((module) => {
          const moduleAll = module.actions.every((a) => selected.has(a.permission));
          const moduleSome = module.actions.some((a) => selected.has(a.permission));
          const isFullyGranted = hasWildcard || moduleAll;

          return (
            <fieldset
              key={module.key}
              className={`rounded-2xl border p-3 transition ${
                isFullyGranted ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'
              }`}
            >
              <legend className='flex w-full items-center justify-between px-1'>
                <span className='text-sm font-semibold text-slate-900'>{module.label}</span>
                <label className='inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500'>
                  <input
                    type='checkbox'
                    className='h-3.5 w-3.5 accent-slate-900'
                    checked={moduleAll}
                    ref={(el) => {
                      if (el) el.indeterminate = !moduleAll && moduleSome;
                    }}
                    disabled={disabled || hasWildcard}
                    onChange={(e) => toggleModule(module, e.target.checked)}
                  />
                  Select all
                </label>
              </legend>

              <div className='mt-2 space-y-1.5'>
                {module.actions.map((a) => (
                  <label
                    key={a.permission}
                    className={`flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-sm ${
                      disabled || hasWildcard ? 'cursor-not-allowed text-slate-500' : 'cursor-pointer text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <span className='capitalize'>{a.action.replace(/_/g, ' ')}</span>
                    <input
                      type='checkbox'
                      className='h-4 w-4 accent-slate-900'
                      checked={hasWildcard || selected.has(a.permission)}
                      disabled={disabled || hasWildcard}
                      onChange={(e) => togglePermission(a.permission, e.target.checked)}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
};

export default PermissionMatrix;
