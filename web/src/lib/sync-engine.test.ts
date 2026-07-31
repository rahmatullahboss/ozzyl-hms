import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPendingSyncQueueRowsDecrypted: vi.fn(),
  updateSyncItemAttemptEncrypted: vi.fn(),
  updatePatientSyncStatusEncrypted: vi.fn(),
  removeSyncItemEncrypted: vi.fn(),
  markSyncItemStatusEncrypted: vi.fn(),
  getActiveTenantId: vi.fn(),
  getAccessToken: vi.fn(),
}));

vi.mock('./secure-store', () => ({
  getPendingSyncQueueRowsDecrypted: mocks.getPendingSyncQueueRowsDecrypted,
  updateSyncItemAttemptEncrypted: mocks.updateSyncItemAttemptEncrypted,
  updatePatientSyncStatusEncrypted: mocks.updatePatientSyncStatusEncrypted,
  removeSyncItemEncrypted: mocks.removeSyncItemEncrypted,
  markSyncItemStatusEncrypted: mocks.markSyncItemStatusEncrypted,
  getActiveTenantId: mocks.getActiveTenantId,
}));

vi.mock('./tokenStore', () => ({
  getAccessToken: mocks.getAccessToken,
}));

import { syncEngine } from './sync-engine';

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 101,
    store: 'patients',
    status: 'queued',
    createdAt: 1,
    attemptCount: 0,
    payload: {
      method: 'POST',
      url: '/api/patients',
      body: { name: 'Offline Patient' },
      localId: 'local-patient-1',
      store: 'patients',
      idempotency_key: 'idem-1',
      original_tenant_id: 'tenant-a',
      original_user_id: 'user-a',
      original_workstation_id: 'workstation-a',
      original_session_id: 'session-a',
      created_at: 1,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  syncEngine.stop();
  setNavigatorOnline(true);
  mocks.getAccessToken.mockReturnValue('token-a');
  mocks.getActiveTenantId.mockReturnValue('tenant-a');
  mocks.getPendingSyncQueueRowsDecrypted.mockResolvedValue([]);
  mocks.markSyncItemStatusEncrypted.mockResolvedValue(undefined);
  mocks.updateSyncItemAttemptEncrypted.mockResolvedValue(undefined);
  mocks.updatePatientSyncStatusEncrypted.mockResolvedValue(undefined);
  mocks.removeSyncItemEncrypted.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn());
});

describe('syncEngine browser offline queue replay', () => {
  it('replays a queued mutation with original context headers and removes the exact row on success', async () => {
    mocks.getPendingSyncQueueRowsDecrypted.mockResolvedValueOnce([row()]);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ id: 42 }),
    } as unknown as Response);

    await syncEngine.sync();

    expect(fetch).toHaveBeenCalledWith('/api/patients', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'X-Idempotency-Key': 'idem-1',
        Authorization: 'Bearer token-a',
        'X-Original-Tenant-Id': 'tenant-a',
        'X-Original-User-Id': 'user-a',
        'X-HMS-Workstation-ID': 'workstation-a',
        'X-HMS-Session-ID': 'session-a',
      }),
      body: JSON.stringify({ name: 'Offline Patient' }),
    }));
    expect(mocks.markSyncItemStatusEncrypted).toHaveBeenCalledWith(101, 'syncing');
    expect(mocks.updatePatientSyncStatusEncrypted).toHaveBeenCalledWith('local-patient-1', 42, 'synced');
    expect(mocks.removeSyncItemEncrypted).toHaveBeenCalledWith(101);
    expect(mocks.updateSyncItemAttemptEncrypted).not.toHaveBeenCalled();
  });

  it('increments the exact row attempt when a retryable server failure happens', async () => {
    mocks.getPendingSyncQueueRowsDecrypted.mockResolvedValueOnce([row({ id: 202 })]);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('cloud unavailable'),
    } as unknown as Response);

    await syncEngine.sync();

    expect(mocks.updateSyncItemAttemptEncrypted).toHaveBeenCalledWith(202, 'cloud unavailable');
    expect(mocks.removeSyncItemEncrypted).not.toHaveBeenCalled();
  });

  it('marks conflicts for manual review instead of retrying forever', async () => {
    mocks.getPendingSyncQueueRowsDecrypted.mockResolvedValueOnce([row({ id: 303 })]);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: vi.fn().mockResolvedValue('duplicate local reference'),
    } as unknown as Response);

    await syncEngine.sync();

    expect(mocks.markSyncItemStatusEncrypted).toHaveBeenCalledWith(303, 'syncing');
    expect(mocks.markSyncItemStatusEncrypted).toHaveBeenCalledWith(303, 'conflict', 'duplicate local reference');
    expect(mocks.updateSyncItemAttemptEncrypted).not.toHaveBeenCalled();
  });

  it('marks validation-style 4xx responses as poison and does not retry', async () => {
    mocks.getPendingSyncQueueRowsDecrypted.mockResolvedValueOnce([row({ id: 404 })]);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: vi.fn().mockResolvedValue('invalid offline payload'),
    } as unknown as Response);

    await syncEngine.sync();

    expect(mocks.markSyncItemStatusEncrypted).toHaveBeenCalledWith(404, 'poison', 'invalid offline payload');
    expect(mocks.updateSyncItemAttemptEncrypted).not.toHaveBeenCalled();
  });

  it('skips sync when the browser is offline or the access token is missing', async () => {
    setNavigatorOnline(false);
    await syncEngine.sync();
    expect(mocks.getPendingSyncQueueRowsDecrypted).not.toHaveBeenCalled();

    setNavigatorOnline(true);
    mocks.getAccessToken.mockReturnValueOnce(null);
    await syncEngine.sync();
    expect(mocks.getPendingSyncQueueRowsDecrypted).not.toHaveBeenCalled();
  });
});
