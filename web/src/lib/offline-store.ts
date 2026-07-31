/**
 * Offline Store — IndexedDB abstraction for Ozzyl Health offline-first capability.
 *
 * Uses the `idb` library for a clean Promise-based API over IndexedDB.
 *
 * Stores:
 *   - patients:    local cache of patient records
 *   - syncQueue:   pending write operations to be synced when online
 *
 * Each cached record has a `syncStatus`:
 *   - 'synced':  record is in sync with the server
 *   - 'pending': created/updated locally, awaiting sync
 *   - 'conflict': server version conflicts with local (requires resolution)
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

// ─── DB Schema definition ─────────────────────────────────────────────────────

interface OfflinePatient {
  id: string;             // local UUID when pending, server ID when synced
  serverId?: number;      // server-assigned ID (null until synced)
  name: string;
  patient_code?: string;
  mobile?: string;
  gender?: string;
  date_of_birth?: string;
  age?: number;
  blood_group?: string;
  address?: string;
  syncStatus: 'synced' | 'pending' | 'conflict';
  updatedAt: number;      // timestamp for conflict detection
}

export interface SyncQueueItem {
  id?: number;            // auto-assigned by IndexedDB
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;            // e.g. /api/patients
  body: unknown;
  localId: string;        // the offline record ID this mutation belongs to
  store: 'patients';      // which store will be updated on success
  createdAt: number;
  attemptCount: number;
  lastAttemptAt?: number;
  lastError?: string;
}

interface HmsOfflineDB extends DBSchema {
  patients: {
    key: string;
    value: OfflinePatient;
    indexes: { syncStatus: string; updatedAt: number };
  };
  syncQueue: {
    key: number;
    value: SyncQueueItem;
    indexes: { createdAt: number; store: string };
  };
}

// ─── DB singleton ─────────────────────────────────────────────────────────────
let _db: IDBPDatabase<HmsOfflineDB> | null = null;

export async function getDb(): Promise<IDBPDatabase<HmsOfflineDB>> {
  if (_db) return _db;

  _db = await openDB<HmsOfflineDB>('hms-offline', 1, {
    upgrade(db) {
      // Patients store
      const patientStore = db.createObjectStore('patients', { keyPath: 'id' });
      patientStore.createIndex('syncStatus', 'syncStatus');
      patientStore.createIndex('updatedAt', 'updatedAt');

      // Sync queue store (auto-increment key)
      const syncStore = db.createObjectStore('syncQueue', {
        keyPath: 'id',
        autoIncrement: true,
      });
      syncStore.createIndex('createdAt', 'createdAt');
      syncStore.createIndex('store', 'store');
    },
  });

  // Reset reference when connection closes (browser may close idle connections)
  _db.addEventListener?.('close', () => {
    _db = null;
  });

  return _db;
}

// ─── Patient offline CRUD ─────────────────────────────────────────────────────

export async function savePatientOffline(
  patient: Omit<OfflinePatient, 'id' | 'syncStatus' | 'updatedAt'> & { serverId?: number }
): Promise<OfflinePatient> {
  const db = await getDb();
  const localId = patient.serverId
    ? `server-${patient.serverId}`
    : `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const record: OfflinePatient = {
    ...patient,
    id: localId,
    syncStatus: patient.serverId ? 'synced' : 'pending',
    updatedAt: Date.now(),
  };

  await db.put('patients', record);
  return record;
}

export async function getAllPatientsOffline(): Promise<OfflinePatient[]> {
  const db = await getDb();
  return db.getAll('patients');
}

export async function getPendingPatients(): Promise<OfflinePatient[]> {
  const db = await getDb();
  return db.getAllFromIndex('patients', 'syncStatus', 'pending');
}

export async function updatePatientSyncStatus(
  localId: string,
  serverId: number,
  status: OfflinePatient['syncStatus']
): Promise<void> {
  const db = await getDb();
  const existing = await db.get('patients', localId);
  if (!existing) return;

  await db.put('patients', {
    ...existing,
    serverId,
    id: `server-${serverId}`,  // rename to server ID
    syncStatus: status,
    updatedAt: Date.now(),
  });

  // Remove the old local- record if it was local
  if (localId !== `server-${serverId}`) {
    await db.delete('patients', localId);
  }
}

// ─── Sync Queue ────────────────────────────────────────────────────────────────

export async function enqueueSyncOperation(
  item: Omit<SyncQueueItem, 'id' | 'createdAt' | 'attemptCount'>
): Promise<void> {
  try {
    const db = await getDb();
    await db.add('syncQueue', {
      ...item,
      createdAt: Date.now(),
      attemptCount: 0,
    });
  } catch {
    _db = null;
    const db = await getDb();
    await db.add('syncQueue', {
      ...item,
      createdAt: Date.now(),
      attemptCount: 0,
    });
  }
}

export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  try {
    const db = await getDb();
    return db.getAllFromIndex('syncQueue', 'createdAt');
  } catch {
    // Connection may have been closed; force reopen
    _db = null;
    const db = await getDb();
    return db.getAllFromIndex('syncQueue', 'createdAt');
  }
}

export async function removeSyncItem(id: number): Promise<void> {
  try {
    const db = await getDb();
    await db.delete('syncQueue', id);
  } catch {
    _db = null;
    const db = await getDb();
    await db.delete('syncQueue', id);
  }
}

export async function updateSyncItemAttempt(
  id: number,
  error?: string
): Promise<void> {
  try {
    const db = await getDb();
    const item = await db.get('syncQueue', id);
    if (!item) return;

    await db.put('syncQueue', {
      ...item,
      attemptCount: item.attemptCount + 1,
      lastAttemptAt: Date.now(),
      lastError: error,
    });
  } catch {
    _db = null;
    const db = await getDb();
    const item = await db.get('syncQueue', id);
    if (!item) return;

    await db.put('syncQueue', {
      ...item,
      attemptCount: item.attemptCount + 1,
      lastAttemptAt: Date.now(),
      lastError: error,
    });
  }
}

export async function getPendingSyncCount(): Promise<number> {
  try {
    const db = await getDb();
    return (await db.getAllFromIndex('syncQueue', 'createdAt')).length;
  } catch {
    _db = null;
    const db = await getDb();
    return (await db.getAllFromIndex('syncQueue', 'createdAt')).length;
  }
}
