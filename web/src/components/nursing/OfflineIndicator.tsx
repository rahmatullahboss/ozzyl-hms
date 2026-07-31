import { useTranslation } from 'react-i18next';
import { Wifi, WifiOff, RefreshCw, Loader2 } from 'lucide-react';
import { useOfflineQueue } from '../../hooks/useOfflineQueue';
import { useOffline } from '../../hooks/useOffline';

export default function OfflineIndicator() {
  const { t } = useTranslation('nursing');
  const { isOnline, queueCount, retryAll } = useOfflineQueue();
  const { isSyncing } = useOffline();

  if (isOnline && queueCount === 0) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`
        flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium
        transition-all duration-300
        ${!isOnline
          ? 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800'
          : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800'
        }
      `}
    >
      {/* Status dot */}
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span
          className={`
            absolute inline-flex h-full w-full rounded-full opacity-75
            ${!isOnline ? 'bg-red-500 animate-ping' : 'bg-amber-500 animate-ping'}
          `}
        />
        <span
          className={`
            relative inline-flex rounded-full h-2.5 w-2.5
            ${!isOnline ? 'bg-red-600' : 'bg-amber-600'}
          `}
        />
      </span>

      {/* Icon */}
      {!isOnline ? (
        <WifiOff className="w-4 h-4 shrink-0" />
      ) : isSyncing ? (
        <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
      ) : (
        <Wifi className="w-4 h-4 shrink-0" />
      )}

      {/* Text */}
      <div className="flex-1 min-w-0">
        {!isOnline ? (
          <div className="flex flex-col">
            <span>{t('offline.youAreOffline')}</span>
            <span className="text-xs opacity-75">{t('offline.changesWillSync')}</span>
          </div>
        ) : isSyncing ? (
          <span>{t('offline.syncing')}</span>
        ) : (
          <span>{t('offline.pendingSync', { count: queueCount })}</span>
        )}
      </div>

      {/* Retry button */}
      {isOnline && queueCount > 0 && !isSyncing && (
        <button
          onClick={() => void retryAll()}
          className="
            inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
            rounded-md bg-white/80 hover:bg-white
            border border-current/20 hover:border-current/40
            transition-colors
            dark:bg-white/10 dark:hover:bg-white/20
          "
          aria-label={t('offline.retryNow')}
        >
          <RefreshCw className="w-3 h-3" />
          {t('offline.retryNow')}
        </button>
      )}
    </div>
  );
}
