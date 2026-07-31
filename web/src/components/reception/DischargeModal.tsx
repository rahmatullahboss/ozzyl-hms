import { useState, useEffect, useCallback, useRef } from 'react';
import { getReceptionBillPrintPath } from '../../lib/receptionBilling';
import { X, AlertTriangle, CheckCircle, CreditCard, ReceiptText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { api, ApiClientError } from '../../lib/apiClient';
import type { DischargeFinancialSummary } from '../../lib/ipdDischargeFinancial';

type AdmissionInfo = {
  admissionId: number;
  admissionNo?: string | null;
  patientName?: string | null;
  patientId: number;
  wardName?: string | null;
  bedNumber?: string | null;
};

type DischargeBillResponse = {
  bill_id?: number;
  invoice_no?: string;
  deposit_refunded?: number;
  refund_receipt_no?: string | null;
  discharge_mode?: 'settled' | 'credit_pending';
  approval_request_id?: number | null;
  credit_approval_status?: 'pending' | 'approved' | 'rejected' | null;
  total_outstanding?: number;
  message?: string;
};

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString('en-IN');
}

function createDischargeIdempotencyKey(mode: 'settled' | 'credit_pending', admissionId: number): string {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `ipd-discharge-${mode}-${admissionId}-${randomId}`;
}

