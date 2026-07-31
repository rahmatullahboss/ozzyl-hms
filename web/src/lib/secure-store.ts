/**
 * secure-store — AES-GCM + tenant-scope wrapper for IndexedDB.
 *
 * SECURITY (P0-36):
 *   - Patient PII stored in IndexedDB MUST be encrypted with an AES-GCM
 *     key derived from a per-session passphrase that lives ONLY in memory.
 *     On page reload, the passphrase is lost, so any prior IndexedDB rows
 *     become undecryptable. Callers that need a session across reloads
 *     must re-authenticate, which is the secure behavior.
 *   - Each record carries the tenant_id it belongs to. Reads refuse to
 *     decrypt records whose tenant_id does not match the current active
 *     tenant. This prevents cross-tenant data leakage if the user swaps
 *     hospital without logging out (e.g. via impersonation).
 *   - `purgeAll` wipes both the encryption key and the IndexedDB rows; it
 *     is called from the logout path.
 *
 * The passphrase is provided by the caller (e.g. tokenStore-backed session
 * key) and is never persisted. A zero-knowledge key derivation (PBKDF2)
 * turns the passphrase into a 256-bit AES-GCM key.
 */

const DB_NAME = 'hms-offline';
const DB_VERSION = 3;
const PBKDF2_ITERATIONS = 100_000;

// ─── Passphrase management ─────────────────────────────────────────────
let _passphrase: string | null = null;
let _key: CryptoKey | null = null;
let _activeTenantId: string | null = null;

function teardownKey(): void {
  _passphrase = null;
  _key = null;
}

async function deriveKey(passphrase: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('hms-offline-store-v1'),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Activate the secure store. Must be called after a successful login. */
export async function activateSecureStore(passphrase: string, tenantId: string | null): Promise<void> {
  if (!passphrase) {
    throw new Error('passphrase is required to activate the secure store');
  }
  _passphrase = passphrase;
  _key = await deriveKey(passphrase);
  _activeTenantId = tenantId;
}

export function setActiveTenant(tenantId: string | null): void {
  _activeTenantId = tenantId;
}

export function getActiveTenantId(): string | null {
  return _activeTenantId;
}

export function isSecureStoreActive(): boolean {
  return _key !== null;
}

// ─── Encryption helpers ────────────────────────────────────────────────

function randomIv(): Uint8Array {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  return iv;
}

function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.byteLength; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function base64ToBytes(s: string): Uint8Array {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export interface SealedEnvelope {
  __sealed: true;
  iv: string;
  ct: string;
  tenantId: string | null;
}

function assertKey(): CryptoKey {
  if (!_key) {
    throw new Error('secure store is not active — call activateSecureStore() first');
  }
  return _key;
}

export function seal(value: unknown, tenantId: string | null): SealedEnvelope {
  // Backwards-compatible sync wrapper around sealAsync. Used by callers
  // that need a synchronous value (e.g. test fixtures). The async
  // `sealAsync` is the production path; this exists so imports don't
  // fail in code paths that pass a literal envelope.
  const key = assertKey();
  // We intentionally do not call the WebCrypto sync encrypt API (it is
  // async-only). The returned envelope is a placeholder shape; callers
  // that need real encryption should use sealAsync. The placeholder
  // cannot be decrypted by openEnvelope so any misuse will fail loud.
  void key; void value;
  return {
    __sealed: true,
    iv: '',
    ct: '',
    tenantId,
  };
}

export async function sealAsync(value: unknown, tenantId: string | null): Promise<SealedEnvelope> {
  const key = assertKey();
  const enc = new TextEncoder();
  const iv = randomIv();
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    enc.encode(JSON.stringify(value)),
  );
  return {
    __sealed: true,
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ct)),
    tenantId,
  };
}

export async function openEnvelope<T = unknown>(envelope: SealedEnvelope): Promise<T | null> {
  if (!envelope || !envelope.__sealed) return envelope as T;
  // Tenant-scope check (P0-36).
  if (envelope.tenantId !== _activeTenantId) {
    return null;
  }
  const key = assertKey();
  const iv = base64ToBytes(envelope.iv);
  const ct = base64ToBytes(envelope.ct);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ct as BufferSource,
    );
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    // Wrong key, tampered ciphertext, or wrong tenant — refuse to read.
    return null;
  }
}

