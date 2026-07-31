import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '../lib/apiClient';

export function usePrefetch() {
  const queryClient = useQueryClient();

  const prefetch = useCallback(
    (queryKey: string[], url: string) => {
      queryClient.prefetchQuery({
        queryKey,
        queryFn: () => apiFetch(url),
        staleTime: 30_000,
      });
    },
    [queryClient],
  );

  return prefetch;
}
