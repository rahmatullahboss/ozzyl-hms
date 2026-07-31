/**
 * Sync Engine — processes the encrypted browser offline queue when the
 * connection is restored.
 *
 * SECURITY (P0-37): each queued mutation is stored with the ORIGINAL
 * tenant_id, user_id, workstation_id, and session_id that were in effect
 * when the mutation was created. On replay we use those stored values,
 * NOT the current ones, so a swapped tenant / user cannot accidentally
 * pick up another hospital's queued writes.
 *
 * Each mutation also carries an idempotency key so the server can detect
 * and dedupe replays.
 */

import {
  getPendingSyncQueueRowsDecrypted,
  updateSyncItemAttemptEncrypted,
  updatePatientSyncStatusEncrypted,
  removeSyncItemEncrypted,
  markSyncItemStatusEncrypted,
  getActiveTenantId,
} from './secure-store';
import { getAccessToken } from './tokenStore';

const SYNC_INTERVAL_MS = 5 * 60_000; // browser fallback queue; local server sync owns normal writes

// ─── Event names ─────────────────────────────────────────────────────────────
export const SYNC_EVENT = {
  START:    'hms:sync:start',
  COMPLETE: 'hms:sync:complete',
  FAILED:   'hms:sync:failed',
  PROGRESS: 'hms:sync:progress',
} as const;

export function emitSyncEvent(type: string, detail?: object): void {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

function shouldTreatAsPermanentFailure(status: number): boolean {
  return status >= 400 && status < 500 && status !== 409 && status !== 429;
}

// ─── Core sync logic ──────────────────────────────────────────────────────────

async function processSyncQueue(): Promise<void> {
  if (!navigator.onLine) return;

  const token = getAccessToken();
  if (!token) {
    console.log('[Sync] No auth token — skipping sync cycle');
    return;
  }

  const tenantId = getActiveTenantId();
  const rows = await getPendingSyncQueueRowsDecrypted(tenantId);
  if (rows.length === 0) return;

  emitSyncEvent(SYNC_EVENT.START, { total: rows.length });

  let synced = 0;
  let failed = 0;
  let conflicts = 0;

  for (const row of rows) {
    const item = row.payload;
    try {
      await markSyncItemStatusEncrypted(row.id, 'syncing');

      const originalHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': item.idempotency_key,
        Authorization: `Bearer ${token}`,
      };
      if (item.original_tenant_id) {
        originalHeaders['X-Original-Tenant-Id'] = item.original_tenant_id;
      }
      if (item.original_user_id) {
        originalHeaders['X-Original-User-Id'] = item.original_user_id;
      }
      if (item.original_workstation_id) {
        originalHeaders['X-HMS-Workstation-ID'] = item.original_workstation_id;
      }
      if (item.original_session_id) {
        originalHeaders['X-HMS-Session-ID'] = item.original_session_id;
      }

      const res = await fetch(item.url, {
        method: item.method,
        headers: originalHeaders,
        body: item.body ? JSON.stringify(item.body) : undefined,
      });

      if (res.ok) {
        const data = await res.json().catch(() => null) as { id?: number } | null;

        if (item.store === 'patients' && item.method === 'POST' && data?.id) {
          await updatePatientSyncStatusEncrypted(item.localId, data.id, 'synced');
        }

        await removeSyncItemEncrypted(row.id);
        synced++;
        emitSyncEvent(SYNC_EVENT.PROGRESS, { synced, failed, conflicts, total: rows.length });
        continue;
      }

      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      if (res.status === 409) {
        await markSyncItemStatusEncrypted(row.id, 'conflict', errText);
        conflicts++;
      } else if (shouldTreatAsPermanentFailure(res.status)) {
        await markSyncItemStatusEncrypted(row.id, 'poison', errText);
        failed++;
      } else {
        await updateSyncItemAttemptEncrypted(row.id, errText);
        failed++;
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Network error';
      await updateSyncItemAttemptEncrypted(row.id, errMsg);
      failed++;

      if (!navigator.onLine) break;
    }
  }

  emitSyncEvent(SYNC_EVENT.COMPLETE, { synced, failed, conflicts });
  console.log(`[Sync] Cycle complete — synced: ${synced}, failed: ${failed}, conflicts: ${conflicts}`);
}

// ─── Sync Engine singleton ────────────────────────────────────────────────────

class SyncEngine {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private onlineHandler: (() => void) | null = null;

  start(): void {
    if (this.running) return;
    this.running = true;

    if (navigator.onLine) {
      void processSyncQueue();
    }

    this.onlineHandler = () => {
      console.log('[Sync] Connection restored — starting sync');
      void processSyncQueue();
    };
    window.addEventListener('online', this.onlineHandler);

    this.intervalId = setInterval(() => {
      if (navigator.onLine) {
        void processSyncQueue();
      }
    }, SYNC_INTERVAL_MS);
  }

  async sync(): Promise<void> {
    return processSyncQueue();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }
}

export const syncEngine = new SyncEngine();
