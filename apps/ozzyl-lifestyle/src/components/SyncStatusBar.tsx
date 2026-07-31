/**
 * SyncStatusBar — offline/sync indicator component.
 *
 * Shows:
 *  - 🔴 "Offline Mode" banner when device is disconnected
 *  - 🟡 "X pending" badge when there are items waiting to sync
 *  - 🔄 "Syncing…" when sync is in progress
 *  - ✅ "Synced" briefly after successful sync
 *
 * Mount this inside DashboardLayout or at the top of protected routes.
 */

import { useEffect, useState } from 'react';
import { Wifi, WifiOff, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { useOffline } from '../hooks/useOffline';

export default function SyncStatusBar() {
  const { isOnline, pendingCount, isSyncing, lastSyncAt, syncNow } = useOffline();
  const [showSynced, setShowSynced] = useState(false);

  // Flash "Synced ✓" for 3 seconds after sync completes
  useEffect(() => {
    if (lastSyncAt && pendingCount === 0) {
      setShowSynced(true);
      const t = setTimeout(() => setShowSynced(false), 3000);
      return () => clearTimeout(t);
    }
  }, [lastSyncAt, pendingCount]);

  // Don't render anything when everything is clean and online
  if (isOnline && pendingCount === 0 && !isSyncing && !showSynced) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`
        flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg
        transition-all duration-300
        ${!isOnline
          ? 'bg-red-100 text-red-700 border border-red-200'
          : isSyncing
            ? 'bg-blue-100 text-blue-700 border border-blue-200'
            : pendingCount > 0
              ? 'bg-amber-100 text-amber-700 border border-amber-200'
              : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
        }
      `}
    >
      {/* Icon */}
      {!isOnline ? (
        <WifiOff className="w-3.5 h-3.5 shrink-0" />
      ) : isSyncing ? (
        <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
      ) : showSynced ? (
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
      ) : (
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      )}

      {/* Text */}
      <span>
        {!isOnline
          ? 'Offline Mode — changes saved locally'
          : isSyncing
            ? 'Syncing…'
            : showSynced
              ? 'All changes synced'
              : `${pendingCount} change${pendingCount > 1 ? 's' : ''} pending sync`
        }
      </span>

      {/* Wifi indicator */}
      {isOnline && !isSyncing && (
        <Wifi className="w-3.5 h-3.5 shrink-0 opacity-50" />
      )}

      {/* Manual sync button (when pending and online) */}
      {isOnline && pendingCount > 0 && !isSyncing && (
        <button
          onClick={() => void syncNow()}
          className="ml-1 underline underline-offset-2 hover:opacity-80 focus:outline-none"
          aria-label="Sync now"
        >
          Sync now
        </button>
      )}
    </div>
  );
}
