import React, { memo, useEffect, useRef } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { assets } from '../assets/assets';
import { adminNavigationSections, isNavItemActive } from '../config/navigation';

const SidebarIcon = ({ icon, active }) => {
  const iconClassName = active ? 'text-white' : 'text-slate-400';

  if (icon === 'dashboard') {
    return (
      <svg className={iconClassName} width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <path d='M4 13h7V4H4v9Zm0 7h7v-5H4v5Zm9 0h7V11h-7v9Zm0-18v7h7V2h-7Z' fill='currentColor' />
      </svg>
    );
  }

  if (icon === 'products') {
    return (
      <svg className={iconClassName} width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <path
          d='M12 3 4 7v10l8 4 8-4V7l-8-4Zm0 2.2 5.5 2.75L12 10.7 6.5 7.95 12 5.2Zm-6 4.45 5 2.5v6.6l-5-2.5V9.65Zm7 9.1v-6.6l5-2.5v6.6l-5 2.5Z'
          fill='currentColor'
        />
      </svg>
    );
  }

  if (icon === 'inventory') {
    return (
      <svg className={iconClassName} width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <path
          d='M5 5h14a1 1 0 0 1 1 1v10.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5V6a1 1 0 0 1 1-1Zm1 3v8.5c0 .83.67 1.5 1.5 1.5H17a1 1 0 0 0 1-1V8H6Zm3 2h6v2H9v-2Zm0 4h4v2H9v-2Z'
          fill='currentColor'
        />
      </svg>
    );
  }

  if (icon === 'create') {
    return (
      <svg className={iconClassName} width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <path d='M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z' fill='currentColor' />
      </svg>
    );
  }

  if (icon === 'customers') {
    return (
      <svg className={iconClassName} width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <path
          d='M16 11a4 4 0 1 0-3.999-4A4 4 0 0 0 16 11Zm-8 1a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm8 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Zm-8 1c-2.33 0-7 1.17-7 3.5V20h5v-2c0-1.16.43-2.2 1.2-3H8Z'
          fill='currentColor'
        />
      </svg>
    );
  }

  if (icon === 'coupons') {
    return (
      <svg className={iconClassName} width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <path
          d='M4 7.5A2.5 2.5 0 0 1 6.5 5H20v4a2 2 0 1 0 0 4v4H6.5A2.5 2.5 0 0 1 4 14.5v-7Zm6.85 1.15L9.5 10l3 3-3 3 1.35 1.35 4.35-4.35-4.35-4.35ZM17 8h-2v2h2V8Zm0 6h-2v2h2v-2Z'
          fill='currentColor'
        />
      </svg>
    );
  }

  if (icon === 'loyalty') {
    return (
      <svg className={iconClassName} width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <path
          d='M12 3.5 14.2 8l5 .73-3.6 3.52.85 4.97L12 14.96 7.55 17.2l.85-4.97L4.8 8.73 9.8 8 12 3.5Zm0 13.2a5.8 5.8 0 0 1 5.8 5.8h-2a3.8 3.8 0 0 0-7.6 0h-2A5.8 5.8 0 0 1 12 16.7Z'
          fill='currentColor'
        />
      </svg>
    );
  }

  if (icon === 'reviews') {
    return (
      <svg className={iconClassName} width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <path
          d='M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v7A2.5 2.5 0 0 1 16.5 15H11l-4.5 4v-4H7.5A2.5 2.5 0 0 1 5 12.5v-7Zm7 1.2 1.14 2.3 2.54.37-1.84 1.79.44 2.52L12 12.55l-2.28 1.2.44-2.52-1.84-1.79 2.54-.37L12 6.7Z'
          fill='currentColor'
        />
      </svg>
    );
  }

  if (icon === 'fit') {
    return (
      <svg className={iconClassName} width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <path
          d='M8.5 4A2.5 2.5 0 0 0 6 6.5v11A2.5 2.5 0 0 0 8.5 20h7a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 15.5 4h-7Zm0 2h7a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5Zm1.75 2.25a1 1 0 1 0 0 2h3.5a1 1 0 1 0 0-2h-3.5ZM9 13a3 3 0 1 0 6 0 3 3 0 0 0-6 0Zm2 0a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z'
          fill='currentColor'
        />
      </svg>
    );
  }

  if (icon === 'marketing') {
    return (
      <svg className={iconClassName} width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <path
          d='M4 8.5A2.5 2.5 0 0 1 6.5 6H20v10H6.5A2.5 2.5 0 0 1 4 13.5v-5Zm3.5-.5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1H18V8H7.5Zm-2 10h5v2h-5v-2Zm8.8-7.2 1.65 1.65 3.45-3.45-1.4-1.4-2.05 2.04-.95-.94-1.7 1.7Z'
          fill='currentColor'
        />
      </svg>
    );
  }

  return (
    <svg className={iconClassName} width='18' height='18' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
      <path
        d='M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 17.5v-11Zm2 0v2h10v-2h-10Zm0 4v7h10v-7H7Zm2 1.5h6v2H9v-2Z'
        fill='currentColor'
      />
    </svg>
  );
};