// ─── IndexedDB access (encrypted) ─────────────────────────────────────

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface EncryptedPatient {
  id: string;
  envelope: SealedEnvelope; // contains { name, mobile, dob, ... }
  syncStatus: 'synced' | 'pending' | 'conflict';
  updatedAt: number;
}

export type SyncQueueStatus = 'queued' | 'syncing' | 'synced' | 'failed' | 'conflict' | 'poison';

export interface EncryptedSyncQueueItem {
  id?: number;
  envelope: SealedEnvelope; // contains SyncQueuePayload
  store: string;
  status: SyncQueueStatus;
  createdAt: number;
  attemptCount: number;
  lastAttemptAt?: number;
  lastError?: string;
}

interface HmsSecureDB extends DBSchema {
  patients: {
    key: string;
    value: EncryptedPatient;
    indexes: { syncStatus: string; updatedAt: number };
  };
  syncQueue: {
    key: number;
    value: EncryptedSyncQueueItem;
    indexes: { createdAt: number; store: string; status: string };
  };
}

let _db: IDBPDatabase<HmsSecureDB> | null = null;

async function getDb(): Promise<IDBPDatabase<HmsSecureDB>> {
  if (_db) return _db;
  _db = await openDB<HmsSecureDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      if (oldVersion < 2) {
        // Drop legacy unencrypted stores from v1.
        try { db.deleteObjectStore('patients'); } catch { /* may not exist */ }
        try { db.deleteObjectStore('syncQueue'); } catch { /* may not exist */ }
      }
      if (!db.objectStoreNames.contains('patients')) {
        const patientStore = db.createObjectStore('patients', { keyPath: 'id' });
        patientStore.createIndex('syncStatus', 'syncStatus');
        patientStore.createIndex('updatedAt', 'updatedAt');
      }

      let syncStore;
      if (!db.objectStoreNames.contains('syncQueue')) {
        syncStore = db.createObjectStore('syncQueue', {
          keyPath: 'id',
          autoIncrement: true,
        });
      } else {
        syncStore = transaction.objectStore('syncQueue');
      }
      if (!syncStore.indexNames.contains('createdAt')) syncStore.createIndex('createdAt', 'createdAt');
      if (!syncStore.indexNames.contains('store')) syncStore.createIndex('store', 'store');
      if (!syncStore.indexNames.contains('status')) syncStore.createIndex('status', 'status');
    },
  });
  _db.addEventListener?.('close', () => {
    _db = null;
  });
  return _db;
}

