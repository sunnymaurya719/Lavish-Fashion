import React, { memo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { resolveAdminBreadcrumbs, resolveAdminPageMeta } from '../config/navigation';
import { formatTime } from './ui/format';
import ConfirmDialog from './ui/ConfirmDialog';

const ConnectionChip = ({ serverStatus }) => {
  const palette =
    serverStatus === 'online'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : serverStatus === 'offline'
        ? 'border-rose-200 bg-rose-50 text-rose-800'
        : 'border-slate-200 bg-slate-50 text-slate-700';
  const label =
    serverStatus === 'online' ? 'API online' : serverStatus === 'offline' ? 'API offline' : 'Checking API';
  const dotTone =
    serverStatus === 'online'
      ? 'bg-emerald-500'
      : serverStatus === 'offline'
        ? 'bg-rose-500'
        : 'bg-slate-400 animate-pulse';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${palette}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotTone}`} aria-hidden='true' />
      {label}
    </span>
  );
};

const Breadcrumbs = ({ trail }) => (
  <nav aria-label='Breadcrumb'>
    <ol className='flex flex-wrap items-center gap-1 text-xs font-medium text-slate-500'>
      {trail.map((segment, index) => {
        const isLast = index === trail.length - 1;
        return (
          <li key={`${segment.to}-${index}`} className='flex items-center gap-1'>
            {index > 0 ? (
              <span className='text-slate-300' aria-hidden='true'>
                ›
              </span>
            ) : null}
            {isLast ? (
              <span className='text-slate-700'>{segment.label}</span>
            ) : (
              <Link to={segment.to} className='transition hover:text-slate-800 hover:underline'>
                {segment.label}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  </nav>
);

const Navbar = ({
  onOpenSidebar,
  setToken,
  serverStatus,
  serverBootstrap,
  lastServerSyncAt,
  onRefreshServerStatus,
}) => {
  const location = useLocation();
  const pageMeta = resolveAdminPageMeta(location.pathname);
  const breadcrumbs = resolveAdminBreadcrumbs(location.pathname);
  const todayLabel = new Date().toLocaleDateString('en-IN', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const syncLabel = formatTime(lastServerSyncAt);
  const emailMode = serverBootstrap?.integrations?.marketingEmailMode || 'simulation';
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);

  return (
    <>
      <header className='sticky top-0 z-20 border-b border-white/70 bg-white/85 backdrop-blur-xl'>
        <div className='mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8 xl:px-10'>
          <div className='flex min-w-0 items-start gap-3'>
            <button
              type='button'
              onClick={onOpenSidebar}
              className='mt-1 flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm lg:hidden'
              aria-label='Open sidebar'
            >
              <svg width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
                <path d='M4 7h16v2H4V7Zm0 8v-2h16v2H4Zm0 4v-2h10v2H4Z' fill='currentColor' />
              </svg>
            </button>

            <div className='min-w-0'>
              <Breadcrumbs trail={breadcrumbs} />
              <h1 className='mt-1 truncate text-xl font-semibold text-slate-950 sm:text-2xl'>
                {pageMeta.title}
              </h1>
              <p className='mt-1 hidden max-w-2xl text-sm text-slate-500 md:block'>
                {pageMeta.description}
              </p>
            </div>
          </div>

          <div className='flex shrink-0 items-center gap-2'>
            <div className='hidden text-right md:block'>
              <p className='text-sm font-medium text-slate-900'>{todayLabel}</p>
              <p className='text-xs text-slate-500'>Email · {emailMode}</p>
            </div>

            <ConnectionChip serverStatus={serverStatus} />

            {/*
              Synced + Refresh combined into a single chip so the agent
              doesn't have to read fine print to know freshness
              (ADMIN_UI_OPTIMIZATION_PLAN §2.2 step 4).
            */}
            <button
              type='button'
              onClick={onRefreshServerStatus}
              className='inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 ui-focus-ring'
              title='Refresh server status'
            >
              <span className='hidden sm:inline'>Synced {syncLabel}</span>
              <span className='sm:hidden'>{syncLabel}</span>
              <svg width='12' height='12' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
                <path d='M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z' fill='currentColor' />
              </svg>
            </button>

            {/* Visual divider so Logout reads as separate destructive territory */}
            <span className='hidden h-8 w-px bg-slate-200 sm:inline-block' aria-hidden='true' />

            {/*
              Distinct subdued treatment of Logout — it shouldn't compete with
              Refresh visually (ADMIN_UI_OPTIMIZATION_PLAN §2.2 step 3).
            */}
            <button
              type='button'
              onClick={() => setConfirmLogoutOpen(true)}
              className='rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 ui-focus-ring'
              aria-label='Sign out of admin'
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <ConfirmDialog
        open={confirmLogoutOpen}
        title='Sign out of admin?'
        description='You will need to re-enter your credentials to return to the admin workspace.'
        confirmLabel='Sign out'
        cancelLabel='Stay signed in'
        destructive
        onCancel={() => setConfirmLogoutOpen(false)}
        onConfirm={() => {
          setConfirmLogoutOpen(false);
          setToken();
        }}
      />
    </>
  );
};

export default memo(Navbar);
