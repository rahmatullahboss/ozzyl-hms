import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, AlertTriangle, CheckCircle, Clock, Filter } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatCurrency } from '../../lib/format';
import { useSearchParams } from 'react-router';
import { formatDisplayDate } from '../../lib/date-utils';

type TabKey = 'pending' | 'approved' | 'rejected' | 'completed' | 'flagged';

const TABS: { key: TabKey }[] = [
  { key: 'pending' },
  { key: 'approved' },
  { key: 'rejected' },
  { key: 'completed' },
  { key: 'flagged' },
];

interface CreditNote {
  id: number;
  credit_note_no: string;
  bill_id: number;
  patient_name: string;
  refund_amount: number;
  total_amount?: number;
  reason: string;
  status: string;
  created_at: string;
  created_by?: number;
}

interface CreditNotesResponse {
  credit_notes: CreditNote[];
  creditNotes: CreditNote[];
  summary?: {
    totalRefundAmount: number;
  };
}

export default function RefundDetail() {
  const { t } = useTranslation('adminRefund');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabKey | null;
  const isValidTab = (val: string | null): val is TabKey =>
    val !== null && TABS.some(t => t.key === val);
  const [activeTab, setActiveTabRaw] = useState<TabKey>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'pending';
    }
    return isValidTab(tabParam) ? tabParam : 'pending';
  });
  const setActiveTab = (tab: TabKey) => {
    setActiveTabRaw(tab);
    setSearchParams({ tab });
  };

  const { data, isLoading } = useApiQuery<CreditNotesResponse>(
    queryKeys.billing.list({ approval: 'credit-notes' }),
    '/api/credit-notes',
  );

  const allRefunds = data?.credit_notes ?? data?.creditNotes ?? [];
  const filteredRefunds = allRefunds.filter(r => {
    if (activeTab === 'pending') return r.status === 'pending';
    if (activeTab === 'approved') return r.status === 'approved';
    if (activeTab === 'rejected') return r.status === 'rejected';
    if (activeTab === 'completed') return r.status === 'completed';
    if (activeTab === 'flagged') return r.status === 'flagged';
    return true;
  });

  const pendingCount = allRefunds.filter(r => r.status === 'pending').length;
  const approvedCount = allRefunds.filter(r => r.status === 'approved').length;
  const totalAmount = data?.summary?.totalRefundAmount
    ?? allRefunds.reduce((sum, r) => sum + Number(r.refund_amount ?? 0), 0);

  const statusBadge = (status: string) =>
    status === 'pending' ? 'badge-warning' :
    status === 'approved' ? 'badge-success' :
    status === 'rejected' ? 'badge-error' :
    'badge-neutral';

  return (
    <DashboardLayout role="hospital_admin">
      <div className="space-y-6">
        {/* Header */}
        <div className="page-header">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <RefreshCw className="h-6 w-6" />
              {t('refundDetail.title')}
            </h1>
            <p className="page-subtitle">{t('refundDetail.subtitle')}</p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-medium text-[var(--color-text-muted)]">{t('refundDetail.summary.pending')}</span>
            </div>
            <p className="text-2xl font-bold font-data text-[var(--color-text-primary)]">
              {isLoading ? '-' : pendingCount}
            </p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-medium text-[var(--color-text-muted)]">{t('refundDetail.summary.approved')}</span>
            </div>
            <p className="text-2xl font-bold font-data text-[var(--color-text-primary)]">
              {isLoading ? '-' : approvedCount}
            </p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <RefreshCw className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-medium text-[var(--color-text-muted)]">{t('refundDetail.summary.totalRequests')}</span>
            </div>
            <p className="text-2xl font-bold font-data text-[var(--color-text-primary)]">
              {isLoading ? '-' : allRefunds.length}
            </p>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-xs font-medium text-[var(--color-text-muted)]">{t('refundDetail.summary.totalAmount')}</span>
            </div>
            <p className="text-2xl font-bold font-data text-[var(--color-text-primary)]">
              {isLoading ? '-' : formatCurrency(totalAmount, { fractionDigits: 0 })}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-[var(--color-border)]">
          <div className="flex gap-1 overflow-x-auto">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                  activeTab === tab.key
                    ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                    : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                {t(`refundDetail.tabs.${tab.key}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Refund Table */}
        <div className="card p-5">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}
            </div>
          ) : filteredRefunds.length === 0 ? (
            <div className="text-center py-8">
              <Filter className="w-10 h-10 mx-auto text-[var(--color-text-muted)] opacity-30 mb-2" />
              <p className="text-sm text-[var(--color-text-muted)]">
                {t('refundDetail.noData', { tab: t(`refundDetail.tabs.${activeTab}`).toLowerCase() })}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('refundDetail.refundId')}</th>
                    <th>{t('refundDetail.bill')}</th>
                    <th>{t('refundDetail.patient')}</th>
                    <th>{t('refundDetail.amount')}</th>
                    <th>{t('refundDetail.reason')}</th>
                    <th>{t('refundDetail.requestedBy')}</th>
                    <th>{t('refundDetail.status')}</th>
                    <th>{t('refundDetail.date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRefunds.map(refund => (
                    <tr key={refund.id}>
                      <td className="font-medium">{refund.credit_note_no}</td>
                      <td>#{refund.bill_id}</td>
                      <td>{refund.patient_name ?? '-'}</td>
                      <td className="font-data text-red-600">{formatCurrency(Number(refund.refund_amount ?? 0))}</td>
                      <td className="max-w-[200px] truncate">{refund.reason ?? '-'}</td>
                      <td>{refund.created_by ? `User #${refund.created_by}` : '-'}</td>
                      <td>
                        <span className={`badge ${statusBadge(refund.status)}`}>
                          {t(`refundDetail.statusLabels.${refund.status}`, { defaultValue: refund.status })}
                        </span>
                      </td>
                      <td className="text-xs text-[var(--color-text-muted)]">
                        {formatDisplayDate(refund.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