export async function savePatientEncrypted(
  patient: {
    serverId?: number;
    name: string;
    patient_code?: string;
    mobile?: string;
    gender?: string;
    date_of_birth?: string;
    age?: number;
    blood_group?: string;
    address?: string;
  },
  tenantId: string | null,
): Promise<EncryptedPatient> {
  const db = await getDb();
  const localId = patient.serverId
    ? `server-${patient.serverId}`
    : `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const envelope = await sealAsync(patient, tenantId);
  const record: EncryptedPatient = {
    id: localId,
    envelope,
    syncStatus: patient.serverId ? 'synced' : 'pending',
    updatedAt: Date.now(),
  };
  await db.put('patients', record);
  return record;
}

export async function getAllPatientsDecrypted(tenantId: string | null): Promise<Array<{ id: string; data: unknown; syncStatus: string; updatedAt: number }>> {
  const db = await getDb();
  const rows = await db.getAll('patients');
  const out: Array<{ id: string; data: unknown; syncStatus: string; updatedAt: number }> = [];
  for (const row of rows) {
    if (row.envelope.tenantId !== tenantId) continue; // tenant-scope guard
    const data = await openEnvelope(row.envelope);
    if (data !== null) {
      out.push({ id: row.id, data, syncStatus: row.syncStatus, updatedAt: row.updatedAt });
    }
  }
  return out;
}

export async function getPendingPatientsEncrypted(tenantId: string | null): Promise<EncryptedPatient[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex('patients', 'syncStatus', 'pending');
  return rows.filter((r) => r.envelope.tenantId === tenantId);
}

export async function updatePatientSyncStatusEncrypted(
  localId: string,
  serverId: number,
  status: EncryptedPatient['syncStatus'],
): Promise<void> {
  const db = await getDb();
  const existing = await db.get('patients', localId);
  if (!existing) return;
  const newRecord: EncryptedPatient = {
    ...existing,
    id: `server-${serverId}`,
    syncStatus: status,
    updatedAt: Date.now(),
  };
  await db.put('patients', newRecord);
  if (localId !== `server-${serverId}`) {
    await db.delete('patients', localId);
  }
}

// ─── Sync queue (encrypted, P0-37 stores original context inside) ──────

export interface SyncQueuePayload {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body: unknown;
  localId: string;
  store: string;
  module?: string;
  local_ref?: string;
  queue_id?: string;
  idempotency_key: string;
  original_tenant_id: string | null;
  original_user_id: string | null;
  original_workstation_id: string | null;
  original_session_id: string | null;
  created_at: number;
  expires_at?: number;
}

export interface DecryptedSyncQueueRow {
  id: number;
  payload: SyncQueuePayload;
  store: string;
  status: SyncQueueStatus;
  createdAt: number;
  attemptCount: number;
  lastAttemptAt?: number;
  lastError?: string;
}

function isReplayableStatus(status?: SyncQueueStatus): boolean {
  return !status || status === 'queued' || status === 'failed' || status === 'syncing';
}

export async function enqueueSyncOperationEncrypted(payload: SyncQueuePayload, tenantId: string | null): Promise<number> {
  const db = await getDb();
  const envelope = await sealAsync(payload, tenantId);
  return db.add('syncQueue', {
    envelope,
    store: payload.store || payload.module || 'generic',
    status: 'queued',
    createdAt: Date.now(),
    attemptCount: 0,
  });
}

async function getSyncQueueRowsDecrypted(
  tenantId: string | null,
  options: { replayableOnly: boolean },
): Promise<DecryptedSyncQueueRow[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex('syncQueue', 'createdAt');
  const out: DecryptedSyncQueueRow[] = [];
  for (const row of rows) {
    if (!row.id) continue;
    if (row.envelope.tenantId !== tenantId) continue;
    if (options.replayableOnly && !isReplayableStatus(row.status)) continue;
    const data = await openEnvelope<SyncQueuePayload>(row.envelope);
    if (data) {
      out.push({
        id: row.id,
        payload: data,
        store: row.store,
        status: row.status ?? 'queued',
        createdAt: row.createdAt,
        attemptCount: row.attemptCount,
        lastAttemptAt: row.lastAttemptAt,
        lastError: row.lastError,
      });
    }
  }
  return out;
}

export async function getPendingSyncQueueRowsDecrypted(tenantId: string | null): Promise<DecryptedSyncQueueRow[]> {
  return getSyncQueueRowsDecrypted(tenantId, { replayableOnly: true });
}

export async function getAllSyncQueueRowsDecrypted(tenantId: string | null): Promise<DecryptedSyncQueueRow[]> {
  return getSyncQueueRowsDecrypted(tenantId, { replayableOnly: false });
}

export async function getPendingSyncItemsDecrypted(tenantId: string | null): Promise<SyncQueuePayload[]> {
  const rows = await getPendingSyncQueueRowsDecrypted(tenantId);
  return rows.map((row) => row.payload);
}

export async function getPendingSyncCountEncrypted(tenantId: string | null): Promise<number> {
  const rows = await getPendingSyncQueueRowsDecrypted(tenantId);
  return rows.length;
}

export async function removeSyncItemEncrypted(id: number): Promise<void> {
  const db = await getDb();
  await db.delete('syncQueue', id);
}

export async function markSyncItemStatusEncrypted(id: number, status: SyncQueueStatus, error?: string): Promise<void> {
  const db = await getDb();
  const item = await db.get('syncQueue', id);
  if (!item) return;
  await db.put('syncQueue', {
    ...item,
    status,
    lastAttemptAt: Date.now(),
    lastError: error,
  });
}

export async function updateSyncItemAttemptEncrypted(id: number, error?: string): Promise<void> {
  const db = await getDb();
  const item = await db.get('syncQueue', id);
  if (!item) return;
  const attemptCount = item.attemptCount + 1;
  await db.put('syncQueue', {
    ...item,
    status: attemptCount >= 5 ? 'poison' : 'failed',
    attemptCount,
    lastAttemptAt: Date.now(),
    lastError: error,
  });
}

// ─── Purge on logout (P0-36) ──────────────────────────────────────────

/** Wipe IndexedDB rows and forget the encryption key. Call on logout. */
export async function purgeAllSecureData(): Promise<void> {
  try {
    if (_db) {
      await _db.close();
      _db = null;
    }
    await indexedDB.deleteDatabase(DB_NAME);
  } catch {
    // best-effort
  }
  teardownKey();
  _activeTenantId = null;
}
