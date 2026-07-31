import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import { formatCurrency } from '../../lib/format';
import { useSearchParams } from 'react-router';
import { formatDisplayDate } from '../../lib/date-utils';
import { safeT } from '../../lib/kpiLabels';

interface PayoutDetail {
  doctorId: string;
  doctorName: string;
  department: string;
  totalEarnings: number;
  totalPaid: number;
  balance: number;
  opdVisits: number;
  opdIncome: number;
  procedureIncome: number;
  diagnosticShare: number;
  earnings: Array<{ date: string; patient: string; service: string; amount: number }>;
  payouts: Array<{ id: string; amount: number; date: string; method: string; reference: string; status: string }>;
  commissionRules: Array<{ serviceType: string; rate: number; minAmount: number; maxAmount: number }>;
}

const DETAIL_TABS = ['earnings', 'payoutHistory', 'commissionRules'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

export default function DoctorPayoutDetail() {
  const { t } = useTranslation('adminPayout');
  const tr = (key: string, fallback: string) => safeT(t, key, fallback);
  const { doctorId } = useParams<{ doctorId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as DetailTab | null;
  const isValidTab = (val: string | null): val is DetailTab =>
    val !== null && DETAIL_TABS.includes(val as DetailTab);
  const [activeTab, setActiveTabRaw] = useState<DetailTab>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'earnings';
    }
    return isValidTab(tabParam) ? tabParam : 'earnings';
  });
  const setActiveTab = (tab: DetailTab) => {
    setActiveTabRaw(tab);
    setSearchParams({ tab });
  };

  const { data, isLoading } = useApiQuery<PayoutDetail>(
    queryKeys.admin.doctorPayoutDetail(doctorId ?? ''),
    `/api/admin/doctor-payout/${doctorId}`
  );

  if (isLoading) {
    return <DashboardLayout role="hospital_admin"><div className="p-6">{tr('doctorPayoutDetail.loading', 'Loading...')}</div></DashboardLayout>;
  }

  if (!data) {
    return <DashboardLayout role="hospital_admin"><div className="p-6 text-gray-500">{tr('doctorPayoutDetail.notFound', 'Doctor payout not found')}</div></DashboardLayout>;
  }

  const d = data;

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{tr('doctorPayoutDetail.title', 'Doctor Payout Detail')} — {d.doctorName}</h1>
          <p className="text-sm text-gray-500">{d.department}</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500">{tr('doctorPayoutDetail.summary.opdVisits', 'OPD Visits')}</div>
            <div className="text-lg font-bold">{d.opdVisits}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500">{tr('doctorPayoutDetail.summary.opdIncome', 'OPD Income')}</div>
            <div className="text-lg font-bold text-green-600">{formatCurrency(d.opdIncome)}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500">{tr('doctorPayoutDetail.summary.procedureIncome', 'Procedure Income')}</div>
            <div className="text-lg font-bold text-blue-600">{formatCurrency(d.procedureIncome)}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500">{tr('doctorPayoutDetail.summary.diagnosticShare', 'Diagnostic Share')}</div>
            <div className="text-lg font-bold text-purple-600">{formatCurrency(d.diagnosticShare)}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500">{tr('doctorPayoutDetail.summary.totalEarnings', 'Total Earnings')}</div>
            <div className="text-lg font-bold text-green-700">{formatCurrency(d.totalEarnings)}</div>
          </div>
          <div className="bg-white rounded-lg border-2 border-blue-500 p-4">
            <div className="text-xs text-blue-600 font-medium">{tr('doctorPayoutDetail.summary.balance', 'Balance')}</div>
            <div className="text-lg font-bold text-blue-700">{formatCurrency(d.balance)}</div>
          </div>
        </div>

        <div className="flex gap-2">
          {DETAIL_TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {{ earnings: 'Earnings', payoutHistory: 'Payout History', commissionRules: 'Commission Rules' }[tab]}
            </button>
          ))}
        </div>

        {activeTab === 'earnings' && (
          <div className="bg-white rounded-lg border overflow-hidden">
            {d.earnings.length === 0 ? (
              <div className="text-center py-12 text-gray-500">{tr('doctorPayoutDetail.empty.earnings', 'No earnings found')}</div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{tr('doctorPayoutDetail.earningsTable.date', 'Date')}</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{tr('doctorPayoutDetail.earningsTable.patient', 'Patient')}</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{tr('doctorPayoutDetail.earningsTable.service', 'Service')}</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{tr('doctorPayoutDetail.earningsTable.amount', 'Amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.earnings.map((e, i) => (
                    <tr key={i} className="border-t hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm text-gray-500">{formatDisplayDate(e.date)}</td>
                      <td className="py-3 px-4 text-sm font-medium">{e.patient}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{e.service}</td>
                      <td className="py-3 px-4 text-sm text-right font-medium text-green-600">{formatCurrency(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'payoutHistory' && (
          <div className="bg-white rounded-lg border overflow-hidden">
            {d.payouts.length === 0 ? (
              <div className="text-center py-12 text-gray-500">{tr('doctorPayoutDetail.empty.payouts', 'No payouts found')}</div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{tr('doctorPayoutDetail.payoutTable.id', 'Payout ID')}</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{tr('doctorPayoutDetail.payoutTable.amount', 'Amount')}</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{tr('doctorPayoutDetail.payoutTable.date', 'Date')}</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{tr('doctorPayoutDetail.payoutTable.method', 'Method')}</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{tr('doctorPayoutDetail.payoutTable.reference', 'Reference')}</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{tr('doctorPayoutDetail.payoutTable.status', 'Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.payouts.map((p) => (
                    <tr key={p.id} className="border-t hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm font-medium">{p.id}</td>
                      <td className="py-3 px-4 text-sm text-right font-medium">{formatCurrency(p.amount)}</td>
                      <td className="py-3 px-4 text-sm text-gray-500">{formatDisplayDate(p.date)}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{p.method}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{p.reference}</td>
                      <td className="py-3 px-4 text-sm">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${p.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {tr(`doctorPayoutDetail.statusLabels.${p.status}`, p.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'commissionRules' && (
          <div className="bg-white rounded-lg border overflow-hidden">
            {d.commissionRules.length === 0 ? (
              <div className="text-center py-12 text-gray-500">{tr('doctorPayoutDetail.empty.commissionRules', 'No commission rules found')}</div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{tr('doctorPayoutDetail.commissionTable.serviceType', 'Service Type')}</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{tr('doctorPayoutDetail.commissionTable.rate', 'Rate')}</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{tr('doctorPayoutDetail.commissionTable.minAmount', 'Min Amount')}</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{tr('doctorPayoutDetail.commissionTable.maxAmount', 'Max Amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.commissionRules.map((r, i) => (
                    <tr key={i} className="border-t hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm font-medium">{r.serviceType}</td>
                      <td className="py-3 px-4 text-sm text-right">{r.rate}%</td>
                      <td className="py-3 px-4 text-sm text-right">{formatCurrency(r.minAmount)}</td>
                      <td className="py-3 px-4 text-sm text-right">{formatCurrency(r.maxAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
