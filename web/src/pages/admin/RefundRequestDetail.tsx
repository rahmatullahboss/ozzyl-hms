import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import { CheckCircle, XCircle, MessageSquare, ArrowUpRight } from 'lucide-react';
import { formatCurrency } from '../../lib/format';
import { useSearchParams } from 'react-router';
import { formatDisplayDate } from '../../lib/date-utils';

interface RefundRequestDetail {
  id: string;
  creditNoteNo: string;
  invoiceId: string;
  invoiceNo: string;
  patientName: string;
  patientMobile: string;
  originalAmount: number;
  refundAmount: number;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  counter: string;
  status: string;
  attachmentUrl?: string;
  adminNote?: string;
  services: Array<{ name: string; amount: number; delivered: boolean }>;
  previousPatientRefunds: Array<{ id: string; amount: number; date: string; status: string }>;
  previousStaffRefunds: Array<{ id: string; amount: number; date: string; status: string }>;
}

const DETAIL_TABS = ['Invoice Details', 'Services', 'History', 'Notes'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

const DETAIL_TAB_KEYS: Record<DetailTab, string> = {
  'Invoice Details': 'invoiceDetails',
  Services: 'services',
  History: 'history',
  Notes: 'notes',
};

export default function RefundRequestDetail() {
  const { t } = useTranslation('adminRefund');
  const { refundId } = useParams<{ refundId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as DetailTab | null;
  const isValidTab = (val: string | null): val is DetailTab =>
    val !== null && DETAIL_TABS.includes(val as DetailTab);
  const [activeTab, setActiveTabRaw] = useState<DetailTab>(() => {
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      return isValidTab(urlTab) ? urlTab : 'Invoice Details';
    }
    return isValidTab(tabParam) ? tabParam : 'Invoice Details';
  });
  const setActiveTab = (tab: DetailTab) => {
    setActiveTabRaw(tab);
    setSearchParams({ tab });
  };

  const { data, isLoading } = useApiQuery<RefundRequestDetail>(
    queryKeys.admin.refundDetail(refundId ?? ''),
    `/api/admin/refunds/${refundId}`
  );

  if (isLoading) {
    return <DashboardLayout role="hospital_admin"><div className="p-6">{t('refundRequestDetail.loading')}</div></DashboardLayout>;
  }

  if (!data) {
    return <DashboardLayout role="hospital_admin"><div className="p-6 text-gray-500">{t('refundRequestDetail.notFound')}</div></DashboardLayout>;
  }

  const r = data;

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('refundRequestDetail.title')} #{r.creditNoteNo}</h1>
            <p className="text-sm text-gray-500">
              {t('refundRequestDetail.invoice')}: {r.invoiceNo} — {t('refundRequestDetail.patient')}: {r.patientName} — {r.patientMobile}
            </p>
          </div>
          <span className={`px-3 py-1.5 rounded-lg text-sm font-medium ${r.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : r.status === 'approved' ? 'bg-green-100 text-green-700' : r.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
            {t(`refundRequestDetail.statusLabels.${r.status}`, { defaultValue: r.status })}
          </span>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500">{t('refundRequestDetail.originalAmount')}</div>
            <div className="text-lg font-bold">{formatCurrency(r.originalAmount)}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500">{t('refundRequestDetail.refundAmount')}</div>
            <div className="text-lg font-bold text-red-600">{formatCurrency(r.refundAmount)}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500">{t('refundRequestDetail.requestedBy')}</div>
            <div className="text-lg font-semibold">{r.requestedBy}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500">{t('refundRequestDetail.counter')}</div>
            <div className="text-lg font-semibold">{r.counter}</div>
          </div>
        </div>

        {/* Reason */}
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-semibold mb-2">{t('refundRequestDetail.reason')}</h3>
          <p className="text-gray-600">{r.reason}</p>
          {r.attachmentUrl && (
            <a href={r.attachmentUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-blue-600 hover:underline text-sm">
              📎 {t('refundRequestDetail.viewAttachment')}
            </a>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {DETAIL_TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {t(`refundRequestDetail.tabs.${DETAIL_TAB_KEYS[tab]}`)}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'Invoice Details' && (
          <div className="bg-white rounded-lg border p-6">
            <div className="grid grid-cols-2 gap-4">
              <div><span className="text-gray-500 text-sm">{t('refundRequestDetail.fields.invoiceNo')}:</span><div className="font-medium">{r.invoiceNo}</div></div>
              <div><span className="text-gray-500 text-sm">{t('refundRequestDetail.fields.invoiceId')}:</span><div className="font-medium">#{r.invoiceId}</div></div>
              <div><span className="text-gray-500 text-sm">{t('refundRequestDetail.fields.patient')}:</span><div className="font-medium">{r.patientName}</div></div>
              <div><span className="text-gray-500 text-sm">{t('refundRequestDetail.fields.mobile')}:</span><div className="font-medium">{r.patientMobile}</div></div>
              <div><span className="text-gray-500 text-sm">{t('refundRequestDetail.fields.requested')}:</span><div className="font-medium">{new Date(r.requestedAt).toLocaleString()}</div></div>
              <div><span className="text-gray-500 text-sm">{t('refundRequestDetail.fields.counter')}:</span><div className="font-medium">{r.counter}</div></div>
            </div>
          </div>
        )}

        {activeTab === 'Services' && (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('refundRequestDetail.serviceTable.service')}</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{t('refundRequestDetail.serviceTable.amount')}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('refundRequestDetail.serviceTable.delivered')}</th>
                </tr>
              </thead>
              <tbody>
                {r.services.map((s, i) => (
                  <tr key={i} className="border-t hover:bg-gray-50">
                    <td className="py-3 px-4 text-sm font-medium">{s.name}</td>
                    <td className="py-3 px-4 text-sm text-right">{formatCurrency(s.amount)}</td>
                    <td className="py-3 px-4 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${s.delivered ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {s.delivered ? t('refundRequestDetail.yes') : t('refundRequestDetail.no')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'History' && (
          <div className="space-y-4">
            <div className="bg-white rounded-lg border p-6">
              <h3 className="font-semibold mb-3">{t('refundRequestDetail.history.previousPatientRefunds')}</h3>
              {r.previousPatientRefunds.length === 0 ? (
                <p className="text-sm text-gray-500">{t('refundRequestDetail.history.noPreviousRefunds')}</p>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left py-2 px-4 text-sm font-medium text-gray-600">{t('refundRequestDetail.history.id')}</th>
                      <th className="text-right py-2 px-4 text-sm font-medium text-gray-600">{t('refundRequestDetail.history.amount')}</th>
                      <th className="text-left py-2 px-4 text-sm font-medium text-gray-600">{t('refundRequestDetail.history.date')}</th>
                      <th className="text-left py-2 px-4 text-sm font-medium text-gray-600">{t('refundRequestDetail.history.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.previousPatientRefunds.map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="py-2 px-4 text-sm">{p.id}</td>
                        <td className="py-2 px-4 text-sm text-right">{formatCurrency(p.amount)}</td>
                        <td className="py-2 px-4 text-sm">{formatDisplayDate(p.date)}</td>
                        <td className="py-2 px-4 text-sm"><span className={`px-2 py-1 rounded text-xs ${p.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{t(`refundRequestDetail.statusLabels.${p.status}`, { defaultValue: p.status })}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="bg-white rounded-lg border p-6">
              <h3 className="font-semibold mb-3">{t('refundRequestDetail.history.previousStaffRefunds')}</h3>
              {r.previousStaffRefunds.length === 0 ? (
                <p className="text-sm text-gray-500">{t('refundRequestDetail.history.noPreviousStaffRefunds')}</p>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left py-2 px-4 text-sm font-medium text-gray-600">{t('refundRequestDetail.history.id')}</th>
                      <th className="text-right py-2 px-4 text-sm font-medium text-gray-600">{t('refundRequestDetail.history.amount')}</th>
                      <th className="text-left py-2 px-4 text-sm font-medium text-gray-600">{t('refundRequestDetail.history.date')}</th>
                      <th className="text-left py-2 px-4 text-sm font-medium text-gray-600">{t('refundRequestDetail.history.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.previousStaffRefunds.map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="py-2 px-4 text-sm">{p.id}</td>
                        <td className="py-2 px-4 text-sm text-right">{formatCurrency(p.amount)}</td>
                        <td className="py-2 px-4 text-sm">{formatDisplayDate(p.date)}</td>
                        <td className="py-2 px-4 text-sm"><span className={`px-2 py-1 rounded text-xs ${p.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{t(`refundRequestDetail.statusLabels.${p.status}`, { defaultValue: p.status })}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {activeTab === 'Notes' && (
          <div className="bg-white rounded-lg border p-6">
            <h3 className="font-semibold mb-2">{t('refundRequestDetail.adminNote')}</h3>
            <p className="text-gray-600">{r.adminNote || t('refundRequestDetail.noNotes')}</p>
          </div>
        )}

        {/* Action Buttons */}
        {r.status === 'pending' && (
          <div className="flex gap-3 justify-end">
            <button className="px-4 py-2 bg-gray-100 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> {t('refundRequestDetail.actions.askClarification')}
            </button>
            <button className="px-4 py-2 bg-yellow-100 text-yellow-700 rounded-lg text-sm font-medium hover:bg-yellow-200 flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4" /> {t('refundRequestDetail.actions.escalate')}
            </button>
            <button className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 flex items-center gap-2">
              <XCircle className="w-4 h-4" /> {t('refundRequestDetail.actions.reject')}
            </button>
            <button className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" /> {t('refundRequestDetail.actions.approve')}
            </button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
