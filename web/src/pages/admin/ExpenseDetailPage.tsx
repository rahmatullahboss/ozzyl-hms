import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import { CheckCircle, XCircle } from 'lucide-react';
import { formatCurrency } from '../../lib/format';
import { useSearchParams } from 'react-router';
import { safeT } from '../../lib/kpiLabels';

interface ExpenseDetail {
  id: string;
  expenseNo: string;
  category: string;
  department: string;
  amount: number;
  requestedBy: string;
  requestedAt: string;
  paidFrom: string;
  voucherNo?: string;
  approvedBy?: string;
  approvedAt?: string;
  status: string;
  description: string;
  attachmentUrl?: string;
  adminNote?: string;
}

const DETAIL_TABS = ['details', 'approvalHistory'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function ExpenseDetailPage() {
  const { t } = useTranslation('adminExpense');
  const tr = (key: string, fallback: string) => safeT(t, key, fallback);
  const { expenseId } = useParams<{ expenseId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as DetailTab | null;
  const isValidTab = (val: string | null): val is DetailTab =>
    val !== null && DETAIL_TABS.includes(val as DetailTab);
  const [activeTab, setActiveTabRaw] = useState<DetailTab>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'details';
    }
    return isValidTab(tabParam) ? tabParam : 'details';
  });
  const setActiveTab = (tab: DetailTab) => {
    setActiveTabRaw(tab);
    setSearchParams({ tab });
  };

  const { data, isLoading } = useApiQuery<ExpenseDetail>(
    queryKeys.admin.expenseDetail(expenseId ?? ''),
    `/api/admin/expenses/${expenseId}`
  );

  if (isLoading) {
    return <DashboardLayout role="hospital_admin"><div className="p-6">{tr('expenseDetail.loading', 'Loading...')}</div></DashboardLayout>;
  }

  if (!data) {
    return <DashboardLayout role="hospital_admin"><div className="p-6 text-gray-500">{tr('expenseDetail.notFound', 'Expense not found')}</div></DashboardLayout>;
  }

  const e = data;

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{tr('expenseDetail.title', 'Expense Detail')} #{e.expenseNo}</h1>
            <p className="text-sm text-gray-500">{e.category} — {e.department}</p>
          </div>
          <span className={`px-3 py-1.5 rounded-lg text-sm font-medium ${STATUS_BADGE[e.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {tr(`expenseDetail.statusLabels.${e.status}`, e.status)}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500">{tr('expenseDetail.amount', 'Amount')}</div>
            <div className="text-lg font-bold text-red-600">{formatCurrency(e.amount)}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500">{tr('expenseDetail.category', 'Category')}</div>
            <div className="text-lg font-semibold">{e.category}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500">{tr('expenseDetail.requestedBy', 'Requested By')}</div>
            <div className="text-lg font-semibold">{e.requestedBy}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500">{tr('expenseDetail.paidFrom', 'Paid From')}</div>
            <div className="text-lg font-semibold">{e.paidFrom}</div>
          </div>
        </div>

        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-semibold mb-2">{tr('expenseDetail.description', 'Description')}</h3>
          <p className="text-gray-600">{e.description}</p>
          {e.voucherNo && <p className="text-sm text-gray-500 mt-2">{tr('expenseDetail.voucher', 'Voucher')}: {e.voucherNo}</p>}
          {e.attachmentUrl && (
            <a href={e.attachmentUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-blue-600 hover:underline text-sm">
              📎 {tr('expenseDetail.viewVoucher', 'View Voucher')}
            </a>
          )}
        </div>

        <div className="flex gap-2">
          {DETAIL_TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {{ details: 'Details', approvalHistory: 'Approval History' }[tab]}
            </button>
          ))}
        </div>

        {activeTab === 'details' && (
          <div className="bg-white rounded-lg border p-6">
            <div className="grid grid-cols-2 gap-4">
              <div><span className="text-gray-500 text-sm">{tr('expenseDetail.fields.expenseNo', 'Expense No')}:</span><div className="font-medium">{e.expenseNo}</div></div>
              <div><span className="text-gray-500 text-sm">{tr('expenseDetail.fields.department', 'Department')}:</span><div className="font-medium">{e.department}</div></div>
              <div><span className="text-gray-500 text-sm">{tr('expenseDetail.fields.requested', 'Requested')}:</span><div className="font-medium">{new Date(e.requestedAt).toLocaleString()}</div></div>
              {e.approvedBy && <div><span className="text-gray-500 text-sm">{tr('expenseDetail.fields.approvedBy', 'Approved By')}:</span><div className="font-medium">{e.approvedBy}</div></div>}
              {e.approvedAt && <div><span className="text-gray-500 text-sm">{tr('expenseDetail.fields.approvedAt', 'Approved At')}:</span><div className="font-medium">{new Date(e.approvedAt).toLocaleString()}</div></div>}
            </div>
          </div>
        )}

        {activeTab === 'approvalHistory' && (
          <div className="bg-white rounded-lg border p-6">
            <p className="text-sm text-gray-500">{tr('expenseDetail.approvalHistoryPlaceholder', 'Approval history will be shown here')}</p>
          </div>
        )}

        {e.status === 'pending' && (
          <div className="flex gap-3 justify-end">
            <button className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 flex items-center gap-2">
              <XCircle className="w-4 h-4" /> {tr('expenseDetail.reject', 'Reject')}
            </button>
            <button className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" /> {tr('expenseDetail.approve', 'Approve')}
            </button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
