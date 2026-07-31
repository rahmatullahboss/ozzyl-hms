import { X, Printer, Calendar, User, CreditCard, Hash, FileText, Stethoscope } from 'lucide-react';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '../../lib/queryKeys';

interface SettlementSlipModalProps {
  settlementId: number;
  onClose: () => void;
}

export default function SettlementSlipModal({ settlementId, onClose }: SettlementSlipModalProps) {
  const { t } = useTranslation();
  
  const { data, isLoading } = useApiQuery<{
    settlement: any;
    accruals: any[];
  }>(queryKeys.commissions.settlementDetail(settlementId), `/api/commissions/settlements/${settlementId}`);

  const handlePrint = () => {
    window.print();
  };

  if (isLoading || !data) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 shadow-modal">
          <div className="skeleton h-12 w-48 mb-4 mx-auto" />
          <div className="skeleton h-4 w-64 mb-2 mx-auto" />
          <div className="skeleton h-4 w-64 mx-auto" />
        </div>
      </div>
    );
  }

  const { settlement, accruals } = data;

  const currencySymbol = t('common:currencySymbol', '৳');
  const money = (val: number) => `${currencySymbol}${Math.round(val).toLocaleString()}`;

  const getIncentiveLabel = (type: string | undefined) => {
    if (!type) return '—';
    return t(`accounting:commission.${type}`, type.charAt(0).toUpperCase() + type.slice(1));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm overflow-y-auto print:p-0 print:bg-white print:static print:overflow-visible">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-modal w-full max-w-3xl overflow-hidden print:shadow-none print:max-w-full">
        {/* Header - Hidden on Print */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] print:hidden">
          <h3 className="font-semibold flex items-center gap-2">
            <Printer className="w-5 h-5 text-[var(--color-primary)]" />
            {t('accounting:commission.payoutSlip', 'Commission Payout Slip')}
          </h3>
          <div className="flex items-center gap-3">
            <button onClick={handlePrint} className="btn-primary">
              <Printer className="w-4 h-4" />
              {t('common:print', 'Print')}
            </button>
            <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Close"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Slip Content */}
        <div className="p-8 space-y-8 print:p-0">
          {/* Hospital Header */}
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold uppercase tracking-wider">{t('hospital:name', 'Ozzyl Health Care')}</h1>
            <p className="text-sm text-[var(--color-text-muted)]">{t('hospital:address', 'Dhaka, Bangladesh')}</p>
            <div className="inline-block px-4 py-1 border-2 border-slate-900 dark:border-white font-bold text-lg mt-4 uppercase">
              {t('accounting:commission.paymentVoucher', 'Payment Voucher')}
            </div>
          </div>

          {/* Meta Info */}
          <div className="grid grid-cols-2 gap-8 text-sm">
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-[var(--color-text-muted)]">
                <User className="w-4 h-4" />
                <span className="font-medium text-[var(--color-text)]">{t('accounting:commission.doctor', 'Doctor')}:</span>
                <span className="text-[var(--color-text)]">{settlement.doctor_name}</span>
              </div>
              {settlement.doctor_specialization && (
                <div className="flex items-center gap-3 text-[var(--color-text-muted)]">
                  <Stethoscope className="w-4 h-4" />
                  <span className="font-medium text-[var(--color-text)]">{t('accounting:specialty', 'Specialty')}:</span>
                  <span className="text-[var(--color-text)]">{settlement.doctor_specialization}</span>
                </div>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-[var(--color-text-muted)]">
                <Calendar className="w-4 h-4" />
                <span className="font-medium text-[var(--color-text)]">{t('common:date', 'Date')}:</span>
                <span className="text-[var(--color-text)] font-data">{settlement.settlement_date}</span>
              </div>
              <div className="flex items-center gap-3 text-[var(--color-text-muted)]">
                <Hash className="w-4 h-4" />
                <span className="font-medium text-[var(--color-text)]">{t('accounting:voucherNo', 'Voucher No')}:</span>
                <span className="text-[var(--color-text)] font-data font-bold">{settlement.voucher_number || `SETTLE-${settlement.id}`}</span>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">{t('common:date', 'Date')}</th>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">{t('accounting:patient', 'Patient')}</th>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">{t('accounting:service', 'Service')}</th>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">{t('accounting:role', 'Role')}</th>
                  <th className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-right">{t('accounting:amount', 'Amount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {accruals.map((a: any) => (
                  <tr key={a.id}>
                    <td className="px-4 py-3 font-data text-xs">{a.accrued_date}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{a.patient_name}</div>
                      <div className="text-[10px] text-[var(--color-text-muted)] font-data">{a.patient_code}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {a.test_name || (a.source_type === 'consultation_fee' ? t('accounting:consultation', 'Consultation') : a.source_type)}
                    </td>
                    <td className="px-4 py-3 text-[10px] uppercase font-bold">
                       {getIncentiveLabel(a.incentive_type)}
                     </td>
                    <td className="px-4 py-3 text-right font-data font-medium">{money(a.commission_amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 dark:bg-slate-800 font-bold">
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-right uppercase tracking-wider">{t('accounting:totalAmount', 'Total Payout')}</td>
                  <td className="px-4 py-4 text-right text-lg text-[var(--color-primary)] font-data">{money(settlement.total_amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Payment Info */}
          <div className="grid grid-cols-2 gap-8 text-sm items-start">
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl space-y-2">
                <div className="flex items-center gap-2 font-medium text-[var(--color-text)]">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                  {t('accounting:paymentDetails', 'Payment Details')}
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <span className="text-[var(--color-text-muted)]">{t('accounting:mode', 'Mode')}:</span>
                  <span className="capitalize">{t(`accounting:paymentMode.${settlement.payment_mode}`, { defaultValue: settlement.payment_mode }) as string}</span>
                  {settlement.reference_no && (
                    <>
                      <span className="text-[var(--color-text-muted)]">{t('accounting:reference', 'Reference')}:</span>
                      <span className="font-data">{settlement.reference_no}</span>
                    </>
                  )}
                </div>
              </div>
              {settlement.notes && (
                <div className="text-xs text-[var(--color-text-muted)] italic">
                  <FileText className="w-3 h-3 inline mr-1" />
                  {settlement.notes}
                </div>
              )}
            </div>

            {/* Signature Area */}
            <div className="flex flex-col items-center justify-end h-full pt-12 space-y-12">
              <div className="flex justify-between w-full px-8">
                <div className="text-center">
                  <div className="w-32 border-t border-slate-900 dark:border-white mb-2" />
                  <p className="text-[10px] uppercase font-bold">{t('accounting:signatureRecipient', "Recipient's Signature")}</p>
                </div>
                <div className="text-center">
                  <div className="w-32 border-t border-slate-900 dark:border-white mb-2" />
                  <p className="text-[10px] uppercase font-bold">{t('accounting:signatureAuthorized', 'Authorized Signature')}</p>
                </div>
              </div>
              <div className="text-[8px] text-[var(--color-text-muted)]">
                {t('accounting:systemGenerated', 'This is a system generated document.')} | {new Date().toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
