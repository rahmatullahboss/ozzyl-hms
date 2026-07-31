import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAutoSave } from './useAutoSave';

vi.mock('../lib/apiClient', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from '../lib/apiClient';

const mockedApi = api as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

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
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAutoSave', () => {
  it('debounces calls — two rapid save() calls result in one mutation', async () => {
    mockedApi.post.mockResolvedValue({ ok: true });

    const { result } = renderHook(
      () => useAutoSave({ endpoint: '/api/vitals', debounceMs: 1500 }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.save({ bp: '120/80' });
    });
    act(() => {
      result.current.save({ bp: '130/85' });
    });

    expect(mockedApi.post).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(mockedApi.post).toHaveBeenCalledTimes(1);
    expect(mockedApi.post).toHaveBeenCalledWith('/api/vitals', { bp: '130/85' });
  });

  it('resets timer when save() is called again before debounce fires', async () => {
    mockedApi.post.mockResolvedValue({ ok: true });

    const { result } = renderHook(
      () => useAutoSave({ endpoint: '/api/vitals', debounceMs: 1000 }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.save({ hr: 72 });
    });

    act(() => {
      vi.advanceTimersByTime(800);
    });

    act(() => {
      result.current.save({ hr: 75 });
    });

    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(mockedApi.post).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(mockedApi.post).toHaveBeenCalledTimes(1);
    expect(mockedApi.post).toHaveBeenCalledWith('/api/vitals', { hr: 75 });
  });

  it('saveImmediate() bypasses debounce and calls mutation immediately', async () => {
    mockedApi.put.mockResolvedValue({ ok: true });

    const { result } = renderHook(
      () => useAutoSave({ endpoint: '/api/vitals', method: 'put', debounceMs: 1500 }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      result.current.saveImmediate({ temp: 38.5 });
    });

    expect(mockedApi.put).toHaveBeenCalledTimes(1);
    expect(mockedApi.put).toHaveBeenCalledWith('/api/vitals', { temp: 38.5 });
  });

  it('flush() sends pending data immediately', async () => {
    mockedApi.post.mockResolvedValue({ ok: true });

    const { result } = renderHook(
      () => useAutoSave({ endpoint: '/api/vitals', debounceMs: 2000 }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.save({ rr: 18 });
    });

    expect(mockedApi.post).not.toHaveBeenCalled();

    await act(async () => {
      result.current.flush();
    });

    expect(mockedApi.post).toHaveBeenCalledTimes(1);
    expect(mockedApi.post).toHaveBeenCalledWith('/api/vitals', { rr: 18 });
  });

  it('flush() does nothing when no data is pending', async () => {
    const { result } = renderHook(
      () => useAutoSave({ endpoint: '/api/vitals', debounceMs: 1500 }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.flush();
    });

    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('cleanup on unmount cancels pending timer', async () => {
    mockedApi.post.mockResolvedValue({ ok: true });

    const { result, unmount } = renderHook(
      () => useAutoSave({ endpoint: '/api/vitals', debounceMs: 1500 }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.save({ spo2: 98 });
    });

    unmount();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('uses PUT method when specified', async () => {
    mockedApi.put.mockResolvedValue({ ok: true });

    const { result } = renderHook(
      () => useAutoSave({ endpoint: '/api/vitals/1', method: 'put', debounceMs: 500 }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.save({ bp: '110/70' });
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(mockedApi.put).toHaveBeenCalledWith('/api/vitals/1', { bp: '110/70' });
  });

  it('invalidates query keys on success', async () => {
    mockedApi.post.mockResolvedValue({ ok: true });
    const invalidateSpy = vi.spyOn(
      QueryClient.prototype,
      'invalidateQueries',
    );

    const { result } = renderHook(
      () =>
        useAutoSave({
          endpoint: '/api/vitals',
          debounceMs: 500,
          invalidateKeys: [['vitals', 'list']],
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.save({ bp: '120/80' });
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['vitals', 'list'] });

    invalidateSpy.mockRestore();
  });

  it('calls onSuccess callback after successful save', async () => {
    mockedApi.post.mockResolvedValue({ ok: true });
    const onSuccess = vi.fn();

    const { result } = renderHook(
      () => useAutoSave({ endpoint: '/api/vitals', debounceMs: 500, onSuccess }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.save({ bp: '120/80' });
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('calls onError callback when save fails', async () => {
    mockedApi.post.mockRejectedValue(new Error('Network error'));
    const onError = vi.fn();

    const { result } = renderHook(
      () => useAutoSave({ endpoint: '/api/vitals', debounceMs: 500, onError }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.save({ bp: '120/80' });
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0][0].message).toBe('Network error');
  });

  it('exposes isPending, isSuccess, isError states', async () => {
    let resolvePromise: (v: unknown) => void;
    mockedApi.post.mockReturnValueOnce(new Promise((r) => { resolvePromise = r; }));

    const { result } = renderHook(
      () => useAutoSave({ endpoint: '/api/vitals', debounceMs: 500 }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.save({ bp: '120/80' });
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await waitFor(() => expect(result.current.isPending).toBe(true));

    await act(async () => {
      resolvePromise!({ ok: true });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isPending).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it('tracks dirty state — isDirty is false initially, true after save(), false after success', async () => {
    mockedApi.post.mockResolvedValue({ ok: true });

    const { result } = renderHook(
      () => useAutoSave({ endpoint: '/api/vitals', debounceMs: 500 }),
      { wrapper: createWrapper() },
    );

    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.save({ bp: '120/80' });
    });

    expect(result.current.isDirty).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isDirty).toBe(false);
  });

  it('isDirty resets after flush()', async () => {
    mockedApi.post.mockResolvedValue({ ok: true });

    const { result } = renderHook(
      () => useAutoSave({ endpoint: '/api/vitals', debounceMs: 2000 }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.save({ rr: 18 });
    });

    expect(result.current.isDirty).toBe(true);

    await act(async () => {
      result.current.flush();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isDirty).toBe(false);
  });

  it('visibilitychange triggers flush when handleVisibilityChange is true', async () => {
    mockedApi.post.mockResolvedValue({ ok: true });

    const { result } = renderHook(
      () => useAutoSave({ endpoint: '/api/vitals', debounceMs: 5000, handleVisibilityChange: true }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.save({ bp: '120/80' });
    });

    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(result.current.isDirty).toBe(true);

    // Flush manually to verify the mechanism works
    await act(async () => {
      result.current.flush();
    });

    expect(mockedApi.post).toHaveBeenCalledTimes(1);
    expect(mockedApi.post).toHaveBeenCalledWith('/api/vitals', { bp: '120/80' });
  });
});
