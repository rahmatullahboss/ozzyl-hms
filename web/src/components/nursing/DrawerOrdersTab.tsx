import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import type { BedGridItem } from './WardBedGrid';

interface DrawerOrdersTabProps {
  bed: BedGridItem;
}

interface MedicationOrder {
  id: number;
  medication_name: string;
  generic_name?: string;
  dose: string;
  route: string;
  frequency: string;
  duration?: string;
  instructions?: string;
  priority: string;
  status: string;
  start_datetime?: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  stat: 'bg-red-100 text-red-700',
  urgent: 'bg-amber-100 text-amber-700',
  routine: 'bg-blue-100 text-blue-700',
  prn: 'bg-purple-100 text-purple-700',
};

export default function DrawerOrdersTab({ bed }: DrawerOrdersTabProps) {
  const { t } = useTranslation(['nursing', 'common']);

  const ordersQuery = useApiQuery<{ Results: MedicationOrder[] }>(
    // Safe: parent PatientDrawer guards with if (!bed.patient_id) return null
    queryKeys.nursing.medicationOrders(bed.patient_id!),
    `/api/nursing/medication-orders?patient_id=${bed.patient_id}&status=active`,
  );
  const orders = ordersQuery.data?.Results ?? [];

  return (
    <div className="space-y-4" data-testid="orders-tab">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">
        {t('drawer.orders.title', { defaultValue: "Doctor's Orders" })}
      </h3>

      {orders.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)] text-center py-8" data-testid="orders-empty">
          {t('drawer.orders.noActive', { defaultValue: 'No active orders' })}
        </p>
      ) : (
        <ul className="space-y-3" data-testid="orders-list">
          {orders.map(order => (
            <li
              key={order.id}
              className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-border-light)]/30"
              data-testid={`order-${order.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    {order.medication_name}
                    {order.generic_name && (
                      <span className="text-xs text-[var(--color-text-muted)] ml-1">({order.generic_name})</span>
                    )}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    {order.dose} · {order.route} · {order.frequency}
                    {order.duration ? ` · ${order.duration}` : ''}
                  </p>
                  {order.instructions && (
                    <p className="text-xs text-[var(--color-text-muted)] mt-1 italic">
                      {order.instructions}
                    </p>
                  )}
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[order.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                  {order.priority.toUpperCase()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
