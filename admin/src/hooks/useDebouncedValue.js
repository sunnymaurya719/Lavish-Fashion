import { useEffect, useState } from 'react';

/**
 * Returns a value that only updates after the given delay has elapsed without
 * the source value changing. Used to debounce search inputs (currently many
 * pages filter every keystroke against the full in-memory list).
 */
const useDebouncedValue = (value, delay = 200) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);

  return debounced;
};

export default useDebouncedValue;
