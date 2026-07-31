import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useApiQuery, useApiMutation } from './useApiQuery';

vi.mock('../lib/apiClient', () => ({
  getToken: vi.fn(() => 'token-a'),
  getWorkstationId: vi.fn(() => 'hms-ws-a'),
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../lib/secure-store', () => ({
  enqueueSyncOperationEncrypted: vi.fn(() => Promise.resolve(1)),
  getActiveTenantId: vi.fn(() => 'tenant-a'),
  isSecureStoreActive: vi.fn(() => true),
}));

vi.mock('../lib/tokenStore', () => ({
  getAccessTokenClaims: vi.fn(() => ({
    userId: 'user-a',
    role: 'reception',
    tenantId: 'tenant-a',
    permissions: [],
  })),
}));

import { api, getToken } from '../lib/apiClient';
import { enqueueSyncOperationEncrypted, isSecureStoreActive } from '../lib/secure-store';

const mockedApi = api as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};
const mockedGetToken = getToken as ReturnType<typeof vi.fn>;
const mockedEnqueueSyncOperationEncrypted = enqueueSyncOperationEncrypted as ReturnType<typeof vi.fn>;
const mockedIsSecureStoreActive = isSecureStoreActive as ReturnType<typeof vi.fn>;

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetToken.mockReturnValue('token-a');
  mockedIsSecureStoreActive.mockReturnValue(true);
  mockedEnqueueSyncOperationEncrypted.mockResolvedValue(1);
  setNavigatorOnline(true);
});

// ─── useApiQuery ─────────────────────────────────────────────────────────────

