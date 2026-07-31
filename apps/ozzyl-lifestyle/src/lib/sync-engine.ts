/**
 * Sync Engine — processes the offline sync queue when the connection is restored.
 *
 * Strategy:
 *   1. Listen to navigator.onLine events
 *   2. When online, process sync queue in FIFO order
 *   3. On success: update local record status to 'synced', remove from queue
 *   4. On failure: increment attempt count, stop after MAX_ATTEMPTS (leave for next cycle)
 *   5. Emits custom DOM events so UI components can react
 *
 * Usage:
 *   import { syncEngine } from './sync-engine';
 *   syncEngine.start();  // call once on app boot
 *   syncEngine.sync();   // call manually to trigger immediate sync
 */

import {
  getPendingSyncItems,
  removeSyncItem,
  updateSyncItemAttempt,
  updatePatientSyncStatus,
  getPendingSyncCount,
} from './offline-store';
import { getToken } from '../hooks/useAuth';
import { getTenantSlugFromPath } from '../hooks/useTenantSlug';

const MAX_ATTEMPTS = 5;
const SYNC_INTERVAL_MS = 30_000; // check every 30 seconds if online

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

// ─── Core sync logic ──────────────────────────────────────────────────────────

async function processSyncQueue(): Promise<void> {
  if (!navigator.onLine) return;

  // C3 fix: Don't process sync queue if user hasn't logged in yet
  const token = getToken();
  if (!token) {
    console.log('[Sync] No auth token — skipping sync cycle');
    return;
  }

  const items = await getPendingSyncItems();
  if (items.length === 0) return;

  emitSyncEvent(SYNC_EVENT.START, { total: items.length });

  let synced = 0;
  let failed = 0;

  for (const item of items) {
    if (item.attemptCount >= MAX_ATTEMPTS) {
      console.warn(`[Sync] Skipping item ${item.id} — max attempts reached`);
      continue;
    }

    try {
      const slug  = getTenantSlugFromPath();

      const res = await fetch(item.url, {
        method: item.method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(slug  ? { 'X-Tenant-Subdomain': slug } : {}),
        },
        body: item.body ? JSON.stringify(item.body) : undefined,
      });

      if (res.ok) {
        const data = await res.json() as { id?: number };

        // Update local record status
        if (item.store === 'patients' && item.method === 'POST' && data.id) {
          await updatePatientSyncStatus(item.localId, data.id, 'synced');
        }

        // Remove from sync queue
        await removeSyncItem(item.id!);
        synced++;

        emitSyncEvent(SYNC_EVENT.PROGRESS, { synced, total: items.length });
      } else {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        await updateSyncItemAttempt(item.id!, errText);
        failed++;
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Network error';
      await updateSyncItemAttempt(item.id!, errMsg);
      failed++;

      // Network error — stop processing this cycle (connection dropped)
      if (!navigator.onLine) break;
    }
  }

  const remaining = await getPendingSyncCount();
  emitSyncEvent(SYNC_EVENT.COMPLETE, { synced, failed, remaining });
  console.log(`[Sync] Cycle complete — synced: ${synced}, failed: ${failed}, remaining: ${remaining}`);
}

// ─── Sync Engine singleton ────────────────────────────────────────────────────

class SyncEngine {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private onlineHandler: (() => void) | null = null;

  start(): void {
    if (this.running) return;
    this.running = true;

    // Sync immediately on start if online
    if (navigator.onLine) {
      void processSyncQueue();
    }

    // Sync when coming back online
    this.onlineHandler = () => {
      console.log('[Sync] Connection restored — starting sync');
      void processSyncQueue();
    };
    window.addEventListener('online', this.onlineHandler);

    // Periodic sync while online
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
