import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useOffline } from './useOffline';
import { syncEngine } from '../lib/sync-engine';

export interface OfflineQueueState {
  isOnline: boolean;
  queueCount: number;
  retryAll: () => Promise<void>;
}

export function useOfflineQueue(): OfflineQueueState {
  const { t } = useTranslation('nursing');
  const { isOnline, pendingCount, syncNow } = useOffline();

  const retryAll = useCallback(async () => {
    await syncNow();
  }, [syncNow]);

  return {
    isOnline,
    queueCount: pendingCount,
    retryAll,
  };
}
