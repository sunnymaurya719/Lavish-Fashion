/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import axios from 'axios';
import { BACKEND_URL } from '../config/api';

const TOKEN_STORAGE_KEY = 'adminToken';
const PERMISSION_WILDCARD = '*';

const AuthContext = createContext(null);

const grantSatisfies = (grant, requested) => {
  if (grant === PERMISSION_WILDCARD) return true;
  if (grant === requested) return true;
  const dot = grant.indexOf('.');
  if (dot > 0 && grant.slice(dot + 1) === '*') {
    const moduleName = grant.slice(0, dot);
    return String(requested).startsWith(`${moduleName}.`);
  }
  return false;
};

const userHas = (grants, requested) => {
  if (!Array.isArray(grants) || grants.length === 0) return false;
  return grants.some((g) => grantSatisfies(String(g || ''), requested));
};

const readStoredToken = () => {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
};

const writeStoredToken = (token) => {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
};

const AuthProvider = ({ children }) => {
  const [token, setTokenState] = useState(() => readStoredToken());
  const [user, setUser] = useState(null);
  const [isLoadingUser, setIsLoadingUser] = useState(false);
  const [authError, setAuthError] = useState(null);
  const fetchInFlight = useRef(false);

  const setToken = useCallback((nextToken) => {
    writeStoredToken(nextToken || '');
    setTokenState(nextToken || '');
    if (!nextToken) {
      setUser(null);
      setAuthError(null);
    }
  }, []);

  const fetchProfile = useCallback(
    async (overrideToken) => {
      const activeToken = overrideToken || token;
      if (!activeToken || fetchInFlight.current) return null;
      fetchInFlight.current = true;
      setIsLoadingUser(true);
      try {
        const response = await axios.get(`${BACKEND_URL}/api/admin/users/me`, {
          headers: { Authorization: `Bearer ${activeToken}` }
        });
        if (response.data?.success && response.data.user) {
          setUser(response.data.user);
          setAuthError(null);
          return response.data.user;
        }
        setUser(null);
        return null;
      } catch (error) {
        const status = Number(error?.response?.status || 0);
        if (status === 401 || status === 403) {
          // Token is invalid / disabled — wipe state.
          setToken('');
        }
        setAuthError(error?.response?.data?.message || error.message || 'Unable to load profile');
        return null;
      } finally {
        fetchInFlight.current = false;
        setIsLoadingUser(false);
      }
    },
    [token, setToken]
  );

  // Login + immediately load profile so consumers can rely on `user`.
  const login = useCallback(
    async ({ email, password }) => {
      const response = await axios.post(`${BACKEND_URL}/api/user/admin`, { email, password });
      if (!response.data?.success) {
        throw new Error(response.data?.message || 'Login failed');
      }
      const nextToken = response.data.token;
      writeStoredToken(nextToken);
      setTokenState(nextToken);
      // Server returns `user` for both legacy and DB admins, but we still
      // fetch /me to normalize and to refresh permissions on every login.
      if (response.data.user) {
        setUser(response.data.user);
      } else {
        await fetchProfile(nextToken);
      }
      return response.data;
    },
    [fetchProfile]
  );

  const logout = useCallback(
    (message) => {
      setToken('');
      if (message && typeof window !== 'undefined') {
        // Toast handled by App layer if needed.
      }
    },
    [setToken]
  );

  // On mount or token change, hydrate the profile.
  useEffect(() => {
    if (token && !user) {
      fetchProfile();
    }
  }, [token, user, fetchProfile]);

  const hasPermission = useCallback(
    (permission) => {
      if (!permission) return true;
      return userHas(user?.permissions, permission);
    },
    [user]
  );

  const hasAnyPermission = useCallback(
    (perms = []) => perms.some((p) => userHas(user?.permissions, p)),
    [user]
  );

  const hasAllPermissions = useCallback(
    (perms = []) => perms.every((p) => userHas(user?.permissions, p)),
    [user]
  );

  const value = useMemo(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token),
      isLoadingUser,
      authError,
      login,
      logout,
      setToken,
      refreshProfile: fetchProfile,
      hasPermission,
      hasAnyPermission,
      hasAllPermissions
    }),
    [
      token,
      user,
      isLoadingUser,
      authError,
      login,
      logout,
      setToken,
      fetchProfile,
      hasPermission,
      hasAnyPermission,
      hasAllPermissions
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
};

export { AuthProvider, useAuth, AuthContext, PERMISSION_WILDCARD };
