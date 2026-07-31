import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { trackPageView } from '@/utils/analytics';

/**
 * Tracks page views on every route change in the SPA.
 * Place this hook once in your App component.
 *
 * Usage:
 *   function App() {
 *     useAnalytics();
 *     return <Routes>...</Routes>;
 *   }
 */
export function useAnalytics(): void {
  const location = useLocation();

  useEffect(() => {
    trackPageView(location.pathname + location.search);
  }, [location.pathname, location.search]);
}
