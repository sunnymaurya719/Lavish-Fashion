import React from 'react';
import { useLocation } from 'react-router-dom';
import { resolveAdminPageMeta } from '../config/navigation';

const formatSyncTime = (value) => {
  if (!value) {
    return 'Awaiting first sync';
  }

  return new Date(value).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const Navbar = ({ onOpenSidebar, setToken, serverStatus, serverBootstrap, lastServerSyncAt, onRefreshServerStatus }) => {
  const location = useLocation();
  const pageMeta = resolveAdminPageMeta(location.pathname);
  const todayLabel = new Date().toLocaleDateString('en-IN', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
  const connectionBadge =
    serverStatus === 'online'
      ? {
          title: 'API online',
          detail: `Email ${serverBootstrap?.integrations?.marketingEmailMode || 'simulation'} | Synced ${formatSyncTime(lastServerSyncAt)}`,
          classes: 'border-emerald-200 bg-emerald-50 text-emerald-950',
        }
      : serverStatus === 'offline'
        ? {
            title: 'API offline',
            detail: 'Reconnect to restore live dashboard operations',
            classes: 'border-rose-200 bg-rose-50 text-rose-950',
          }
        : {
            title: 'Checking API',
            detail: 'Verifying server capabilities and integrations',
            classes: 'border-slate-200 bg-slate-50 text-slate-900',
          };

  return (
    <header className='sticky top-0 z-20 border-b border-white/70 bg-white/85 backdrop-blur-xl'>
      <div className='mx-auto flex w-full max-w-[1600px] items-start justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8 xl:px-10'>
        <div className='flex items-start gap-3'>
          <button
            type='button'
            onClick={onOpenSidebar}
            className='mt-1 flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm lg:hidden'
            aria-label='Open sidebar'
          >
            <svg width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
              <path d='M4 7h16v2H4V7Zm0 8v-2h16v2H4Zm0 4v-2h10v2H4Z' fill='currentColor' />
            </svg>
          </button>

          <div>
            <p className='text-[11px] uppercase tracking-[0.35em] text-slate-400'>Admin workspace</p>
            <h1 className='mt-1 text-2xl font-semibold text-slate-950'>{pageMeta.title}</h1>
            <p className='mt-2 max-w-2xl text-sm text-slate-500'>{pageMeta.description}</p>
          </div>
        </div>

        <div className='flex shrink-0 items-center gap-3'>
          <div className={`hidden rounded-2xl border px-4 py-3 text-right xl:block ${connectionBadge.classes}`}>
            <p className='text-xs uppercase tracking-[0.25em]'>Live API</p>
            <p className='mt-1 text-sm font-medium'>{connectionBadge.title}</p>
            <p className='mt-1 text-[11px] opacity-80'>{connectionBadge.detail}</p>
          </div>

          <div className='hidden text-right md:block'>
            <p className='text-sm font-medium text-slate-900'>{todayLabel}</p>
            <p className='text-xs text-slate-500'>Operational command center</p>
          </div>

          <button
            type='button'
            onClick={onRefreshServerStatus}
            className='rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-white'
          >
            Refresh API
          </button>

          <button
            type='button'
            onClick={() => {
              setToken();
            }}
            className='rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800'
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
