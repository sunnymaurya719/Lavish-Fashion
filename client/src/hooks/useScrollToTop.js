import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Reusable hook that scrolls to the top of the page whenever
 * any value in the `deps` array changes.  Falls back to the
 * current pathname when no deps are supplied.
 */
const useScrollToTop = (deps) => {
  const { pathname } = useLocation();
  const watchList = deps || [pathname];

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, watchList);
};

export default useScrollToTop;
