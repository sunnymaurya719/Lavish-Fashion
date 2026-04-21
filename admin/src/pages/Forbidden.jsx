import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../store/authStore';

const formatRequired = (required) => {
  if (!required) return null;
  if (Array.isArray(required)) return required.join(', ');
  return String(required);
};

const Forbidden = () => {
  const location = useLocation();
  const { user } = useAuth();
  const required = formatRequired(location.state?.required);
  const from = location.state?.from || '';

  return (
    <div className='flex min-h-[60vh] items-center justify-center px-4'>
      <div className='w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm'>
        <div className='mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600'>
          <svg width='28' height='28' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
            <path
              d='M12 2 1 21h22L12 2Zm0 6 7.53 13H4.47L12 8Zm-1 4v4h2v-4h-2Zm0 6v2h2v-2h-2Z'
              fill='currentColor'
            />
          </svg>
        </div>
        <h1 className='mt-5 text-2xl font-semibold text-slate-950'>Access denied</h1>
        <p className='mt-2 text-sm text-slate-500'>
          You do not have permission to view this section. Ask an administrator to grant access.
        </p>

        <dl className='mt-6 space-y-2 rounded-2xl bg-slate-50 p-4 text-left text-xs text-slate-600'>
          <div className='flex justify-between gap-3'>
            <dt className='font-medium text-slate-500'>Signed in as</dt>
            <dd className='truncate text-slate-900'>{user?.email || 'unknown'}</dd>
          </div>
          <div className='flex justify-between gap-3'>
            <dt className='font-medium text-slate-500'>Role</dt>
            <dd className='text-slate-900'>{user?.role || '—'}</dd>
          </div>
          {required ? (
            <div className='flex justify-between gap-3'>
              <dt className='font-medium text-slate-500'>Required permission</dt>
              <dd className='font-mono text-slate-900'>{required}</dd>
            </div>
          ) : null}
          {from ? (
            <div className='flex justify-between gap-3'>
              <dt className='font-medium text-slate-500'>Attempted route</dt>
              <dd className='font-mono text-slate-900'>{from}</dd>
            </div>
          ) : null}
        </dl>

        <Link
          to='/dashboard'
          className='mt-6 inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800'
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
};

export default Forbidden;