describe('useApiQuery', () => {
  it('fetches data via api.get and returns it', async () => {
    mockedApi.get.mockResolvedValueOnce({ patients: [{ id: 1, name: 'Test' }] });

    const { result } = renderHook(
      () => useApiQuery<{ patients: { id: number; name: string }[] }>(
        ['patients', 'list'],
        '/api/patients',
      ),
      { wrapper: createWrapper() },
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedApi.get).toHaveBeenCalledWith('/api/patients');
    expect(result.current.data?.patients).toHaveLength(1);
    expect(result.current.data?.patients[0].name).toBe('Test');
  });

  it('returns error state when api.get rejects', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(
      () => useApiQuery(['fail-key'], '/api/fail'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe('Network error');
  });

  it('respects enabled option', async () => {
    const { result } = renderHook(
      () => useApiQuery(['disabled-key'], '/api/disabled', { enabled: false }),
      { wrapper: createWrapper() },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('uses different cache for different query keys', async () => {
    mockedApi.get
      .mockResolvedValueOnce({ type: 'a' })
      .mockResolvedValueOnce({ type: 'b' });

    const wrapper = createWrapper();

    const { result: r1 } = renderHook(
      () => useApiQuery(['key-a'], '/api/a'),
      { wrapper },
    );
    const { result: r2 } = renderHook(
      () => useApiQuery(['key-b'], '/api/b'),
      { wrapper },
    );

    await waitFor(() => {
      expect(r1.current.isSuccess).toBe(true);
      expect(r2.current.isSuccess).toBe(true);
    });

    expect(r1.current.data).toEqual({ type: 'a' });
    expect(r2.current.data).toEqual({ type: 'b' });
  });

  it('does not reuse cached GET data after the auth token changes', async () => {
    mockedApi.get
      .mockResolvedValueOnce({ active: false })
      .mockResolvedValueOnce({ active: true });

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      () => useApiQuery<{ active: boolean }>(
        ['billing-counter', 'active-session'],
        '/api/billing-counter/sessions/active',
      ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toEqual({ active: false }));

    mockedGetToken.mockReturnValue('token-b');
    rerender();

    await waitFor(() => expect(result.current.data).toEqual({ active: true }));
    expect(mockedApi.get).toHaveBeenCalledTimes(2);
  });
});

// ─── useApiMutation ──────────────────────────────────────────────────────────

describe('useApiMutation', () => {
  it('calls api.post with correct path and variables', async () => {
    mockedApi.post.mockResolvedValueOnce({ id: 1 });

    const { result } = renderHook(
      () => useApiMutation<{ id: number }, { name: string }>('post', '/api/patients'),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.mutate({ name: 'New Patient' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedApi.post).toHaveBeenCalledWith('/api/patients', { name: 'New Patient' });
    expect(result.current.data).toEqual({ id: 1 });
  });

  it('uses dynamic path function', async () => {
    mockedApi.put.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(
      () => useApiMutation<{ ok: boolean }, { id: number; status: string }>(
        'put',
        (vars) => `/api/appointments/${vars.id}`,
      ),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.mutate({ id: 42, status: 'completed' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedApi.put).toHaveBeenCalledWith(
      '/api/appointments/42',
      { id: 42, status: 'completed' },
    );
  });

  it('calls api.delete without body', async () => {
    mockedApi.delete.mockResolvedValueOnce({ deleted: true });

    const { result } = renderHook(
      () => useApiMutation<{ deleted: boolean }, void>('delete', '/api/items/1'),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.mutate(undefined as unknown as void);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedApi.delete).toHaveBeenCalledWith('/api/items/1');
  });

  it('returns error state on failure', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('Validation failed'));

    const { result } = renderHook(
      () => useApiMutation('post', '/api/fail'),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.mutate({});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe('Validation failed');
  });

  it('queues an offline-enabled network failure in the encrypted sync queue', async () => {
    setNavigatorOnline(false);
    mockedApi.post.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const { result } = renderHook(
      () => useApiMutation<
        { queued: true; offline: true; localId: string; localRef: string; idempotencyKey: string },
        { name: string }
      >('post', '/api/patients', { offline: true }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.mutate({ name: 'Offline Patient' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedEnqueueSyncOperationEncrypted).toHaveBeenCalledTimes(1);
    expect(mockedEnqueueSyncOperationEncrypted).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: '/api/patients',
        body: { name: 'Offline Patient' },
        store: 'patients',
        original_tenant_id: 'tenant-a',
        original_user_id: 'user-a',
        original_workstation_id: 'hms-ws-a',
        local_ref: expect.stringMatching(/^OFF-PATIENTS-HMSWSA-/),
      }),
      'tenant-a',
    );
    expect(result.current.data?.offline).toBe(true);
  });

  it('does not queue HTTP validation errors while online', async () => {
    const validationError = new Error('Validation failed') as Error & { status: number };
    validationError.name = 'ApiClientError';
    validationError.status = 400;
    mockedApi.post.mockRejectedValueOnce(validationError);

    const { result } = renderHook(
      () => useApiMutation('post', '/api/fail', { offline: true }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.mutate({});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mockedEnqueueSyncOperationEncrypted).not.toHaveBeenCalled();
  });

  it('fails safely instead of queueing when secure offline store is inactive', async () => {
    setNavigatorOnline(false);
    mockedIsSecureStoreActive.mockReturnValue(false);
    mockedApi.post.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const { result } = renderHook(
      () => useApiMutation('post', '/api/patients', { offline: true }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.mutate({ name: 'Unsafe Queue' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toMatch(/secure offline store is not active/i);
    expect(mockedEnqueueSyncOperationEncrypted).not.toHaveBeenCalled();
  });

  it('blocks risky resource-locking mutations from browser offline queue', async () => {
    setNavigatorOnline(false);
    mockedApi.post.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const { result } = renderHook(
      () => useApiMutation('post', '/api/beds/101/assign', { offline: true }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.mutate({ patientId: 5 });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toMatch(/cannot be queued/i);
    expect(mockedEnqueueSyncOperationEncrypted).not.toHaveBeenCalled();
  });

  it('calls onSuccess callback', async () => {
    mockedApi.post.mockResolvedValueOnce({ id: 99 });
    const onSuccess = vi.fn();

    const { result } = renderHook(
      () => useApiMutation('post', '/api/items', { onSuccess }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.mutate({ name: 'item' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(onSuccess).toHaveBeenCalled();
    expect(onSuccess.mock.calls[0][0]).toEqual({ id: 99 });
    expect(onSuccess.mock.calls[0][1]).toEqual({ name: 'item' });
  });

  it('shows isPending during mutation', async () => {
    let resolvePromise: (v: unknown) => void;
    mockedApi.post.mockReturnValueOnce(new Promise((r) => { resolvePromise = r; }));

    const { result } = renderHook(
      () => useApiMutation('post', '/api/slow'),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      result.current.mutate({ data: 'test' });
    });

    await waitFor(() => expect(result.current.isPending).toBe(true));

    await act(async () => {
      resolvePromise!({ done: true });
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
  });
});

// ─── URL/body separation ─────────────────────────────────────────────────────

describe('useApiMutation URL/body separation', () => {
  it('sends the selected DELETE body without the URL-only id', async () => {
    mockedApi.delete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(
      () => useApiMutation(
        'delete',
        (variables: { id: string; reason: string; idempotencyKey: string }) => `/api/hr/roster/${variables.id}`,
        { body: ({ reason, idempotencyKey }) => ({ reason, idempotencyKey }) },
      ),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.mutateAsync({
        id: '1',
        reason: 'Coverage changed',
        idempotencyKey: 'cancel-1',
      });
    });

    expect(mockedApi.delete).toHaveBeenCalledWith('/api/hr/roster/1', {
      reason: 'Coverage changed',
      idempotencyKey: 'cancel-1',
    });
  });

  it('keeps ordinary DELETE requests body-less when no selector is provided', async () => {
    mockedApi.delete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(
      () => useApiMutation('delete', (variables: { id: number }) => `/api/staff/${variables.id}`),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.mutateAsync({ id: 11 });
    });

    expect(mockedApi.delete).toHaveBeenCalledWith('/api/staff/11');
  });

  it('strips routing fields from PUT JSON when a selector is provided', async () => {
    mockedApi.put.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(
      () => useApiMutation(
        'put',
        (variables: { id: number; name: string }) => `/api/staff/${variables.id}`,
        { body: ({ name }) => ({ name }) },
      ),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.mutateAsync({ id: 11, name: 'Nurse Fatima Akter' });
    });

    expect(mockedApi.put).toHaveBeenCalledWith('/api/staff/11', { name: 'Nurse Fatima Akter' });
  });
});
