/**
 * useOffline — React hook for offline status and sync queue state.
 *
 * Returns:
 *   isOnline:     current network status
 *   pendingCount: number of items in the sync queue
 *   syncNow():    manually trigger a sync
 */

import { useState, useEffect, useCallback } from 'react';
import { syncEngine, SYNC_EVENT } from '../lib/sync-engine';
import { getPendingSyncCount } from '../lib/offline-store';

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

  // Refresh pending count
  const refreshCount = useCallback(async () => {
    const count = await getPendingSyncCount();
    setPendingCount(count);
  }, []);

  useEffect(() => {
    // Update network status
    const handleOnline  = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);

    // Listen to sync events
    const handleStart    = () => setIsSyncing(true);
    const handleComplete = () => {
      setIsSyncing(false);
      setLastSyncAt(Date.now());
      void refreshCount();
    };
    window.addEventListener(SYNC_EVENT.START,    handleStart);
    window.addEventListener(SYNC_EVENT.COMPLETE, handleComplete);
    window.addEventListener(SYNC_EVENT.PROGRESS, () => void refreshCount());

    // Initial count
    void refreshCount();

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener(SYNC_EVENT.START,    handleStart);
      window.removeEventListener(SYNC_EVENT.COMPLETE, handleComplete);
    };
  }, [refreshCount]);

  const syncNow = useCallback(async () => {
    await syncEngine.sync();
  }, []);

  return { isOnline, pendingCount, lastSyncAt, isSyncing, syncNow };
}
