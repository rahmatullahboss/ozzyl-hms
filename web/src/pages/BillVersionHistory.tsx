import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { History, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

interface BillVersion {
  id: number;
  bill_id: number;
  version_number: number;
  edited_by: number;
  edit_reason: string | null;
  total: number;
  discount: number;
  discount_reason: string | null;
  tax_total: number;
  due: number;
  test_bill: number;
  admission_bill: number;
  doctor_visit_bill: number;
  operation_bill: number;
  medicine_bill: number;
  items_snapshot: Array<{
    item_category: string;
    description: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
  created_at: string;
}

const fmt = (paisa: number) => `৳${(paisa / 100).toFixed(2)}`;
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-BD', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function BillVersionHistory({ billId }: { billId: number }) {
  const { t } = useTranslation(['tenantBilling']);
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);

  const { data, isLoading } = useApiQuery<{
    data: BillVersion[];
    pagination: { total: number };
  }>(queryKeys.billing.billVersions(billId), `/api/bill-versions/${billId}`);

  const versions = data?.data || [];

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 text-gray-400">
        <History className="w-10 h-10 mb-2" />
        <p>{t('billVersionHistory.emptyState')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1">
        <History className="w-4 h-4" />{' '}
        {t('billVersionHistory.heading', { count: versions.length })}
      </h3>
      {versions.map((v) => (
        <div key={v.id} className="border rounded-lg p-3 text-sm">
          <div
            className="flex items-center justify-between cursor-pointer"
            onClick={() =>
              setExpandedVersion(expandedVersion === v.id ? null : v.id)
            }
          >
            <div className="flex items-center gap-3">
              <span className="badge badge-sm">v{v.version_number}</span>
              <span className="text-gray-600">{fmtDate(v.created_at)}</span>
              {v.edit_reason && (
                <span className="text-gray-500">— {v.edit_reason}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="font-medium">{fmt(v.total)}</span>
              {expandedVersion === v.id ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </div>
          </div>
          {expandedVersion === v.id && (
            <div className="mt-3 pt-3 border-t">
              <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                <div>
                  {t('billVersionHistory.total')}: <strong>{fmt(v.total)}</strong>
                </div>
                <div>
                  {t('billVersionHistory.discount')}:{' '}
                  <strong>{fmt(v.discount)}</strong>
                </div>
                <div>
                  {t('billVersionHistory.tax')}:{' '}
                  <strong>{fmt(v.tax_total)}</strong>
                </div>
                <div>
                  {t('billVersionHistory.due')}: <strong>{fmt(v.due)}</strong>
                </div>
              </div>
              <table className="table table-xs w-full">
                <thead>
                  <tr>
                    <th>{t('billVersionHistory.category')}</th>
                    <th>{t('billVersionHistory.description')}</th>
                    <th>{t('billVersionHistory.qty')}</th>
                    <th>{t('billVersionHistory.price')}</th>
                    <th>{t('billVersionHistory.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {v.items_snapshot.map((item, i) => (
                    <tr key={i}>
                      <td>{item.item_category}</td>
                      <td>{item.description}</td>
                      <td>{item.quantity}</td>
                      <td>{fmt(item.unit_price)}</td>
                      <td>{fmt(item.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
