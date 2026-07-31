import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, CheckCircle, XCircle, RefreshCw, FileText } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import EmptyState from '../../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDisplayDate } from '../../lib/date-utils';

interface ReturnItem {
  id: number;
  saleItemId: number;
  medicineId: number;
  medicine_name?: string;
  returnedQty: number;
  unitPrice: number;
  batchNo?: string;
  reason?: string;
}

interface PharmacyReturn {
  id: number;
  return_no: string;
  patient_name?: string;
  patientId?: number;
  saleInvoiceId: number;
  return_date: string;
  total_amount: number;
  remarks?: string;
  status: 'pending' | 'approved' | 'rejected';
  items?: ReturnItem[];
  created_by_name?: string;
}

export default function PharmReturnList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading, refetch } = useApiQuery<{ data: PharmacyReturn[] }>(
    queryKeys.pharmacy.returns(),
    '/api/pharmacy/returns',
  );

  const approveMutation = useApiMutation('put', (id: number) => `/api/pharmacy/returns/${id}/approve`, {
    onSuccess: () => {
      toast.success(t('returnApproved', 'Return approved'));
      queryClient.invalidateQueries({ queryKey: queryKeys.pharmacy.returns() });
    },
    onError: (err) => toast.error(err.message || t('returnApprovalFailed', 'Failed')),
  });

  const returns = data?.data ?? [];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <ArrowLeftRight className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('returns.title', 'Pharmacy Returns')}</h1>
              <p className="section-subtitle">{t('returns.subtitle', 'Manage medicine returns and approvals')}</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={() => refetch()} className="btn-ghost"><RefreshCw className="w-4 h-4" /></button>
        </div>

        <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('returns.returnNo', 'Return #')}</th>
                <th>{t('returns.patient', 'Patient')}</th>
                <th>{t('returns.invoice', 'Invoice')}</th>
                <th>{t('returns.date', 'Date')}</th>
                <th>{t('returns.amount', 'Amount')}</th>
                <th>{t('returns.status', 'Status')}</th>
                <th className="text-right">{t('common:actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="text-center py-4 text-gray-500">{t('common:loading')}</td></tr>
              ) : returns.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8"><EmptyState icon={<ArrowLeftRight className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('returns.none', 'No returns found')} description="" /></td></tr>
              ) : returns.map(r => (
                <>
                  <tr key={r.id} className={expandedId === r.id ? 'bg-gray-50 dark:bg-gray-800/50' : ''}>
                    <td className="font-medium">
                      <button onClick={() => setExpandedId(expandedId === r.id ? null : r.id)} className="text-indigo-600 hover:underline text-left">
                        {r.return_no || `#${r.id}`}
                      </button>
                    </td>
                    <td>{r.patient_name || `#${r.patientId}` || '-'}</td>
                    <td>#{r.saleInvoiceId}</td>
                    <td className="text-xs">{r.return_date ? formatDisplayDate(r.return_date) : '-'}</td>
                    <td className="font-medium">{Number(r.total_amount).toFixed(2)}</td>
                    <td>
                      <span className={`badge text-xs ${
                        r.status === 'approved' ? 'bg-green-100 text-green-700' : r.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>{r.status}</span>
                    </td>
                    <td className="text-right">
                      {r.status === 'pending' && (
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => approveMutation.mutate(r.id)} className="text-green-600 hover:bg-green-50 p-1.5 rounded" title={t('returns.approve', 'Approve')}>
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {expandedId === r.id && r.items && (
                    <tr key={`${r.id}-items`}>
                      <td colSpan={7} className="bg-gray-50 dark:bg-gray-800/50 p-3">
                        <div className="text-xs font-medium text-gray-500 mb-2">{t('returns.items', 'Return Items')}:</div>
                        <table className="table-base text-sm">
                          <thead><tr><th>{t('medicine', 'Medicine')}</th><th>{t('quantity')}</th><th>{t('unitPrice')}</th><th>{t('returns.batch', 'Batch')}</th><th>{t('returns.reason', 'Reason')}</th></tr></thead>
                          <tbody>
                            {r.items.map(item => (
                              <tr key={item.id}>
                                <td>{item.medicine_name || `#${item.medicineId}`}</td>
                                <td>{item.returnedQty}</td>
                                <td>{Number(item.unitPrice).toFixed(2)}</td>
                                <td>{item.batchNo || '-'}</td>
                                <td className="text-gray-500">{item.reason || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
