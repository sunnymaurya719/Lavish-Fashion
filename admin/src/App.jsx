import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import { BACKEND_URL } from './config/api';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import Login from './components/Login';
import Add from './pages/Add';
import Coupons from './pages/Coupons';
import Customers from './pages/Customers';
import Dashboard from './pages/Dashboard';
import Edit from './pages/Edit';
import Inventory from './pages/Inventory';
import List from './pages/List';
import Loyalty from './pages/Loyalty';
import Marketing from './pages/Marketing';
import Orders from './pages/Orders';
import Reviews from './pages/Reviews';
import 'react-toastify/dist/ReactToastify.css';

const LegacyEditRedirect = () => {
  const { productId } = useParams();
  return <Navigate to={`/products/${productId}/edit`} replace />;
};

const App = () => {
  const [token, setToken] = useState(localStorage.getItem('adminToken') || '');
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
      localStorage.removeItem('adminToken');

      if (message) {
        toast.info(message);
      }
    },
    []
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
    if (token) {
      localStorage.setItem('adminToken', token);
      return;
    }

    localStorage.removeItem('adminToken');
  }, [token]);

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
      <ToastContainer position='top-right' autoClose={3000} />
      {token === '' ? (
        <Login
          setToken={setToken}
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
              <Routes>
                <Route path='/' element={<Navigate to='/dashboard' replace />} />
                <Route
                  path='/dashboard'
                  element={
                    <Dashboard
                      token={token}
                      serverStatus={serverStatus}
                      serverBootstrap={serverBootstrap}
                      onRefreshServerStatus={() => fetchServerBootstrap()}
                    />
                  }
                />
                <Route path='/products' element={<List token={token} />} />
                <Route
                  path='/products/new'
                  element={<Add token={token} serverBootstrap={serverBootstrap} serverStatus={serverStatus} />}
                />
                <Route
                  path='/products/:productId/edit'
                  element={<Edit token={token} serverBootstrap={serverBootstrap} serverStatus={serverStatus} />}
                />
                <Route path='/inventory' element={<Inventory token={token} />} />
                <Route path='/orders' element={<Orders token={token} />} />
                <Route path='/customers' element={<Customers token={token} />} />
                <Route path='/coupons' element={<Coupons token={token} />} />
                <Route path='/loyalty' element={<Loyalty token={token} />} />
                <Route path='/reviews' element={<Reviews token={token} />} />
                <Route path='/marketing' element={<Marketing token={token} />} />
                <Route path='/add' element={<Navigate to='/products/new' replace />} />
                <Route path='/edit/:productId' element={<LegacyEditRedirect />} />
                <Route path='/list' element={<Navigate to='/products' replace />} />
                <Route path='*' element={<Navigate to='/dashboard' replace />} />
              </Routes>
            </main>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
