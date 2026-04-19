import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { BACKEND_URL } from '../config/api';

/**
 * Module-level cache shared by every useAdminQuery caller. Provides
 * stale-while-revalidate behavior and in-flight request deduplication.
 */
const queryCache = new Map(); // key -> { data, timestamp }
const inFlight = new Map(); // key -> Promise

const serializeKey = (key) => {
  if (typeof key === 'string') return key;
  try {
    return JSON.stringify(key);
  } catch {
    return String(key);
  }
};

const getStoredAdminToken = () => {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem('adminToken') || '';
  } catch {
    return '';
  }
};

/**
 * Wrap an admin API fetch with consistent token injection, in-flight dedupe,
 * stale-while-revalidate cache, and a toast on failure.
 *
 * Usage:
 *   const { data, isLoading, error, refetch } = useAdminQuery(
 *     ['orders', filters],
 *     ({ token, signal }) => axios.get(`${BACKEND_URL}/api/order/list`, {
 *       headers: { token }, signal,
 *     }).then((r) => r.data),
 *     { token, enabled: Boolean(token) },
 *   );
 *
 * Refactored pages use this in place of the bespoke
 * `setIsLoading(true) / try / finally` block they each currently maintain.
 */
const useAdminQuery = (
  key,
  fetcher,
  {
    token,
    enabled = true,
    refetchOnMount = true,
    staleTime = 30_000,
    onSuccess,
    onError,
    suppressErrorToast = false,
    errorMessage,
  } = {}
) => {
  const cacheKey = serializeKey(key);
  const cached = queryCache.get(cacheKey);
  const [data, setData] = useState(cached?.data ?? null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(!cached && enabled);
  const [isFetching, setIsFetching] = useState(false);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const run = useCallback(
    async ({ force = false } = {}) => {
      if (!enabled) return undefined;

      const existing = queryCache.get(cacheKey);
      const isFresh = existing && Date.now() - existing.timestamp < staleTime;
      if (existing) setData(existing.data);
      if (isFresh && !force) {
        setIsLoading(false);
        return existing.data;
      }

      const inFlightPromise = inFlight.get(cacheKey);
      if (inFlightPromise) {
        try {
          const result = await inFlightPromise;
          setData(result);
          setIsLoading(false);
          return result;
        } catch (err) {
          setError(err);
          setIsLoading(false);
          throw err;
        }
      }

      const controller = new AbortController();
      const effectiveToken = token ?? getStoredAdminToken();
      setIsFetching(true);
      const promise = Promise.resolve(
        fetcherRef.current({ token: effectiveToken, signal: controller.signal })
      )
        .then((result) => {
          queryCache.set(cacheKey, { data: result, timestamp: Date.now() });
          setData(result);
          setError(null);
          onSuccessRef.current?.(result);
          return result;
        })
        .catch((err) => {
          if (axios.isCancel?.(err) || err?.name === 'CanceledError') {
            throw err;
          }
          setError(err);
          if (!suppressErrorToast) {
            const message =
              errorMessage || err?.response?.data?.message || err?.message || 'Request failed';
            toast.error(message);
          }
          onErrorRef.current?.(err);
          throw err;
        })
        .finally(() => {
          setIsLoading(false);
          setIsFetching(false);
          inFlight.delete(cacheKey);
        });

      inFlight.set(cacheKey, promise);
      try {
        return await promise;
      } catch {
        return undefined;
      }
    },
    [cacheKey, enabled, errorMessage, staleTime, suppressErrorToast, token]
  );

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    if (refetchOnMount || !queryCache.has(cacheKey)) {
      run();
    }
  }, [cacheKey, enabled, refetchOnMount, run]);

  const refetch = useCallback(() => run({ force: true }), [run]);

  const mutate = useCallback(
    (updater) => {
      setData((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        queryCache.set(cacheKey, { data: next, timestamp: Date.now() });
        return next;
      });
    },
    [cacheKey]
  );

  return { data, error, isLoading, isFetching, refetch, mutate };
};

export const invalidateAdminQuery = (key) => {
  const cacheKey = serializeKey(key);
  queryCache.delete(cacheKey);
};

export const clearAdminQueryCache = () => {
  queryCache.clear();
  inFlight.clear();
};

export const peekAdminQueryCache = (key) => queryCache.get(serializeKey(key))?.data;

export { BACKEND_URL };
export default useAdminQuery;
