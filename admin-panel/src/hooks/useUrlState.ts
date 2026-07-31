import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * useUrlState — read/write page + search in the URL query string.
 * Returns [page, setPage, search, setSearch]. Setting search resets page to 1.
 */
export default function useUrlState() {
  const [params, setParams] = useSearchParams();

  const rawPage = parseInt(params.get('page') || '1', 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const search = params.get('search') || '';

  const setPage = useCallback(
    (next: number) => {
      const p = new URLSearchParams(params);
      if (next <= 1) p.delete('page');
      else p.set('page', String(next));
      setParams(p, { replace: true });
    },
    [params, setParams],
  );

  const setSearch = useCallback(
    (next: string) => {
      const p = new URLSearchParams(params);
      if (next) p.set('search', next);
      else p.delete('search');
      p.delete('page'); // any new search resets to first page
      setParams(p, { replace: true });
    },
    [params, setParams],
  );

  return [page, setPage, search, setSearch] as const;
}
