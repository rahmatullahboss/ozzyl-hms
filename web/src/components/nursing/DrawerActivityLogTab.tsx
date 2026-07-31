import { useState } from 'react';
import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import type { BedGridItem } from './WardBedGrid';

interface ActivityLogEntry {
  id: number;
  user_name: string;
  action: string;
  details: string;
  created_at: string;
}

interface DrawerActivityLogTabProps {
  bed: BedGridItem;
}

const ACTION_BADGE_STYLES: Record<string, string> = {
  vitals_recorded: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  medication_given: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  medication_missed: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  order_acknowledged: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  note_added: 'bg-gray-100 text-gray-700 dark:bg-gray-900/40 dark:text-gray-300',
  service_added: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  emergency_alert: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  transfer_initiated: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
};

const ACTION_LABELS: Record<string, string> = {
  vitals_recorded: 'Vitals Recorded',
  medication_given: 'Medication Given',
  medication_missed: 'Medication Missed',
  order_acknowledged: 'Order Acknowledged',
  note_added: 'Note Added',
  service_added: 'Service Added',
  emergency_alert: 'Emergency Alert',
  transfer_initiated: 'Transfer Initiated',
};

export default function DrawerActivityLogTab({ bed }: DrawerActivityLogTabProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const [actionFilter, setActionFilter] = useState<string>('all');

  const logQuery = useApiQuery<{ Results?: ActivityLogEntry[] }>(
    queryKeys.nursing.activityLog(bed.patient_id!),
    `/api/nursing/activity-log?patient_id=${bed.patient_id}&admission_id=${bed.admission_id ?? ''}&limit=50`,
    { enabled: !!bed.patient_id },
  );

  const entries = logQuery.data?.Results ?? [];
  const filteredEntries = actionFilter === 'all'
    ? entries
    : entries.filter(e => e.action === actionFilter);

  return (
    <div className="space-y-4" data-testid="activity-log-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          {t('drawer.activityLog.title', { defaultValue: 'Activity Log' })}
        </h3>
        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          className="input text-xs py-1 px-2"
          data-testid="activity-type-filter"
        >
          <option value="all">{t('drawer.activityLog.allActions', { defaultValue: 'All Actions' })}</option>
          {Object.entries(ACTION_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {filteredEntries.length === 0 ? (
        <div className="text-center py-6 text-[var(--color-text-muted)]" data-testid="activity-log-empty">
          <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">{t('drawer.activityLog.noEntries', { defaultValue: 'No activity recorded yet' })}</p>
        </div>
      ) : (
        <div className="space-y-2" data-testid="activity-log-list">
          {filteredEntries.map(entry => (
            <div
              key={entry.id}
              className="p-3 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-border-light)]/20 transition-colors"
              data-testid="activity-log-item"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${ACTION_BADGE_STYLES[entry.action] ?? 'bg-gray-100 text-gray-700'}`}
                      data-testid="action-badge"
                    >
                      {ACTION_LABELS[entry.action] ?? entry.action}
                    </span>
                    <span className="text-xs font-medium text-[var(--color-text)]">
                      {entry.user_name}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      {entry.created_at ? new Date(entry.created_at).toLocaleString('en-GB', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                      }) : '—'}
                    </span>
                  </div>
                  {entry.details && (
                    <p className="text-sm text-[var(--color-text-muted)] whitespace-pre-wrap">{entry.details}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
