import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import toast from 'react-hot-toast';
import type { BedGridItem } from './WardBedGrid';
import { formatDisplayDate } from '../../lib/date-utils';

interface DrawerLabSampleTabProps {
  bed: BedGridItem;
}

interface InvestigationResult {
  id: number;
  test_name: string;
  status: string;
  ordered_date: string;
  priority: string;
  collected_at?: string;
  sent_to_lab_at?: string;
  notes?: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  collected: 'bg-blue-100 text-blue-700',
  sent: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-600',
  completed: 'bg-gray-100 text-gray-600',
};

const PRIORITY_COLORS: Record<string, string> = {
  stat: 'bg-red-100 text-red-700',
  urgent: 'bg-amber-100 text-amber-700',
  routine: 'bg-blue-100 text-blue-700',
};

export default function DrawerLabSampleTab({ bed }: DrawerLabSampleTabProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();

  const labQuery = useApiQuery<{ Results: InvestigationResult[] }>(
    queryKeys.nursing.investigationResults(bed.patient_id!),
    `/api/nursing/investigation-results?patient_id=${bed.patient_id}`,
  );
  const orders = labQuery.data?.Results ?? [];

  const statusMutation = useApiMutation<unknown, { id: number; status: string }>(
    'patch',
    (vars) => `/api/nursing/investigation-results/${vars.id}/status`,
    {
      onSuccess: () => {
        toast.success(t('drawer.lab.statusUpdated', { defaultValue: 'Sample status updated' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.nursing.investigationResults(bed.patient_id!) });
      },
      onError: () => toast.error(t('drawer.lab.statusUpdateFailed', { defaultValue: 'Failed to update sample status' })),
    },
  );

  const handleMarkCollected = (id: number) => {
    statusMutation.mutate({ id, status: 'collected' });
  };

  const handleMarkSent = (id: number) => {
    statusMutation.mutate({ id, status: 'sent' });
  };

  return (
    <div className="space-y-4" data-testid="lab-tab">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">
        {t('drawer.lab.title', { defaultValue: 'Lab / Sample Collection' })}
      </h3>

      {orders.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)] text-center py-8" data-testid="lab-empty">
          {t('drawer.lab.noOrders', { defaultValue: 'No pending lab orders' })}
        </p>
      ) : (
        <ul className="space-y-3" data-testid="lab-list">
          {orders.map(order => (
            <li
              key={order.id}
              className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-border-light)]/30"
              data-testid={`lab-order-${order.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    {order.test_name}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    {t('drawer.lab.ordered', { defaultValue: 'Ordered' })}: {formatDisplayDate(order.ordered_date)}
                  </p>
                  {order.notes && (
                    <p className="text-xs text-[var(--color-text-muted)] mt-1 italic">
                      {order.notes}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[order.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                    {order.priority.toUpperCase()}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[order.status] ?? 'bg-gray-100 text-gray-600'}`}
                    data-testid={`lab-status-${order.id}`}
                  >
                    {order.status}
                  </span>
                </div>
              </div>

              {order.status === 'pending' && (
                <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[var(--color-border)]">
                  <button
                    onClick={() => handleMarkCollected(order.id)}
                    disabled={statusMutation.isPending}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                    data-testid={`lab-collect-${order.id}`}
                  >
                    {t('drawer.lab.markCollected', { defaultValue: 'Mark Collected' })}
                  </button>
                </div>
              )}

              {order.status === 'collected' && (
                <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[var(--color-border)]">
                  <button
                    onClick={() => handleMarkSent(order.id)}
                    disabled={statusMutation.isPending}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors"
                    data-testid={`lab-send-${order.id}`}
                  >
                    {t('drawer.lab.markSent', { defaultValue: 'Send to Lab' })}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
