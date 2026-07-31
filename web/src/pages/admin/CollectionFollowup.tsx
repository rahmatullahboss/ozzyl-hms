import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Phone, RefreshCw } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatCurrency } from '../../lib/format';
import { useSearchParams } from 'react-router';
import { formatDisplayDate } from '../../lib/date-utils';

interface Followup {
  id: string;
  patientName: string;
  patientPhone: string;
  invoiceId: string;
  dueAmount: number;
  daysOverdue: number;
  lastFollowupDate: string | null;
  lastFollowupNote: string | null;
  nextFollowupDate: string | null;
  assignedTo: string;
  status: 'pending' | 'contacted' | 'promised' | 'escalated' | 'written_off';
  followupCount: number;
}

interface FollowupData {
  followups: Followup[];
  summary: { totalPending: number; contacted: number; promisedPayment: number; escalated: number; totalDue: number };
}

const STATUS_BADGES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  contacted: 'bg-blue-100 text-blue-700',
  promised: 'bg-green-100 text-green-700',
  escalated: 'bg-red-100 text-red-700',
  written_off: 'bg-gray-100 text-gray-600',
};

const TABS = ['all', 'pending', 'contacted', 'promised', 'escalated'] as const;
type Tab = (typeof TABS)[number];
const TAB_MAP: Record<Tab, Followup['status'] | null> = { all: null, pending: 'pending', contacted: 'contacted', promised: 'promised', escalated: 'escalated' };

const STATUS_LABEL_KEY: Record<string, string> = {
  pending: 'collectionFollowup.statusLabels.pending',
  contacted: 'collectionFollowup.statusLabels.contacted',
  promised: 'collectionFollowup.statusLabels.promised',
  escalated: 'collectionFollowup.statusLabels.escalated',
  written_off: 'collectionFollowup.statusLabels.writtenOff',
};

export default function CollectionFollowup() {
  const { t } = useTranslation('adminReceivables');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as Tab | null;
  const isValidTab = (val: string | null): val is Tab =>
    val !== null && TABS.includes(val as Tab);
  const [activeTab, setActiveTabRaw] = useState<Tab>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'all';
    }
    return isValidTab(tabParam) ? tabParam : 'all';
  });
  const setActiveTab = (tab: Tab) => {
    setActiveTabRaw(tab);
    setSearchParams({ tab });
  };
  const { data, isLoading, refetch } = useApiQuery<FollowupData>(
    queryKeys.admin.dueReceivables(),
    '/api/admin/collection-followups',
  );

  const summary = data?.summary;
  const followups = data?.followups ?? [];
  const filtered = TAB_MAP[activeTab] ? followups.filter(f => f.status === TAB_MAP[activeTab]) : followups;

  const tableHeaders: Array<{ key: string; label: string }> = [
    { key: 'patient', label: t('collectionFollowup.patient') },
    { key: 'phone', label: t('collectionFollowup.phone') },
    { key: 'invoice', label: t('collectionFollowup.invoice') },
    { key: 'due', label: t('collectionFollowup.due') },
    { key: 'daysOverdue', label: t('collectionFollowup.daysOverdue') },
    { key: 'followups', label: t('collectionFollowup.followups') },
    { key: 'assignedTo', label: t('collectionFollowup.assignedTo') },
    { key: 'nextFollowup', label: t('collectionFollowup.nextFollowup') },
    { key: 'status', label: t('collectionFollowup.status') },
  ];

  return (
    <DashboardLayout role="hospital_admin">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('collectionFollowup.title')}</h1>
            <p className="text-sm text-gray-500">{t('collectionFollowup.subtitle')}</p>
          </div>
          <button
            onClick={() => refetch()}
            className="btn-ghost p-2"
            title={t('collectionFollowup.refresh')}
            aria-label={t('collectionFollowup.refresh')}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="card p-4">
            <span className="text-xs text-gray-500">{t('collectionFollowup.totalPending')}</span>
            <p className="text-xl font-bold text-gray-900">{summary?.totalPending ?? 0}</p>
          </div>
          <div className="card p-4">
            <span className="text-xs text-gray-500">{t('collectionFollowup.contacted')}</span>
            <p className="text-xl font-bold text-blue-600">{summary?.contacted ?? 0}</p>
          </div>
          <div className="card p-4">
            <span className="text-xs text-gray-500">{t('collectionFollowup.promised')}</span>
            <p className="text-xl font-bold text-green-600">{summary?.promisedPayment ?? 0}</p>
          </div>
          <div className="card p-4">
            <span className="text-xs text-gray-500">{t('collectionFollowup.escalated')}</span>
            <p className="text-xl font-bold text-red-600">{summary?.escalated ?? 0}</p>
          </div>
          <div className="card p-4">
            <span className="text-xs text-gray-500">{t('collectionFollowup.totalDue')}</span>
            <p className="text-xl font-bold text-amber-600">{formatCurrency((summary?.totalDue ?? 0))}</p>
          </div>
        </div>

        <div className="card p-1.5 flex gap-1 flex-wrap" role="tablist">
          {TABS.map(tab => (
            <button
              key={tab}
              type="button"
              role="tab"
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
            >
              {t(`collectionFollowup.${tab}`)}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center text-gray-500">{t('collectionFollowup.noData')}</div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {tableHeaders.map(h => (
                      <th key={h.key} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {filtered.map(f => (
                    <tr key={f.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium">{f.patientName}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        <span className="inline-flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {f.patientPhone}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">{f.invoiceId}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-red-600">{formatCurrency(f.dueAmount)}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`font-medium ${f.daysOverdue > 30 ? 'text-red-600' : f.daysOverdue > 14 ? 'text-amber-600' : 'text-gray-600'}`}>
                          {f.daysOverdue}d
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">{f.followupCount}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{f.assignedTo}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{f.nextFollowupDate ? formatDisplayDate(f.nextFollowupDate) : '---'}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_BADGES[f.status] ?? 'bg-gray-100'}`}>
                          {t(STATUS_LABEL_KEY[f.status] ?? 'collectionFollowup.status')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
