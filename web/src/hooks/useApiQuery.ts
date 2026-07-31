import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseQueryOptions, UseMutationOptions } from '@tanstack/react-query';
import { api, getToken, getWorkstationId } from '../lib/apiClient';
import { enqueueSyncOperationEncrypted, getActiveTenantId, isSecureStoreActive } from '../lib/secure-store';
import { assertOfflineMutationAllowed, buildOfflineLocalRef } from '../lib/offlineMutationPolicy';
import { getAccessTokenClaims } from '../lib/tokenStore';

type QueryKeyT = readonly unknown[];

// Prevent dashboard/widget fan-out from polling every open tab too aggressively.
// Critical live views can still use explicit non-query transports; routine D1-backed
// dashboards are capped at one refresh per minute and pause in background tabs.
const MIN_REFETCH_INTERVAL_MS = 60_000;

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

function inferOfflineStore(path: string): string {
  const cleanPath = path.split('?')[0] ?? path;
  const match = cleanPath.match(/^\/api\/([^/]+)/);
  return match?.[1] ?? 'generic';
}

function randomSuffix(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isApiClientHttpError(error: unknown): boolean {
  return error instanceof Error
    && error.name === 'ApiClientError'
    && typeof (error as { status?: unknown }).status === 'number';
}

function isNetworkQueueableError(error: unknown): boolean {
  if (!navigator.onLine) return true;
  if (isApiClientHttpError(error)) return false;
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    return /network|failed to fetch|load failed|fetch/i.test(error.message);
  }
  return false;
}

async function enqueueOfflineMutation<TVariables>(
  method: 'post' | 'put' | 'patch' | 'delete',
  path: string,
  variables: TVariables,
): Promise<{ queued: true; offline: true; localId: string; localRef: string; idempotencyKey: string }> {
  if (!isSecureStoreActive()) {
    throw new Error('secure offline store is not active; cannot queue offline mutation safely');
  }

  assertOfflineMutationAllowed(method, path);

  const store = inferOfflineStore(path);
  const claims = getAccessTokenClaims();
  const tenantId = getActiveTenantId() ?? claims?.tenantId ?? null;
  const workstationId = getWorkstationId();
  const createdAt = Date.now();
  const localRef = buildOfflineLocalRef(store, workstationId, new Date(createdAt));
  const localId = `${localRef}-${randomSuffix()}`;
  const idempotencyKey = `browser:${workstationId}:${store}:${createdAt}:${randomSuffix()}`;

  await enqueueSyncOperationEncrypted({
    method: method.toUpperCase() as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: path,
    body: variables,
    localId,
    store,
    module: store,
    local_ref: localRef,
    queue_id: idempotencyKey,
    idempotency_key: idempotencyKey,
    original_tenant_id: tenantId,
    original_user_id: claims?.userId ?? null,
    original_workstation_id: workstationId,
    original_session_id: null,
    created_at: createdAt,
  }, tenantId);

  window.dispatchEvent(new CustomEvent('hms:sync:queued', {
    detail: { store, localId, localRef, idempotencyKey },
  }));

  return {
    queued: true,
    offline: true,
    localId,
    localRef,
    idempotencyKey,
  };
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
  options?: Omit<UseMutationOptions<TData, Error, TVariables>, 'mutationFn'> & {
    /** When true, failed network mutations are queued for offline replay */
    offline?: boolean;
    /** Removes URL-only routing fields from the JSON request body. */
    body?: (variables: TVariables) => unknown;
    /** Abort a transport request after this duration so mutations cannot stay pending forever. */
    timeoutMs?: number;
  },
) {
  const {
    offline: enableOffline,
    body: selectBody,
    timeoutMs,
    ...restOptions
  } = options ?? {};

  return useMutation<TData, Error, TVariables>({
    mutationFn: async (variables: TVariables) => {
      const path = typeof pathOrFn === 'function' ? pathOrFn(variables) : pathOrFn;
      const requestBody = selectBody
        ? selectBody(variables)
        : method === 'delete'
          ? undefined
          : variables;
      try {
        if (method === 'delete') {
          return timeoutMs
            ? await api.delete<TData>(path, requestBody, timeoutMs)
            : requestBody === undefined
              ? await api.delete<TData>(path)
              : await api.delete<TData>(path, requestBody);
        }
        if (timeoutMs) {
          if (method === 'post') return await api.post<TData>(path, requestBody, undefined, timeoutMs);
          if (method === 'put') return await api.put<TData>(path, requestBody, timeoutMs);
          return await api.patch<TData>(path, requestBody, timeoutMs);
        }
        return await api[method]<TData>(path, requestBody);
      } catch (error) {
        if (enableOffline && isNetworkQueueableError(error)) {
          return await enqueueOfflineMutation(method, path, requestBody) as unknown as TData;
        }
        throw error;
      }
    },
    ...restOptions,
  });
}

export { useQueryClient };
