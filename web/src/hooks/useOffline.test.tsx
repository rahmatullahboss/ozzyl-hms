import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  getActiveTenantId: vi.fn(),
  getPendingSyncCountEncrypted: vi.fn(),
}));

vi.mock('../lib/sync-engine', () => ({
  SYNC_EVENT: {
    START: 'hms:sync:start',
    COMPLETE: 'hms:sync:complete',
    FAILED: 'hms:sync:failed',
    PROGRESS: 'hms:sync:progress',
  },
  syncEngine: {
    sync: mocks.sync,
  },
}));

vi.mock('../lib/secure-store', () => ({
  getActiveTenantId: mocks.getActiveTenantId,
  getPendingSyncCountEncrypted: mocks.getPendingSyncCountEncrypted,
}));

import { useOffline } from './useOffline';

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setNavigatorOnline(true);
  mocks.getActiveTenantId.mockReturnValue('tenant-a');
  mocks.getPendingSyncCountEncrypted.mockResolvedValue(0);
  mocks.sync.mockResolvedValue(undefined);
});

describe('useOffline', () => {
  it('loads pending count from the encrypted secure queue for the active tenant', async () => {
    mocks.getPendingSyncCountEncrypted.mockResolvedValueOnce(3);

    const { result } = renderHook(() => useOffline());

    await waitFor(() => expect(result.current.pendingCount).toBe(3));
    expect(mocks.getPendingSyncCountEncrypted).toHaveBeenCalledWith('tenant-a');
    expect(result.current.isOnline).toBe(true);
  });

  it('refreshes pending count when an offline mutation is queued or sync progresses', async () => {
    mocks.getPendingSyncCountEncrypted
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const { result } = renderHook(() => useOffline());

    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    await act(async () => {
      window.dispatchEvent(new CustomEvent('hms:sync:queued'));
    });
    await waitFor(() => expect(result.current.pendingCount).toBe(2));

    await act(async () => {
      window.dispatchEvent(new CustomEvent('hms:sync:progress'));
    });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
  });

  it('tracks syncing state and last sync time from sync events', async () => {
    const { result } = renderHook(() => useOffline());

    await act(async () => {
      window.dispatchEvent(new CustomEvent('hms:sync:start'));
    });
    expect(result.current.isSyncing).toBe(true);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('hms:sync:complete'));
    });

    expect(result.current.isSyncing).toBe(false);
    expect(result.current.lastSyncAt).toEqual(expect.any(Number));
  });

  it('tracks browser online and offline events', async () => {
    const { result } = renderHook(() => useOffline());
    expect(result.current.isOnline).toBe(true);

    await act(async () => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.isOnline).toBe(false);

    await act(async () => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.isOnline).toBe(true);
  });

  it('calls the sync engine when syncNow is requested', async () => {
    const { result } = renderHook(() => useOffline());

    await act(async () => {
      await result.current.syncNow();
    });

    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });

  it('fails closed to zero pending items if the encrypted queue is unavailable', async () => {
    mocks.getPendingSyncCountEncrypted.mockRejectedValueOnce(new Error('secure store locked'));

    const { result } = renderHook(() => useOffline());

    await waitFor(() => expect(result.current.pendingCount).toBe(0));
  });
});
