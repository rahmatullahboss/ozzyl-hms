import { beforeEach, describe, expect, it, vi } from 'vitest';

const idbMocks = vi.hoisted(() => {
  let nextId = 1;
  const patients = new Map<string, any>();
  const syncQueue = new Map<number, any>();

  const db = {
    addEventListener: vi.fn(),
    close: vi.fn(),
    add: vi.fn(async (storeName: string, value: any) => {
      if (storeName !== 'syncQueue') throw new Error(`unsupported add store ${storeName}`);
      const id = nextId++;
      syncQueue.set(id, { ...value, id });
      return id;
    }),
    put: vi.fn(async (storeName: string, value: any) => {
      if (storeName === 'syncQueue') {
        syncQueue.set(value.id, value);
        return;
      }
      if (storeName === 'patients') {
        patients.set(value.id, value);
        return;
      }
      throw new Error(`unsupported put store ${storeName}`);
    }),
    get: vi.fn(async (storeName: string, key: string | number) => {
      if (storeName === 'syncQueue') return syncQueue.get(Number(key));
      if (storeName === 'patients') return patients.get(String(key));
      return undefined;
    }),
    getAll: vi.fn(async (storeName: string) => {
      if (storeName === 'syncQueue') return [...syncQueue.values()];
      if (storeName === 'patients') return [...patients.values()];
      return [];
    }),
    getAllFromIndex: vi.fn(async (storeName: string, indexName: string, query?: unknown) => {
      if (storeName === 'syncQueue' && indexName === 'createdAt') {
        return [...syncQueue.values()].sort((a, b) => a.createdAt - b.createdAt);
      }
      if (storeName === 'patients' && indexName === 'syncStatus') {
        return [...patients.values()].filter((row) => row.syncStatus === query);
      }
      return [];
    }),
    delete: vi.fn(async (storeName: string, key: string | number) => {
      if (storeName === 'syncQueue') {
        syncQueue.delete(Number(key));
        return;
      }
      if (storeName === 'patients') {
        patients.delete(String(key));
      }
    }),
  };

  return {
    openDB: vi.fn(async () => db),
    reset: () => {
      nextId = 1;
      patients.clear();
      syncQueue.clear();
      vi.clearAllMocks();
    },
  };
});

vi.mock('idb', () => ({
  openDB: idbMocks.openDB,
}));

import {
  activateSecureStore,
  enqueueSyncOperationEncrypted,
  getPendingSyncQueueRowsDecrypted,
  getAllSyncQueueRowsDecrypted,
  getPendingSyncItemsDecrypted,
  getPendingSyncCountEncrypted,
  markSyncItemStatusEncrypted,
  removeSyncItemEncrypted,
  updateSyncItemAttemptEncrypted,
  savePatientEncrypted,
  updatePatientSyncStatusEncrypted,
  getAllPatientsDecrypted,
} from './secure-store';

function payload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    method: 'POST' as const,
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
    ...overrides,
  };
}

beforeEach(async () => {
  idbMocks.reset();
  await activateSecureStore('test-passphrase', 'tenant-a');
});

describe('secure-store encrypted browser sync queue', () => {
  it('stores generic queue rows and returns decrypted rows with wrapper metadata', async () => {
    const id = await enqueueSyncOperationEncrypted(payload({ store: 'billing', module: 'billing' }), 'tenant-a');

    const rows = await getPendingSyncQueueRowsDecrypted('tenant-a');

    expect(id).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 1,
      store: 'billing',
      status: 'queued',
      attemptCount: 0,
      payload: expect.objectContaining({
        store: 'billing',
        module: 'billing',
        idempotency_key: 'idem-1',
      }),
    });
    expect(await getPendingSyncCountEncrypted('tenant-a')).toBe(1);
    expect(await getPendingSyncItemsDecrypted('tenant-a')).toHaveLength(1);
  });

  it('filters queued rows by tenant before decrypting', async () => {
    await enqueueSyncOperationEncrypted(payload(), 'tenant-a');

    expect(await getPendingSyncQueueRowsDecrypted('tenant-b')).toEqual([]);
    expect(await getPendingSyncCountEncrypted('tenant-b')).toBe(0);
  });

  it('updates attempts on the exact row and stops returning poison rows', async () => {
    const id = await enqueueSyncOperationEncrypted(payload(), 'tenant-a');

    await updateSyncItemAttemptEncrypted(id, 'temporary failure');
    let rows = await getPendingSyncQueueRowsDecrypted('tenant-a');
    expect(rows[0]).toMatchObject({
      id,
      status: 'failed',
      attemptCount: 1,
      lastError: 'temporary failure',
    });

    await updateSyncItemAttemptEncrypted(id, 'failure 2');
    await updateSyncItemAttemptEncrypted(id, 'failure 3');
    await updateSyncItemAttemptEncrypted(id, 'failure 4');
    await updateSyncItemAttemptEncrypted(id, 'failure 5');

    rows = await getPendingSyncQueueRowsDecrypted('tenant-a');
    expect(rows).toEqual([]);
  });

  it('keeps conflict and poison rows visible for offline review', async () => {
    const conflictId = await enqueueSyncOperationEncrypted(payload({ idempotency_key: 'idem-conflict' }), 'tenant-a');
    const poisonId = await enqueueSyncOperationEncrypted(payload({ idempotency_key: 'idem-poison' }), 'tenant-a');

    await markSyncItemStatusEncrypted(conflictId, 'conflict', 'duplicate patient');
    await markSyncItemStatusEncrypted(poisonId, 'poison', 'validation failed');

    expect(await getPendingSyncQueueRowsDecrypted('tenant-a')).toEqual([]);

    const reviewRows = await getAllSyncQueueRowsDecrypted('tenant-a');
    expect(reviewRows.map((row) => row.status)).toEqual(['conflict', 'poison']);
    expect(reviewRows.map((row) => row.lastError)).toEqual(['duplicate patient', 'validation failed']);
  });

  it('removes only the requested queue row', async () => {
    const first = await enqueueSyncOperationEncrypted(payload({ idempotency_key: 'idem-1' }), 'tenant-a');
    const second = await enqueueSyncOperationEncrypted(payload({ idempotency_key: 'idem-2' }), 'tenant-a');

    await removeSyncItemEncrypted(first);

    const rows = await getPendingSyncQueueRowsDecrypted('tenant-a');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(second);
    expect(rows[0].payload.idempotency_key).toBe('idem-2');
  });

  it('updates local patient records from local id to server id after sync', async () => {
    const record = await savePatientEncrypted({ name: 'Local Patient' }, 'tenant-a');

    await updatePatientSyncStatusEncrypted(record.id, 55, 'synced');

    const patients = await getAllPatientsDecrypted('tenant-a');
    expect(patients).toHaveLength(1);
    expect(patients[0]).toMatchObject({
      id: 'server-55',
      syncStatus: 'synced',
      data: expect.objectContaining({ name: 'Local Patient' }),
    });
  });
});