const Sidebar = ({ isOpen, onClose, serverStatus, serverBootstrap }) => {
  const location = useLocation();
  const previousPathnameRef = useRef(location.pathname);

  // Connection chips (replaces the old run-on summary line — see
  // ADMIN_UI_OPTIMIZATION_PLAN §2.1 step 4).
  const connectionDots = [
    {
      label: 'API',
      tone: serverStatus === 'online' ? 'on' : serverStatus === 'offline' ? 'off' : 'pending',
      tooltip:
        serverStatus === 'online'
          ? 'Admin API reachable'
          : serverStatus === 'offline'
            ? 'Admin API unreachable'
            : 'Verifying admin API',
    },
    {
      label: 'Payments',
      tone:
        serverStatus !== 'online'
          ? 'pending'
          : serverBootstrap?.payments?.razorpayEnabled
            ? 'on'
            : 'off',
      tooltip: `Razorpay ${serverBootstrap?.payments?.razorpayEnabled ? 'on' : 'off'}`,
    },
    {
      label: 'Email',
      tone: serverStatus !== 'online' ? 'pending' : 'on',
      tooltip: `Mode: ${serverBootstrap?.integrations?.marketingEmailMode || 'simulation'}`,
    },
  ];

  useEffect(() => {
    if (isOpen && previousPathnameRef.current !== location.pathname) {
      onClose?.();
    }

    previousPathnameRef.current = location.pathname;
  }, [isOpen, location.pathname, onClose]);

  return (
    <>
      <button
        type='button'
        onClick={onClose}
        aria-label='Close sidebar overlay'
        className={`fixed inset-0 z-30 bg-slate-950/45 transition-opacity duration-300 lg:hidden ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col overflow-hidden border-r border-slate-200 bg-slate-950 text-white shadow-2xl transition-transform duration-300 lg:relative lg:h-screen lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className='border-b border-white/10 px-4 py-4'>
          <div className='flex items-start justify-between gap-3'>
            <Link to='/dashboard' className='flex items-center gap-3'>
              <div className='flex h-10 w-10 items-center justify-center rounded-2xl bg-white/8 ring-1 ring-white/10'>
                <img className='h-8 w-8 object-contain' src={assets.Alogo} alt='Lavish Fashion' />
              </div>
              <div>
                <p className='text-[10px] uppercase tracking-[0.28em] text-slate-400'>Lavish Fashion</p>
                <p className='mt-1 text-lg font-semibold text-white'>Admin OS</p>
              </div>
            </Link>

            <button
              type='button'
              onClick={onClose}
              className='rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-300 lg:hidden'
            >
              Close
            </button>
          </div>
        </div>

        <div className='flex-1 overflow-y-auto px-3 py-4'>
          <div className='mb-5 rounded-2xl border border-white/10 bg-white/5 px-3 py-3'>
            <p className='text-[11px] uppercase tracking-[0.22em] text-slate-400'>Connection</p>
            <div className='mt-2 flex items-center gap-3'>
              {connectionDots.map((dot) => (
                <div
                  key={dot.label}
                  className='flex items-center gap-1.5 text-xs text-slate-300'
                  title={dot.tooltip}
                >
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      dot.tone === 'on'
                        ? 'bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.18)]'
                        : dot.tone === 'off'
                          ? 'bg-rose-400 shadow-[0_0_0_3px_rgba(251,113,133,0.18)]'
                          : 'bg-amber-300 shadow-[0_0_0_3px_rgba(252,211,77,0.18)]'
                    }`}
                    aria-hidden='true'
                  />
                  <span>{dot.label}</span>
                </div>
              ))}
            </div>
          </div>

          <nav className='space-y-6'>
            {adminNavigationSections.map((section) => (
              <div key={section.label}>
                <p className='px-3 text-[11px] uppercase tracking-[0.24em] text-slate-500'>{section.label}</p>
                <div className='mt-2 space-y-1.5'>
                  {section.items.map((item) => {
                    const active = isNavItemActive(location.pathname, item.to);

                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={`group flex items-start gap-3 rounded-2xl px-3 py-2.5 transition ${
                          active
                            ? 'bg-white text-slate-950 shadow-lg'
                            : 'text-slate-200 hover:bg-white/7 hover:text-white'
                        }`}
                      >
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${
                            active ? 'bg-slate-900 text-white' : 'bg-white/6'
                          }`}
                        >
                          <SidebarIcon icon={item.icon} active={active} />
                        </div>
                        <div className='min-w-0 flex-1'>
                          <p className='text-sm font-medium leading-tight'>{item.label}</p>
                          {/*
                            Always-visible description — previously only shown
                            when active (ADMIN_UI_OPTIMIZATION_PLAN §2.1 step 3).
                          */}
                          <p
                            className={`mt-0.5 line-clamp-1 text-[11px] leading-snug ${
                              active ? 'text-slate-500' : 'text-slate-400/90'
                            }`}
                          >
                            {item.description}
                          </p>
                        </div>
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>
      </aside>
    </>
  );
};

export default memo(Sidebar);
