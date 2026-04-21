import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import { BACKEND_URL } from './config/api';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import Login from './components/Login';
import RequirePermission from './components/RequirePermission';
import { useAuth } from './store/authStore';
import 'react-toastify/dist/ReactToastify.css';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const List = lazy(() => import('./pages/List'));
const Add = lazy(() => import('./pages/Add'));
const Edit = lazy(() => import('./pages/Edit'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Orders = lazy(() => import('./pages/Orders'));
const Customers = lazy(() => import('./pages/Customers'));
const Coupons = lazy(() => import('./pages/Coupons'));
const Loyalty = lazy(() => import('./pages/Loyalty'));
const FitAnalytics = lazy(() => import('./pages/FitAnalytics'));
const Reviews = lazy(() => import('./pages/Reviews'));
const Marketing = lazy(() => import('./pages/Marketing'));
const Users = lazy(() => import('./pages/Users'));
const Forbidden = lazy(() => import('./pages/Forbidden'));

const AdminRouteFallback = () => (
  <div className='flex h-64 items-center justify-center'>
    <div className='h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-600'></div>
  </div>
);

const LegacyEditRedirect = () => {
  const { productId } = useParams();
  return <Navigate to={`/products/${productId}/edit`} replace />;
};

const App = () => {
  const { token, setToken } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [serverBootstrap, setServerBootstrap] = useState(null);
  const [serverStatus, setServerStatus] = useState('checking');
  const [lastServerSyncAt, setLastServerSyncAt] = useState('');
  const authExpiryHandledRef = useRef(false);
  const openSidebar = useCallback(() => setIsSidebarOpen(true), []);
  const closeSidebar = useCallback(() => setIsSidebarOpen(false), []);
  const clearAdminSession = useCallback(
    ({ message = '' } = {}) => {
      setToken('');

      if (message) {
        toast.info(message);
      }
    },
    [setToken]
  );

  const fetchServerBootstrap = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setServerStatus('checking');
      }

      try {
        const response = await axios.get(BACKEND_URL + '/api/system/bootstrap');

        if (!response.data.success) {
          throw new Error(response.data.message || 'Unable to fetch server bootstrap');
        }

        const bootstrap = response.data.bootstrap || null;
        setServerBootstrap(bootstrap);
        setServerStatus('online');
        setLastServerSyncAt(bootstrap?.runtime?.timestamp || new Date().toISOString());
        return bootstrap;
      } catch (error) {
        setServerStatus('offline');

        if (!silent) {
          toast.error(error?.response?.data?.message || 'Unable to connect to the server');
        }

        return null;
      }
    },
    []
  );

  useEffect(() => {
    fetchServerBootstrap({ silent: true });
  }, [fetchServerBootstrap]);

  useEffect(() => {
    authExpiryHandledRef.current = false;
  }, [token]);

  useEffect(() => {
    const interceptorId = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const statusCode = Number(error?.response?.status || 0);
        const requestUrl = String(error?.config?.url || '');
        const isAdminApiRequest =
          requestUrl.includes('/api/') && !requestUrl.includes('/api/user/admin') && requestUrl.includes(BACKEND_URL);

        if (token && (statusCode === 401 || statusCode === 403) && isAdminApiRequest && !authExpiryHandledRef.current) {
          authExpiryHandledRef.current = true;
          clearAdminSession({ message: 'Your admin session expired. Please login again.' });
        }

        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.response.eject(interceptorId);
    };
  }, [clearAdminSession, token]);

  return (
    <div className='min-h-screen bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.18),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#f1f5f9_100%)]'>
      {/*
        Toast policy (ADMIN_UI_OPTIMIZATION_PLAN §1.4):
          - Default auto-close raised from 3s → 6s so agents on slow networks
            can read success messages.
          - Errors are configured per-toast with autoClose:false at the call
            site where appropriate; defaultOptions keep the existing 6s timing
            so we don't accidentally hold older toast call-sites open forever.
      */}
      <ToastContainer
        position='top-right'
        autoClose={6000}
        closeOnClick
        pauseOnHover
        pauseOnFocusLoss
        newestOnTop
        theme='light'
      />
      {token === '' ? (
        <Login
          serverStatus={serverStatus}
          serverBootstrap={serverBootstrap}
          onRetryConnection={() => fetchServerBootstrap()}
        />
      ) : (
        <div className='h-screen overflow-hidden lg:grid lg:grid-cols-[280px_1fr]'>
          <Sidebar
            isOpen={isSidebarOpen}
            onClose={closeSidebar}
            serverStatus={serverStatus}
            serverBootstrap={serverBootstrap}
          />
          <div className='flex h-full min-h-0 flex-col overflow-hidden'>
            <Navbar
              setToken={() => clearAdminSession()}
              onOpenSidebar={openSidebar}
              serverStatus={serverStatus}
              serverBootstrap={serverBootstrap}
              lastServerSyncAt={lastServerSyncAt}
              onRefreshServerStatus={() => fetchServerBootstrap()}
            />
            <main className='mx-auto flex-1 w-full min-h-0 max-w-[1600px] overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 xl:px-10'>
              <Suspense fallback={<AdminRouteFallback />}>
              <Routes>
                <Route path='/' element={<Navigate to='/dashboard' replace />} />
                <Route path='/forbidden' element={<Forbidden />} />
                <Route
                  path='/dashboard'
                  element={
                    <RequirePermission permission='dashboard.view'>
                      <Dashboard
                        token={token}
                        serverStatus={serverStatus}
                        serverBootstrap={serverBootstrap}
                        onRefreshServerStatus={() => fetchServerBootstrap()}
                      />
                    </RequirePermission>
                  }
                />
                <Route
                  path='/products'
                  element={
                    <RequirePermission permission='products.view'>
                      <List token={token} />
                    </RequirePermission>
                  }
                />
                <Route
                  path='/products/new'
                  element={
                    <RequirePermission permission='products.create'>
                      <Add token={token} serverBootstrap={serverBootstrap} serverStatus={serverStatus} />
                    </RequirePermission>
                  }
                />
                <Route
                  path='/products/:productId/edit'
                  element={
                    <RequirePermission permission='products.update'>
                      <Edit token={token} serverBootstrap={serverBootstrap} serverStatus={serverStatus} />
                    </RequirePermission>
                  }
                />
                <Route
                  path='/inventory'
                  element={
                    <RequirePermission permission='inventory.view'>
                      <Inventory token={token} />
                    </RequirePermission>
                  }
                />
                <Route
                  path='/orders'
                  element={
                    <RequirePermission permission='orders.view'>
                      <Orders token={token} />
                    </RequirePermission>
                  }
                />
                <Route
                  path='/customers'
                  element={
                    <RequirePermission permission='customers.view'>
                      <Customers token={token} />
                    </RequirePermission>
                  }
                />
                <Route
                  path='/coupons'
                  element={
                    <RequirePermission permission='coupons.view'>
                      <Coupons token={token} />
                    </RequirePermission>
                  }
                />
                <Route
                  path='/loyalty'
                  element={
                    <RequirePermission permission='loyalty.view'>
                      <Loyalty token={token} />
                    </RequirePermission>
                  }
                />
                <Route
                  path='/fit-analytics'
                  element={
                    <RequirePermission permission='analytics.view'>
                      <FitAnalytics
                        token={token}
                        serverStatus={serverStatus}
                        serverBootstrap={serverBootstrap}
                        onRefreshServerStatus={() => fetchServerBootstrap()}
                      />
                    </RequirePermission>
                  }
                />
                <Route
                  path='/reviews'
                  element={
                    <RequirePermission permission='reviews.view'>
                      <Reviews token={token} />
                    </RequirePermission>
                  }
                />
                <Route
                  path='/marketing'
                  element={
                    <RequirePermission permission='marketing.view'>
                      <Marketing token={token} />
                    </RequirePermission>
                  }
                />
                <Route
                  path='/users'
                  element={
                    <RequirePermission permission='users.view'>
                      <Users token={token} />
                    </RequirePermission>
                  }
                />
                <Route path='/add' element={<Navigate to='/products/new' replace />} />
                <Route path='/edit/:productId' element={<LegacyEditRedirect />} />
                <Route path='/list' element={<Navigate to='/products' replace />} />
                <Route path='*' element={<Navigate to='/dashboard' replace />} />
              </Routes>
              </Suspense>
            </main>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
