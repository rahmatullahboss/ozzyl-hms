/**
 * useOffline — React hook for offline status and encrypted browser sync queue state.
 *
 * Returns:
 *   isOnline:     current network status
 *   pendingCount: number of items in the sync queue
 *   syncNow():    manually trigger a sync
 */

import { useState, useEffect, useCallback } from 'react';
import { syncEngine, SYNC_EVENT } from '../lib/sync-engine';
import { getActiveTenantId, getPendingSyncCountEncrypted } from '../lib/secure-store';

export interface OfflineState {
  isOnline: boolean;
  pendingCount: number;
  lastSyncAt: number | null;
  isSyncing: boolean;
  syncNow: () => Promise<void>;
}

export function useOffline(): OfflineState {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const refreshCount = useCallback(async () => {
    try {
      const count = await getPendingSyncCountEncrypted(getActiveTenantId());
      setPendingCount(count);
    } catch {
      setPendingCount(0);
    }
  }, []);

  useEffect(() => {
    const handleOnline  = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);

    const handleStart = () => setIsSyncing(true);
    const handleComplete = () => {
      setIsSyncing(false);
      setLastSyncAt(Date.now());
      void refreshCount();
    };
    const handleProgress = () => void refreshCount();
    const handleQueued = () => void refreshCount();

    window.addEventListener(SYNC_EVENT.START,    handleStart);
    window.addEventListener(SYNC_EVENT.COMPLETE, handleComplete);
    window.addEventListener(SYNC_EVENT.PROGRESS, handleProgress);
    window.addEventListener('hms:sync:queued', handleQueued);

    void refreshCount();

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener(SYNC_EVENT.START,    handleStart);
      window.removeEventListener(SYNC_EVENT.COMPLETE, handleComplete);
      window.removeEventListener(SYNC_EVENT.PROGRESS, handleProgress);
      window.removeEventListener('hms:sync:queued', handleQueued);
    };
  }, [refreshCount]);

  const syncNow = useCallback(async () => {
    await syncEngine.sync();
  }, []);

  return { isOnline, pendingCount, lastSyncAt, isSyncing, syncNow };
}
