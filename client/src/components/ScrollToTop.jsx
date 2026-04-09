import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Global scroll-to-top on route change.
 * Placed inside <BrowserRouter> but outside <Routes>.
 *
 * On POP (back/forward) we let the browser keep the previous
 * position for listing pages. On PUSH/REPLACE (link clicks,
 * programmatic navigate) we always reset to the top.
 */
const ScrollToTop = () => {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    // On back/forward navigation, let listing pages keep their scroll
    if (navigationType === 'POP') {
      return;
    }

    // For all forward navigations (PUSH/REPLACE), reset to top
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, navigationType]);

  return null;
};

export default ScrollToTop;
