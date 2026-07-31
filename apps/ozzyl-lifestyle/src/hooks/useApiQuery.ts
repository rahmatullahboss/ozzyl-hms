import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseQueryOptions, UseMutationOptions } from '@tanstack/react-query';
import { api } from '../lib/apiClient';
import { getToken } from '../hooks/useAuth';

type QueryKeyT = readonly unknown[];

const MIN_REFETCH_INTERVAL_MS = 30_000;

/**
 * Workstation ID — currently a no-op (single-tenant per browser profile),
 * but kept so the query key shape matches the web app and a future
 * multi-workstation rollout won't need to rewrite cache invalidation.
 */
function getWorkstationId(): string {
  try {
    return localStorage.getItem('hms_workstation_id') ?? 'default';
  } catch {
    return 'default';
  }
}

function normalizeQueryOptions<T>(
  options?: Omit<UseQueryOptions<T, Error, T, QueryKeyT>, 'queryKey' | 'queryFn'>,
): Omit<UseQueryOptions<T, Error, T, QueryKeyT>, 'queryKey' | 'queryFn'> {
  const normalized = { ...(options ?? {}) };

  if (
    typeof normalized.refetchInterval === 'number'
    && normalized.refetchInterval > 0
    && normalized.refetchInterval < MIN_REFETCH_INTERVAL_MS
  ) {
    normalized.refetchInterval = MIN_REFETCH_INTERVAL_MS;
  }

  if (normalized.refetchOnWindowFocus === true) {
    normalized.refetchOnWindowFocus = false;
  }

  normalized.refetchIntervalInBackground = normalized.refetchIntervalInBackground ?? false;
  return normalized;
}

export function useApiQuery<T>(
  queryKey: QueryKeyT,
  path: string,
  options?: Omit<UseQueryOptions<T, Error, T, QueryKeyT>, 'queryKey' | 'queryFn'>,
) {
  const normalizedOptions = normalizeQueryOptions<T>(options);
  const scopedQueryKey = [
    ...queryKey,
    { auth: getToken() ?? 'anonymous', workstation: getWorkstationId() },
  ] as const;

  return useQuery<T, Error, T, QueryKeyT>({
    queryKey: scopedQueryKey,
    queryFn: () => api.get<T>(path),
    networkMode: 'offlineFirst',
    placeholderData: (previousData) => previousData,
    ...normalizedOptions,
  });
}

export function useApiMutation<TData = unknown, TVariables = unknown>(
  method: 'post' | 'put' | 'patch' | 'delete',
  pathOrFn: string | ((variables: TVariables) => string),
  options?: Omit<UseMutationOptions<TData, Error, TVariables>, 'mutationFn'>,
) {
  return useMutation<TData, Error, TVariables>({
    mutationFn: async (variables: TVariables) => {
      const path = typeof pathOrFn === 'function' ? pathOrFn(variables) : pathOrFn;
      if (method === 'delete') return await api.delete<TData>(path);
      return await api[method]<TData>(path, variables);
    },
    ...options,
  });
}

export { useQueryClient };
