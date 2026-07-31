import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import DashboardLayout from '../../components/DashboardLayout';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../../lib/format';

interface Denomination {
  note: number;
  count: number;
  total: number;
}

interface HandoverDetail {
  id: string;
  sessionId?: number;
  counter: string;
  sessionNo: string;
  outgoingStaff: string;
  incomingStaff: string;
  shiftOpenAmount: number;
  totalCashReceived: number;
  totalCashPaidOut: number;
  declaredCash: number;
  incomingCount: number;
  receivedCash: number;
  variance: number;
  status: string;
  notes: string;
  handoverTime: string;
  denominations: Denomination[];
}

type HandoverDetailResponse = HandoverDetail & { handover?: HandoverDetail };

export default function ShiftHandoverDetail() {
  const { t } = useTranslation('adminCash');
  const { handoverId } = useParams<{ handoverId: string }>();
  const queryClient = useQueryClient();

  const { data, isLoading } = useApiQuery<HandoverDetailResponse>(
    queryKeys.admin.shiftHandoverDetail(handoverId ?? ''),
    `/api/admin/shift-handover/${handoverId}`
  );
  const acceptReport = useApiMutation<{ snapshot?: { status?: string } }, { sessionId: number }>(
    'post',
    (variables) => `/api/reports/shift-handover/sessions/${variables.sessionId}/accept`,
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.admin.shiftHandoverDetail(handoverId ?? '') });
      },
    },
  );

  if (isLoading) {
    return <DashboardLayout role="hospital_admin"><div className="p-6">{t('shiftHandoverDetail.loading')}</div></DashboardLayout>;
  }

  if (!data) {
    return <DashboardLayout role="hospital_admin"><div className="p-6 text-gray-500">{t('shiftHandoverDetail.notFound')}</div></DashboardLayout>;
  }

  const h = data.handover ?? data;
  const canAcceptReport = Number(h.sessionId ?? 0) > 0 && !['accepted', 'verified'].includes(String(h.status));

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('shiftHandoverDetail.title')} #{h.id}</h1>
            <p className="text-sm text-gray-500">{h.counter} — {t('shiftHandoverDetail.session')}: {h.sessionNo}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1.5 rounded-lg text-sm font-medium ${h.status === 'verified' || h.status === 'accepted' ? 'bg-green-100 text-green-700' : h.status === 'disputed' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
              {t(`shiftHandoverDetail.statusLabels.${h.status}`, { defaultValue: h.status })}
            </span>
            {canAcceptReport ? (
              <button
                type="button"
                className="btn-primary px-3 py-1.5 text-sm"
                disabled={acceptReport.isPending}
                onClick={() => acceptReport.mutate({ sessionId: Number(h.sessionId) })}
              >
                {acceptReport.isPending ? 'Accepting…' : 'Accept report'}
              </button>
            ) : null}
          </div>
        </div>

        {/* Staff Info */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500">{t('shiftHandoverDetail.outgoingStaff')}</div>
            <div className="text-lg font-semibold">{h.outgoingStaff}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500">{t('shiftHandoverDetail.incomingStaff')}</div>
            <div className="text-lg font-semibold">{h.incomingStaff}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500">{t('shiftHandoverDetail.handoverTime')}</div>
            <div className="text-lg font-semibold">{new Date(h.handoverTime).toLocaleString()}</div>
          </div>
        </div>

        {/* Cash Summary */}
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-semibold mb-4">{t('shiftHandoverDetail.cashSummary')}</h3>
          <div className="space-y-3">
            <div className="flex justify-between py-2 border-b"><span className="text-gray-600">{t('shiftHandoverDetail.flow.shiftOpenAmount')}</span><span className="font-medium">{formatCurrency(h.shiftOpenAmount)}</span></div>
            <div className="flex justify-between py-2 border-b"><span className="text-green-600">{t('shiftHandoverDetail.flow.totalCashReceived')}</span><span className="font-medium text-green-600">{formatCurrency(h.totalCashReceived)}</span></div>
            <div className="flex justify-between py-2 border-b"><span className="text-red-600">{t('shiftHandoverDetail.flow.totalCashPaidOut')}</span><span className="font-medium text-red-600">{formatCurrency(h.totalCashPaidOut)}</span></div>
            <div className="flex justify-between py-3 bg-blue-50 rounded-lg px-4"><span className="font-semibold text-blue-700">{t('shiftHandoverDetail.flow.declaredCash')}</span><span className="font-bold text-blue-700 text-lg">{formatCurrency(h.declaredCash)}</span></div>
          </div>
        </div>

        {/* Denomination Breakdown */}
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-semibold mb-4">{t('shiftHandoverDetail.denominationBreakdown')}</h3>
          {h.denominations.length === 0 ? (
            <div className="text-center py-8 text-gray-500">{t('shiftHandoverDetail.noDenominationData')}</div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">{t('shiftHandoverDetail.denominationTable.noteCoin')}</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{t('shiftHandoverDetail.denominationTable.count')}</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-600">{t('shiftHandoverDetail.denominationTable.total')}</th>
                </tr>
              </thead>
              <tbody>
                {h.denominations.map((d, i) => (
                  <tr key={i} className="border-t hover:bg-gray-50">
                    <td className="py-3 px-4 text-sm font-medium">৳{d.note}</td>
                    <td className="py-3 px-4 text-sm text-right">{d.count}</td>
                    <td className="py-3 px-4 text-sm text-right font-medium">{formatCurrency(d.total)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 bg-gray-50 font-bold">
                  <td className="py-3 px-4 text-sm">{t('shiftHandoverDetail.denominationTable.total')}</td>
                  <td className="py-3 px-4 text-sm text-right">{h.denominations.reduce((s, d) => s + d.count, 0)}</td>
                  <td className="py-3 px-4 text-sm text-right">{formatCurrency(h.denominations.reduce((s, d) => s + d.total, 0))}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        {/* Variance */}
        <div className={`rounded-lg border-2 p-6 ${h.variance === 0 ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}`}>
          <div className="flex items-center gap-3">
            {h.variance === 0 ? (
              <CheckCircle className="w-8 h-8 text-green-600" />
            ) : (
              <AlertTriangle className="w-8 h-8 text-red-600" />
            )}
            <div>
              <div className={`text-lg font-bold ${h.variance === 0 ? 'text-green-700' : 'text-red-700'}`}>
                {h.variance === 0
                  ? t('shiftHandoverDetail.variance.noVariance')
                  : `${t('shiftHandoverDetail.variance.variance')}: ${formatCurrency(Math.abs(h.variance))} ${h.variance > 0 ? t('shiftHandoverDetail.variance.over') : t('shiftHandoverDetail.variance.under')}`}
              </div>
              <div className="text-sm text-gray-600">
                {t('shiftHandoverDetail.variance.declared')}: {formatCurrency(h.declaredCash)} | {t('shiftHandoverDetail.variance.received')}: {formatCurrency(h.receivedCash)}
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        {h.notes && (
          <div className="bg-white rounded-lg border p-6">
            <h3 className="font-semibold mb-2">{t('shiftHandoverDetail.notes')}</h3>
            <p className="text-gray-600">{h.notes}</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
