import { useCallback, useEffect, useRef, useState } from 'react';

const safeParse = (raw, fallback) => {
  try {
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
};

/**
 * useState that mirrors its value into localStorage so an agent's filter /
 * segment / column choices survive a refresh.
 *
 * - SSR safe (initial value used when window is undefined).
 * - Suppresses storage failures (private mode, quota).
 */
const usePersistedState = (key, defaultValue) => {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const raw = window.localStorage.getItem(key);
      return safeParse(raw, defaultValue);
    } catch {
      return defaultValue;
    }
  });

  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(keyRef.current, JSON.stringify(value));
    } catch {
      /* ignore quota / private mode errors */
    }
  }, [value]);

  const reset = useCallback(() => setValue(defaultValue), [defaultValue]);

  return [value, setValue, reset];
};

export default usePersistedState;