export default function DischargeModal({
  admission,
  financial,
  financialLoading = false,
  billPrintBasePath,
  onClose,
  onSuccess,
}: {
  admission: AdmissionInfo;
  financial: DischargeFinancialSummary;
  financialLoading?: boolean;
  billPrintBasePath?: string;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { t } = useTranslation(['reception', 'ipd', 'common']);
  const queryClient = useQueryClient();
  const dischargeIdempotencyKeys = useRef({
    settled: createDischargeIdempotencyKey('settled', admission.admissionId),
    credit_pending: createDischargeIdempotencyKey('credit_pending', admission.admissionId),
  });

  const [discountPercent, setDiscountPercent] = useState(String(financial.discountPercent));
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountByName, setDiscountByName] = useState('');
  const [reasonCode, setReasonCode] = useState('normal_hospital_discount');
  const [sourceNote, setSourceNote] = useState('');

  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [tenderAmount, setTenderAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [creditPanelOpen, setCreditPanelOpen] = useState(false);
  const [creditReason, setCreditReason] = useState('');
  const [expectedPaymentDate, setExpectedPaymentDate] = useState('');
  const [confirmCreditDischarge, setConfirmCreditDischarge] = useState(false);
  const [settlingExternalInvoices, setSettlingExternalInvoices] = useState(false);
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [refundNote, setRefundNote] = useState('');

  const discountAmt = discountAmount
    ? Math.min(financial.totalCharges, Number(discountAmount) || 0)
    : Math.round(financial.totalCharges * (Number(discountPercent) / 100) * 100) / 100;
  const afterDiscount = Math.max(0, financial.totalCharges - discountAmt);
  const netPayable = Math.max(0, afterDiscount - financial.depositBalance);
  const refundAmount = Math.max(0, financial.depositBalance - afterDiscount);
  const depositApplied = financial.depositBalance > 0 ? Math.min(financial.depositBalance, afterDiscount) : 0;
  const depositSettlementAmount = refundAmount > 0 ? financial.depositBalance : depositApplied;
  const refundBlockedByMissingCharge = refundAmount > 0 && financial.totalCharges <= 0;
  const tenderValue = Math.max(0, Number(tenderAmount) || 0);
  const otherOutstanding = Math.max(0, financial.otherOutstanding);
  const totalPayableBeforeClearance = Math.max(0, netPayable + otherOutstanding);
  const enteredPayment = Math.min(totalPayableBeforeClearance, tenderValue);
  const remainingAfterEnteredPayment = Math.max(0, totalPayableBeforeClearance - enteredPayment);
  const hasFinancialDue = totalPayableBeforeClearance > 0;
  const hasUnresolvedServices = financial.unresolvedServiceAmount > 0;
  const effectiveDiscountPercent = financial.totalCharges > 0 ? (discountAmt / financial.totalCharges) * 100 : 0;
  const requiresDiscountByName = effectiveDiscountPercent > 20;

  const dischargeMutation = useApiMutation<DischargeBillResponse, unknown>(
    'post',
    '/api/ip-billing/discharge-bill',
    {
      onSuccess: (data) => {
        if (data.credit_approval_status === 'pending') {
          toast.success(data.message?.trim() || `Patient discharged with ৳${money(data.total_outstanding)} outstanding. Higher-authority approval is pending.`);
        } else {
          toast.success(data.invoice_no
            ? t('toast.dischargedWithBill', { defaultValue: 'Patient discharged successfully. Bill {{invoiceNo}} created.', invoiceNo: data.invoice_no })
            : t('toast.discharged', { defaultValue: 'Patient discharged successfully' }));
        }
        queryClient.invalidateQueries({ queryKey: ['ip-billing'] });
        queryClient.invalidateQueries({ queryKey: ['admissions'] });
        queryClient.invalidateQueries({ queryKey: ['approvals'] });
        onSuccess?.();
        onClose();
        if (billPrintBasePath && data.bill_id) {
          window.location.href = getReceptionBillPrintPath(billPrintBasePath, data.bill_id);
        }
      },
      onError: (err) => toast.error(err.message || t('toast.failedDischarge', { defaultValue: 'Failed to discharge patient' })),
    },
  );

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  const handleDiscountChange = (value: string) => {
    const numValue = Math.min(100, Math.max(0, Number(value) || 0));
    setDiscountPercent(String(numValue));
    setDiscountAmount('');
  };

  const handleDiscountAmountChange = (value: string) => {
    const numValue = Math.min(financial.totalCharges, Math.max(0, Number(value) || 0));
    setDiscountAmount(String(numValue));
    setDiscountPercent('');
  };

  const validateCommonSubmission = () => {
    if (financialLoading) {
      toast.error(t('error.billingSummaryLoading', { defaultValue: 'Billing summary is still loading. Please wait.' }));
      return false;
    }
    if (hasUnresolvedServices) {
      toast.error(t('error.pendingServicesBlockDischarge', {
        defaultValue: `Pending visit services worth ৳${money(financial.unresolvedServiceAmount)} must be billed, cancelled, or resolved first.`,
      }));
      return false;
    }
    if (refundBlockedByMissingCharge) {
      toast.error(t('error.refundBlockedMissingCharge', { defaultValue: 'Deposit refund is blocked because bill charge is ৳0. Add the missing charge before discharge.' }));
      return false;
    }
    if (refundAmount > 0 && otherOutstanding > 0) {
      toast.error(t('error.refundBlockedOutstanding', {
        defaultValue: 'Deposit refund is blocked while other patient invoices are outstanding. Settle or correct those invoices first.',
      }));
      return false;
    }
    if (refundAmount > 0 && !confirmRefund) {
      toast.error(t('error.refundConfirmationRequired', { defaultValue: 'Confirm the cash refund before discharge.' }));
      return false;
    }
    if (refundAmount > 0 && !refundNote.trim()) {
      toast.error(t('error.refundNoteRequired', { defaultValue: 'Refund note is required for deposit refunds.' }));
      return false;
    }
    if (requiresDiscountByName && !discountByName.trim()) {
      toast.error(t('error.discountByNameRequired', { defaultValue: 'Discount referred by name is required when discount is above 20%.' }));
      return false;
    }
    return true;
  };

  const buildDischargePayload = (
    mode: 'settled' | 'credit_pending',
    currentIpdPaidAmount = mode === 'settled' ? netPayable : 0,
  ) => {
    let finalPercent = Number(discountPercent) || 0;
    if (discountAmount && financial.totalCharges > 0) {
      finalPercent = Math.round((Number(discountAmount) / financial.totalCharges) * 10000) / 100;
    }
    return {
      admission_id: admission.admissionId,
      discount_percent: finalPercent,
      discount_amount: discountAmount ? Number(discountAmount) : undefined,
      discount_by_name: discountByName.trim() || undefined,
      reason_code: reasonCode,
      deposit_deducted: depositSettlementAmount,
      payment_mode: paymentMethod,
      paid_amount: currentIpdPaidAmount,
      discharge_mode: mode,
      idempotencyKey: dischargeIdempotencyKeys.current[mode],
      credit_reason: mode === 'credit_pending' ? creditReason.trim() : undefined,
      expected_payment_date: mode === 'credit_pending' ? expectedPaymentDate : undefined,
      confirm_credit_discharge: mode === 'credit_pending' ? confirmCreditDischarge : undefined,
      confirm_excess_deposit_refund: refundAmount > 0 ? confirmRefund : undefined,
      refund_note: refundAmount > 0 ? refundNote.trim() : undefined,
      remarks: [
        remarks.trim(),
        sourceNote.trim() ? `Doctor waiver note: ${sourceNote.trim()}` : '',
        mode === 'credit_pending'
          ? `Credit discharge requested with BDT ${remainingAfterEnteredPayment.toLocaleString()} outstanding after BDT ${enteredPayment.toLocaleString()} collected.`
          : '',
      ].filter(Boolean).join(' | ') || undefined,
    };
  };

  const collectMappedOutstanding = async (
    requestedCollection: number,
    mode: 'settled' | 'credit',
  ): Promise<number | null> => {
    const amountToExternalInvoices = Math.min(
      Math.max(0, requestedCollection),
      otherOutstanding,
    );
    if (amountToExternalInvoices <= 0) return 0;

    if (!financial.inlineSettlementSupported) {
      toast.error(t('error.canonicalCollectionRequired', {
        defaultValue: 'These invoices are controlled by the canonical collection workflow. Collect them there, refresh, then complete discharge.',
      }));
      return null;
    }
    const billIds = financial.outstandingInvoices.flatMap((invoice) => (
      invoice.legacyBillId == null ? [] : [invoice.legacyBillId]
    ));
    if (billIds.length !== financial.outstandingInvoices.length) {
      toast.error(t('error.invoiceMappingMissing', {
        defaultValue: 'One or more outstanding invoices cannot be settled inline. Open the collection workflow first.',
      }));
      return null;
    }

    setSettlingExternalInvoices(true);
    try {
      const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${admission.admissionId}`;
      await api.post('/api/settlements', {
        patient_id: admission.patientId,
        bill_ids: billIds,
        paid_amount: amountToExternalInvoices,
        deposit_deducted: 0,
        discount_amount: 0,
        payment_mode: paymentMethod,
        remarks: `Collected during IPD discharge for ${admission.admissionNo || admission.admissionId}`,
        idempotencyKey: `discharge-settlement-${mode}-${randomId}`,
      });
      queryClient.invalidateQueries({ queryKey: ['settlements'] });
      return amountToExternalInvoices;
    } catch (error) {
      toast.error(error instanceof ApiClientError
        ? error.message
        : t('error.externalSettlementFailed', { defaultValue: 'Other invoice settlement failed. The patient was not discharged.' }));
      return null;
    } finally {
      setSettlingExternalInvoices(false);
    }
  };

  const handleNormalSubmit = async () => {
    if (!validateCommonSubmission()) return;

    if (otherOutstanding > 0) {
      const appliedToExternal = await collectMappedOutstanding(totalPayableBeforeClearance, 'settled');
      if (appliedToExternal == null) return;
    }

    dischargeMutation.mutate(buildDischargePayload('settled', netPayable) as unknown);
  };

  const handleCreditSubmit = async () => {
    if (!validateCommonSubmission()) return;
    if (!hasFinancialDue) {
      toast.error(t('error.creditRequiresDue', { defaultValue: 'Credit discharge requires an outstanding balance.' }));
      return;
    }
    if (!creditReason.trim()) {
      toast.error(t('error.creditReasonRequired', { defaultValue: 'Credit discharge reason is required.' }));
      return;
    }
    if (!expectedPaymentDate) {
      toast.error(t('error.expectedPaymentDateRequired', { defaultValue: 'Expected payment date is required.' }));
      return;
    }
    if (!confirmCreditDischarge) {
      toast.error(t('error.creditAcknowledgementRequired', { defaultValue: 'Confirm that higher authority approval will remain pending after discharge.' }));
      return;
    }
    if (enteredPayment >= totalPayableBeforeClearance) {
      toast.error(t('error.creditPaymentClearsBalance', {
        defaultValue: 'The entered amount clears the full payable. Use Collect & Discharge.',
      }));
      return;
    }

    let appliedToExternal = 0;
    if (enteredPayment > 0 && otherOutstanding > 0) {
      const settledExternalAmount = await collectMappedOutstanding(enteredPayment, 'credit');
      if (settledExternalAmount == null) return;
      appliedToExternal = settledExternalAmount;
    }
    const currentIpdPaidAmount = Math.min(
      netPayable,
      Math.max(0, enteredPayment - appliedToExternal),
    );
    dischargeMutation.mutate(buildDischargePayload('credit_pending', currentIpdPaidAmount) as unknown);
  };

  const statusLabel = financialLoading
    ? t('status.loading', { ns: 'common', defaultValue: 'Loading' })
    : hasUnresolvedServices
      ? t('status.pendingServices', { defaultValue: 'Pending Services' })
      : otherOutstanding > 0
        ? `৳${money(otherOutstanding)} Outstanding`
        : refundAmount > 0
          ? t('form.refundToPatient', { defaultValue: 'Refund to Patient' })
          : netPayable > 0
            ? t('form.netPayable', { defaultValue: 'Net Payable' })
            : t('status.ready', { defaultValue: 'Ready' });
  const isProcessing = dischargeMutation.isPending || settlingExternalInvoices;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/50 p-3 backdrop-blur-sm sm:p-4"
      data-testid="discharge-modal"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-border)] bg-gradient-to-r from-emerald-50 to-cyan-50 px-5 py-4 dark:from-emerald-950/30 dark:to-cyan-950/20">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-100 dark:bg-slate-900 dark:ring-emerald-900/50">
              <CheckCircle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-[var(--color-text)]">
                  {t('modal.dischargeSettlement', { defaultValue: 'Discharge & Final Settlement' })}
                </h2>
                <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 shadow-sm">
                  {statusLabel}
                </span>
              </div>
              <p className="mt-1 truncate text-sm text-[var(--color-text-muted)]">
                {admission.patientName || t('patient', { ns: 'common', defaultValue: 'Patient' })} • {admission.admissionNo || `ADM-${admission.admissionId}`}
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                {[admission.wardName, admission.bedNumber ? `Bed ${admission.bedNumber}` : ''].filter(Boolean).join(' • ') || t('info.noBedInfo', { defaultValue: 'No bed info' })}
              </p>
            </div>
          </div>
          <button type="button" className="btn-ghost p-1.5" onClick={onClose} aria-label={t('close', { ns: 'common', defaultValue: 'Close' })}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <span className="font-semibold">{t('warning', { ns: 'common', defaultValue: 'Warning' })}:</span>{' '}
              {t('info.dischargeFinalNotice', { defaultValue: 'This will finalize billing and discharge the patient. Confirm the collection, deposit adjustment, and refund before submitting.' })}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                <h3 className="mb-3 text-sm font-bold text-[var(--color-text)]">{t('step.billSummary', { defaultValue: 'Bill Summary' })}</h3>
                {financialLoading ? (
                  <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-white/70 px-4 py-8 text-center text-sm text-[var(--color-text-muted)] dark:bg-slate-900/40">
                    {t('info.billingSummaryLoading', { defaultValue: 'Loading billing summary...' })}
                  </div>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between gap-3 rounded-lg bg-white px-3 py-2 dark:bg-slate-900/40">
                      <span>{t('form.totalCharges', { defaultValue: 'Total Charges' })}</span>
                      <span className="font-data font-semibold">{'\u09F3'}{money(financial.totalCharges)}</span>
                    </div>
                    <div className="flex justify-between gap-3 rounded-lg bg-white px-3 py-2 text-red-600 dark:bg-slate-900/40">
                      <span>{t('form.discount', { defaultValue: 'Discount' })} ({Number(effectiveDiscountPercent || 0).toFixed(2)}%)</span>
                      <span className="font-data font-semibold">-{'\u09F3'}{money(discountAmt)}</span>
                    </div>
                    <div className="flex justify-between gap-3 rounded-lg bg-white px-3 py-2 dark:bg-slate-900/40">
                      <span>{t('form.afterDiscount', { defaultValue: 'After Discount' })}</span>
                      <span className="font-data font-semibold">{'\u09F3'}{money(afterDiscount)}</span>
                    </div>
                    {financial.depositBalance > 0 ? (
                      <>
                        <div className="flex justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300">
                          <span>{t('form.depositBalanceAvailable', { defaultValue: 'Deposit Balance Available' })}</span>
                          <span className="font-data font-semibold">{'\u09F3'}{money(financial.depositBalance)}</span>
                        </div>
                        <div className="flex justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300">
                          <span>{t('form.depositAppliedToBill', { defaultValue: 'Deposit Applied to Bill' })}</span>
                          <span className="font-data font-semibold">-{'\u09F3'}{money(depositApplied)}</span>
                        </div>
                      </>
                    ) : null}
                  </div>
                )}
              </div>

              {hasUnresolvedServices ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <div className="text-sm font-bold">{t('financial.pendingServices', { defaultValue: 'Pending / unbilled services' })}</div>
                      <div className="mt-1 text-sm">৳{money(financial.unresolvedServiceAmount)}</div>
                      <p className="mt-1 text-xs">{t('financial.pendingServicesHelp', { defaultValue: 'Bill, cancel, or resolve these services before any discharge.' })}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              {financial.outstandingInvoices.length > 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-bold text-amber-950 dark:text-amber-100">
                        <ReceiptText className="h-4 w-4" />
                        {t('financial.otherOutstandingInvoices', { defaultValue: 'Other Outstanding Invoices' })}
                      </h3>
                      <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                        {t('financial.otherOutstandingHelp', { defaultValue: 'OPD, laboratory, pharmacy, or other invoices outside the current IPD running bill.' })}
                      </p>
                    </div>
                    <span className="rounded-full bg-red-100 px-2.5 py-1 font-data text-xs font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300">
                      ৳{money(otherOutstanding)}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {financial.outstandingInvoices.map((invoice) => (
                      <div key={`${invoice.invoiceNumber}-${invoice.legacyBillId ?? invoice.canonicalInvoicePublicId ?? 'invoice'}`} className="rounded-xl border border-amber-200 bg-white p-3 dark:border-amber-900/50 dark:bg-slate-900/60">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-data text-sm font-bold text-[var(--color-text)]">{invoice.invoiceNumber}</div>
                            <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                              {invoice.sourceLabel}{invoice.issuedAt ? ` • ${new Date(invoice.issuedAt).toLocaleDateString('en-BD')}` : ''}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-red-600">{t('financial.due', { defaultValue: 'Due' })}</div>
                            <div className="font-data text-sm font-black text-red-700 dark:text-red-300">৳{money(invoice.due)}</div>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(invoice.categories.length > 0 ? invoice.categories : [{ code: 'other', label: invoice.sourceLabel, amount: invoice.total }]).map((category) => (
                            <span key={`${invoice.invoiceNumber}-${category.code}-${category.amount}`} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              {category.label}: ৳{money(category.amount)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {!financial.inlineSettlementSupported ? (
                    <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800 dark:border-indigo-900/60 dark:bg-indigo-950/20 dark:text-indigo-200">
                      {t('financial.canonicalCollectionNotice', { defaultValue: 'This balance is controlled by the canonical collection workflow and cannot be posted through the legacy inline settlement command.' })}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className={`rounded-2xl border p-4 ${refundAmount > 0 ? 'border-blue-200 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-950/20' : netPayable > 0 ? 'border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/20' : 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/20'}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  {refundAmount > 0 ? t('form.refundToPatient', { defaultValue: 'Refund to Patient' }) : t('form.netPayable', { defaultValue: 'Net Payable' })}
                </div>
                <div className={`mt-1 font-data text-3xl font-black ${refundAmount > 0 ? 'text-blue-700 dark:text-blue-300' : netPayable > 0 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                  {'\u09F3'}{money(refundAmount > 0 ? refundAmount : netPayable)}
                </div>
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  {refundAmount > 0
                    ? t('form.refundInstruction', { defaultValue: 'Refund requires confirmation before discharge.' })
                    : netPayable > 0
                      ? t('info.collectBeforeDischarge', { defaultValue: 'Collect this amount before completing discharge.' })
                      : t('info.noDueAfterDeposit', { defaultValue: 'No cash collection needed after deposit adjustment.' })}
                </p>
              </div>

              {otherOutstanding > 0 || netPayable > 0 ? (
                <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/20">
                  <div className="text-xs font-bold uppercase tracking-wide text-red-700 dark:text-red-300">
                    {t('financial.totalPayableBeforeClearance', { defaultValue: 'Total payable before full clearance' })}
                  </div>
                  <div className="mt-1 font-data text-3xl font-black text-red-800 dark:text-red-200">৳{money(totalPayableBeforeClearance)}</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-red-800 dark:text-red-300">
                    <div>{t('financial.currentIpdPayable', { defaultValue: 'Current IPD payable' })}: ৳{money(netPayable)}</div>
                    <div>{t('financial.previousOutstanding', { defaultValue: 'Other invoice outstanding' })}: ৳{money(otherOutstanding)}</div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--color-border)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-[var(--color-text)]">{t('step.discount', { defaultValue: 'Discount' })}</h3>
                  {requiresDiscountByName ? <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700">Reference required</span> : null}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label text-xs">{t('form.discountPercent', { defaultValue: 'Discount %' })}</label>
                    <input className="input h-10" type="number" min={0} max={100} value={discountPercent} onChange={(e) => handleDiscountChange(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <label className="label text-xs" htmlFor="discharge-discount-amount">{t('form.discountAmount', { defaultValue: 'ডিসকাউন্ট টাকা (৳)' })}</label>
                    <input id="discharge-discount-amount" className="input h-10" type="number" min={0} max={financial.totalCharges} value={discountAmount} onChange={(e) => handleDiscountAmountChange(e.target.value)} placeholder="0" />
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label text-xs" htmlFor="discharge-discount-reason">{t('form.discountReason', { defaultValue: 'Discount reason' })}</label>
                    <select id="discharge-discount-reason" className="input h-10" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                      <option value="normal_hospital_discount">{t('discountReason.normal', { defaultValue: 'Normal hospital discount' })}</option>
                      <option value="poor_patient_charity">{t('discountReason.charity', { defaultValue: 'Poor patient / charity' })}</option>
                      <option value="doctor_commission_waiver">{t('discountReason.doctorWaiver', { defaultValue: 'Doctor commission waiver' })}</option>
                      <option value="management_approved">{t('discountReason.management', { defaultValue: 'Management approved' })}</option>
                      <option value="reference_discount">{t('discountReason.reference', { defaultValue: 'Reference discount' })}</option>
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs">
                      {t('form.discountByName', { defaultValue: 'Discount referred by (কে দিয়েছে)' })}{requiresDiscountByName ? ' *' : ''}
                    </label>
                    <input
                      className="input h-10"
                      value={discountByName}
                      onChange={(e) => setDiscountByName(e.target.value)}
                      placeholder={requiresDiscountByName ? t('form.discountByNameRequiredPlaceholder', { defaultValue: 'Required for discounts above 20%' }) : t('form.discountByNamePlaceholder', { defaultValue: 'Name / reference' })}
                    />
                  </div>
                </div>
                {reasonCode === 'doctor_commission_waiver' ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <div className="font-semibold">{t('discountReason.doctorWaiverPanelTitle', { defaultValue: 'Doctor commission waiver' })}</div>
                    <input
                      className="input mt-2 h-10 bg-white"
                      value={sourceNote}
                      onChange={(e) => setSourceNote(e.target.value)}
                      placeholder={t('form.doctorInstructionPlaceholder', { defaultValue: 'Optional: written on prescription / verbally confirmed' })}
                    />
                  </div>
                ) : null}
              </div>

              {hasFinancialDue ? (
                <div className="rounded-2xl border border-[var(--color-border)] p-4">
                  <h3 className="mb-3 text-sm font-bold text-[var(--color-text)]">{t('step.payment', { defaultValue: 'Payment / Partial Collection' })}</h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="label text-xs" htmlFor="discharge-payment-method">{t('form.paymentMethod', { defaultValue: 'Payment Method' })}</label>
                      <select id="discharge-payment-method" className="input h-10" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                        <option value="cash">{t('select.cash', { defaultValue: 'Cash' })}</option>
                        <option value="bkash">{t('select.bkash', { defaultValue: 'bKash' })}</option>
                        <option value="nagad">{t('select.nagad', { defaultValue: 'Nagad' })}</option>
                        <option value="card">{t('select.card', { defaultValue: 'Card' })}</option>
                        <option value="bank">{t('select.bank', { defaultValue: 'Bank' })}</option>
                      </select>
                    </div>
                    <div>
                      <label className="label text-xs" htmlFor="discharge-total-received">{t('form.partialReceivedNow', { defaultValue: 'Partial Received Now (optional)' })}</label>
                      <input id="discharge-total-received" className="input h-10 font-data" type="number" min={0} max={totalPayableBeforeClearance} value={tenderAmount} onChange={(e) => setTenderAmount(e.target.value)} placeholder="0" />
                    </div>
                    <div>
                      <label className="label text-xs">{t('form.remainingDueAfterEntry', { defaultValue: 'Remaining Due After Entry' })}</label>
                      <div className={`input flex h-10 items-center bg-gray-50 font-data font-semibold ${remainingAfterEnteredPayment > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                        ৳{money(remainingAfterEnteredPayment)}
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                    {t('financial.partialCollectionHelp', { defaultValue: 'Enter an optional partial amount only when using Discharge with Due. The green button always collects the full payable shown on it.' })}
                  </p>
                </div>
              ) : null}

              {creditPanelOpen ? (
                <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/20 dark:text-amber-100">
                  <div className="flex items-start gap-2">
                    <CreditCard className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <h3 className="text-sm font-black">{t('credit.title', { defaultValue: 'Confirm Discharge with Due' })}</h3>
                      <p className="mt-1 text-xs">
                        {t('credit.warning', { defaultValue: `The patient will be clinically discharged now with ৳${money(remainingAfterEnteredPayment)} outstanding. A higher-authority request will remain pending after discharge.` })}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-amber-200 bg-white/70 p-3 text-xs dark:border-amber-900/50 dark:bg-slate-900/50">
                    <div>
                      <div className="font-semibold">{t('credit.collectNow', { defaultValue: 'Collect now' })}</div>
                      <div className="mt-1 font-data text-sm font-black">৳{money(enteredPayment)}</div>
                    </div>
                    <div>
                      <div className="font-semibold">{t('credit.remainingAfterCollection', { defaultValue: 'Remaining due after collection' })}</div>
                      <div className="mt-1 font-data text-sm font-black text-red-700 dark:text-red-300">৳{money(remainingAfterEnteredPayment)}</div>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="label text-xs" htmlFor="credit-discharge-reason">{t('credit.reason', { defaultValue: 'Credit discharge reason' })} *</label>
                      <textarea id="credit-discharge-reason" className="input min-h-20 py-2" value={creditReason} onChange={(e) => setCreditReason(e.target.value)} placeholder={t('credit.reasonPlaceholder', { defaultValue: 'Why is the patient being released before payment?' })} />
                    </div>
                    <div>
                      <label className="label text-xs" htmlFor="credit-expected-date">{t('credit.expectedDate', { defaultValue: 'Expected payment date' })} *</label>
                      <input id="credit-expected-date" className="input h-10" type="date" value={expectedPaymentDate} onChange={(e) => setExpectedPaymentDate(e.target.value)} />
                    </div>
                    <div className="rounded-xl border border-amber-200 bg-white/70 p-3 text-xs dark:border-amber-900/50 dark:bg-slate-900/50">
                      <div className="font-semibold">{t('credit.pendingStatus', { defaultValue: 'After submit' })}</div>
                      <div className="mt-1">{t('credit.pendingStatusHelp', { defaultValue: 'Clinical: Discharged • Financial: Credit approval pending' })}</div>
                    </div>
                  </div>
                  <label className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-white/80 p-3 text-sm font-semibold dark:border-amber-900/60 dark:bg-slate-900/60">
                    <input type="checkbox" className="mt-1" checked={confirmCreditDischarge} onChange={(e) => setConfirmCreditDischarge(e.target.checked)} />
                    <span>{t('credit.acknowledgement', { defaultValue: 'I understand this discharge will be recorded under my user and counter, and higher authority approval will remain pending.' })}</span>
                  </label>
                  <div className="mt-4 flex justify-end gap-2">
                    <button type="button" className="btn-secondary" onClick={() => setCreditPanelOpen(false)} disabled={isProcessing}>
                      {t('cancel', { ns: 'common', defaultValue: 'Cancel' })}
                    </button>
                    <button type="button" className="btn-primary bg-amber-600 hover:bg-amber-700" onClick={handleCreditSubmit} disabled={isProcessing || hasUnresolvedServices}>
                      {t('credit.confirm', { defaultValue: 'Confirm Credit Discharge' })}
                    </button>
                  </div>
                </div>
              ) : null}

              {refundAmount > 0 ? (
                <div className={`rounded-2xl border p-4 ${refundBlockedByMissingCharge ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200' : 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-200'}`}>
                  <h3 className="mb-2 text-sm font-bold">{t('form.depositRefundControl', { defaultValue: 'Deposit refund control' })}</h3>
                  <p className="text-sm">{t('form.depositRefundAmount', { defaultValue: 'Refund amount' })}: {'\u09F3'}{money(refundAmount)}</p>
                  {refundBlockedByMissingCharge ? (
                    <div className="mt-3 rounded-xl border border-red-200 bg-white/70 p-3 text-sm font-semibold text-red-800 dark:bg-red-950/30 dark:text-red-200">
                      {t('error.zeroChargeRefundBlocked', { defaultValue: 'Bill charge is ৳0 while patient deposit exists. Add the missing charge before discharge. System refund is blocked.' })}
                    </div>
                  ) : (
                    <>
                      <label className="mt-3 flex items-start gap-2 text-sm font-semibold">
                        <input type="checkbox" className="mt-1" checked={confirmRefund} onChange={(e) => setConfirmRefund(e.target.checked)} />
                        <span>{t('form.confirmCashRefund', { defaultValue: 'I confirm this cash refund will be returned to the patient/guardian now.' })}</span>
                      </label>
                      <input className="input mt-3 h-10 bg-white" value={refundNote} onChange={(e) => setRefundNote(e.target.value)} placeholder={t('form.refundNotePlaceholder', { defaultValue: 'Refund reason / approver / receiver signature note' })} />
                    </>
                  )}
                </div>
              ) : null}

              <div className="rounded-2xl border border-[var(--color-border)] p-4">
                <label className="label text-xs">{t('form.remarks', { defaultValue: 'Remarks' })}</label>
                <input className="input h-10" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={t('form.optionalNote', { defaultValue: 'Optional note...' })} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-[var(--color-border)] bg-white px-5 py-4 dark:bg-slate-800 xl:flex-row xl:items-center xl:justify-between">
          <div className="text-xs text-[var(--color-text-muted)]">
            {hasFinancialDue
              ? t('info.dischargeDueSubmitNote', { defaultValue: 'Choose full settlement or an audited credit discharge. Pending services always block both actions.' })
              : t('info.dischargeSubmitNote', { defaultValue: 'Final bill, deposit adjustment and bed release will be posted together.' })}
          </div>
          <div data-testid="discharge-footer-actions" className="flex flex-nowrap items-center justify-end gap-2">
            <button type="button" className="btn-secondary whitespace-nowrap" onClick={onClose} disabled={isProcessing}>
              {t('cancel', { ns: 'common', defaultValue: 'Cancel' })}
            </button>
            {hasFinancialDue && !creditPanelOpen ? (
              <button
                type="button"
                className="btn-secondary whitespace-nowrap border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                onClick={() => setCreditPanelOpen(true)}
                disabled={isProcessing || financialLoading || hasUnresolvedServices}
              >
                <CreditCard className="mr-2 h-4 w-4" />
                {t('btn.dischargeWithDue', { defaultValue: 'Discharge with Due' })}
              </button>
            ) : null}
            <button
              type="button"
              className="btn-primary justify-center whitespace-nowrap bg-emerald-600 text-base font-semibold hover:bg-emerald-700"
              onClick={handleNormalSubmit}
              disabled={isProcessing || financialLoading || hasUnresolvedServices || (otherOutstanding > 0 && !financial.inlineSettlementSupported)}
            >
              {isProcessing ? t('btn.processing', { defaultValue: 'Processing...' }) : (
                <>
                  <CheckCircle className="mr-2 h-5 w-5" />
                  {refundAmount > 0
                    ? t('btn.confirmRefundAndDischarge', { defaultValue: 'Confirm Refund & Discharge' })
                    : hasFinancialDue
                      ? t('btn.collectAndDischarge', { defaultValue: `Collect ৳${money(totalPayableBeforeClearance)} & Discharge` })
                      : t('btn.completeSettlement', { defaultValue: 'Complete Settlement & Discharge' })}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
