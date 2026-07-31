import { useEffect } from 'react';

export type DiscountAllocationReason =
  | 'normal_hospital_discount'
  | 'poor_patient_charity'
  | 'doctor_commission_waiver'
  | 'management_approved'
  | 'reference_discount'
  | 'staff_benefit_discount'
  | 'vip_benefit_discount'
  | 'owner_benefit_discount'
  | 'shareholder_benefit_discount'
  | 'corporate_contract_discount'
  | 'campaign_discount'
  | 'rounding_adjustment';

export type DiscountAllocationContext = {
  selectedDoctorId?: number | null;
  doctorAvailableWaiverAmount?: number | null;
  eligibleCommissionAmount?: number | null;
  performerReserveAmount?: number | null;
  protectedCommissionAmount?: number | null;
  payableCommissionAmount?: number | null;
  doctorWaiverLoading?: boolean;
  doctorWaiverPreviewFailed?: boolean;
  patientBenefitEligibility?: {
    eligible?: boolean;
    label?: string;
    allocationReason?: DiscountAllocationReason;
    suggestedAmount?: number | null;
  } | null;
  workflowType?: string | null;
};

export type DiscountAllocationRow = {
  id: string;
  reason: DiscountAllocationReason;
  amount: string;
  doctorId?: number | null;
  note?: string;
};

export type DiscountAllocationPayload = {
  reason: DiscountAllocationReason;
  amount: number;
  doctorId?: number;
  note?: string;
};

type DiscountReasonOption = {
  value: DiscountAllocationReason;
  label: string;
  hint: string;
  chipClass: string;
  activeChipClass: string;
};

const DISCOUNT_REASON_OPTIONS: DiscountReasonOption[] = [
  { value: 'normal_hospital_discount', label: 'Hospital discount', hint: 'Hospital-funded normal discount', chipClass: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200', activeChipClass: 'ring-2 ring-sky-300 bg-sky-100 dark:bg-sky-900/80' },
  { value: 'doctor_commission_waiver', label: 'Doctor commission waiver', hint: 'Deduct only the eligible doctor payable amount', chipClass: 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-200', activeChipClass: 'ring-2 ring-orange-300 bg-orange-100 dark:bg-orange-900/80' },
  { value: 'management_approved', label: 'Management approved', hint: 'Approved by management', chipClass: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200', activeChipClass: 'ring-2 ring-violet-300 bg-violet-100 dark:bg-violet-900/80' },
  { value: 'poor_patient_charity', label: 'Poor patient / charity', hint: 'Charity or welfare discount', chipClass: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200', activeChipClass: 'ring-2 ring-emerald-300 bg-emerald-100 dark:bg-emerald-900/80' },
  { value: 'staff_benefit_discount', label: 'Staff benefit', hint: 'Staff or family benefit scheme', chipClass: 'border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-200', activeChipClass: 'ring-2 ring-teal-300 bg-teal-100 dark:bg-teal-900/80' },
  { value: 'vip_benefit_discount', label: 'VIP benefit', hint: 'Pre-approved VIP concession', chipClass: 'border-pink-200 bg-pink-50 text-pink-700 hover:bg-pink-100 dark:border-pink-800 dark:bg-pink-950/50 dark:text-pink-200', activeChipClass: 'ring-2 ring-pink-300 bg-pink-100 dark:bg-pink-900/80' },
  { value: 'owner_benefit_discount', label: 'Owner benefit', hint: 'Owner/director approved concession', chipClass: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200', activeChipClass: 'ring-2 ring-amber-300 bg-amber-100 dark:bg-amber-900/80' },
  { value: 'shareholder_benefit_discount', label: 'Shareholder benefit', hint: 'Shareholder or family benefit', chipClass: 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200', activeChipClass: 'ring-2 ring-indigo-300 bg-indigo-100 dark:bg-indigo-900/80' },
  { value: 'reference_discount', label: 'Reference discount', hint: 'Reference/source-based discount', chipClass: 'border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 dark:border-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200', activeChipClass: 'ring-2 ring-cyan-300 bg-cyan-100 dark:bg-cyan-900/80' },
  { value: 'corporate_contract_discount', label: 'Corporate contract', hint: 'Corporate/contractual allowance', chipClass: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200', activeChipClass: 'ring-2 ring-blue-300 bg-blue-100 dark:bg-blue-900/80' },
  { value: 'campaign_discount', label: 'Campaign discount', hint: 'Approved campaign/promotion', chipClass: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100 dark:border-fuchsia-800 dark:bg-fuchsia-950/50 dark:text-fuchsia-200', activeChipClass: 'ring-2 ring-fuchsia-300 bg-fuchsia-100 dark:bg-fuchsia-900/80' },
  { value: 'rounding_adjustment', label: 'Rounding adjustment', hint: 'Small rounding adjustment', chipClass: 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200', activeChipClass: 'ring-2 ring-slate-300 bg-slate-100 dark:bg-slate-800' },
];

const PRIMARY_SOURCE_OPTIONS: Array<{ value: DiscountAllocationReason; label: string }> = [
  { value: 'normal_hospital_discount', label: 'Hospital' },
  { value: 'doctor_commission_waiver', label: 'Doctor waiver' },
];

const ADVANCED_QUICK_SOURCE_OPTIONS: Array<{ value: DiscountAllocationReason; label: string }> = [
  { value: 'management_approved', label: 'Management' },
  { value: 'poor_patient_charity', label: 'Charity' },
  { value: 'staff_benefit_discount', label: 'Staff benefit' },
  { value: 'vip_benefit_discount', label: 'VIP' },
  { value: 'owner_benefit_discount', label: 'Owner' },
  { value: 'shareholder_benefit_discount', label: 'Shareholder' },
];

function createRowId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function roundMoney(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function amountToInput(value: number): string {
  const rounded = roundMoney(value);
  return rounded > 0 ? String(rounded) : '';
}

function getReasonMeta(reason: DiscountAllocationReason): DiscountReasonOption {
  return DISCOUNT_REASON_OPTIONS.find((option) => option.value === reason) ?? DISCOUNT_REASON_OPTIONS[0];
}

export function getDiscountSourceLabel(reason: DiscountAllocationReason): string {
  return getReasonMeta(reason).label;
}

export function suggestDiscountSource(context: DiscountAllocationContext = {}): DiscountAllocationReason {
  const benefit = context.patientBenefitEligibility;
  if (benefit?.eligible && benefit.allocationReason) return benefit.allocationReason;
  return 'normal_hospital_discount';
}

export function createDiscountAllocationRow(
  amount = '',
  reason: DiscountAllocationReason = 'normal_hospital_discount',
  doctorId?: number | null,
): DiscountAllocationRow {
  return {
    id: createRowId(),
    reason,
    amount,
    doctorId: reason === 'doctor_commission_waiver' ? doctorId ?? null : null,
    note: '',
  };
}

export function createAllocationsForSource(
  totalDiscount: number,
  reason: DiscountAllocationReason,
  context: DiscountAllocationContext = {},
): DiscountAllocationRow[] {
  const total = Math.max(0, roundMoney(totalDiscount));
  const doctorId = context.selectedDoctorId ?? null;

  if (reason === 'doctor_commission_waiver') {
    const availableDoctorWaiver = Math.max(0, roundMoney(context.doctorAvailableWaiverAmount));
    const doctorAmount = doctorId && availableDoctorWaiver > 0 ? Math.min(total, availableDoctorWaiver) : 0;
    const hospitalAmount = roundMoney(total - doctorAmount);

    if (total <= 0 || (doctorId && (context.doctorWaiverLoading || context.doctorWaiverPreviewFailed))) {
      return [createDiscountAllocationRow('', 'doctor_commission_waiver', doctorId)];
    }

    if (doctorAmount <= 0) {
      return [
        createDiscountAllocationRow('', 'doctor_commission_waiver', doctorId),
        createDiscountAllocationRow(amountToInput(total), 'normal_hospital_discount'),
      ];
    }

    return [
      createDiscountAllocationRow(amountToInput(doctorAmount), 'doctor_commission_waiver', doctorId),
      ...(hospitalAmount > 0 ? [createDiscountAllocationRow(amountToInput(hospitalAmount), 'normal_hospital_discount')] : []),
    ];
  }

  return [createDiscountAllocationRow(amountToInput(total), reason, null)];
}

export function createDefaultDiscountAllocation(
  totalDiscount: number,
  context: DiscountAllocationContext = {},
): DiscountAllocationRow {
  return createDefaultDiscountAllocations(totalDiscount, context)[0]
    ?? createDiscountAllocationRow('', 'normal_hospital_discount');
}

export function createDefaultDiscountAllocations(
  totalDiscount: number,
  context: DiscountAllocationContext = {},
): DiscountAllocationRow[] {
  return createAllocationsForSource(totalDiscount, suggestDiscountSource(context), context);
}

export function getRemainingDiscountAmount(
  rows: DiscountAllocationRow[],
  totalDiscount: number,
  excludeRowId?: string,
): number {
  const total = Math.max(0, roundMoney(totalDiscount));
  const allocated = rows.reduce((sum, row) => {
    if (excludeRowId && row.id === excludeRowId) return sum;
    return sum + Math.max(0, roundMoney(row.amount));
  }, 0);
  return roundMoney(Math.max(0, total - allocated));
}

export function appendDiscountAllocationWithRemaining(
  rows: DiscountAllocationRow[],
  totalDiscount: number,
  context: DiscountAllocationContext = {},
): DiscountAllocationRow[] {
  const remaining = getRemainingDiscountAmount(rows, totalDiscount);
  const reason = suggestDiscountSource(context);
  return [...rows, ...createAllocationsForSource(remaining, reason, context)];
}

export function getDiscountAllocationPayload(
  totalDiscount: number,
  enabled: boolean,
  rows: DiscountAllocationRow[],
): DiscountAllocationPayload[] {
  const total = Math.max(0, roundMoney(totalDiscount));
  if (total <= 0) return [];
  if (!enabled) return [{ reason: 'normal_hospital_discount', amount: total }];
  return rows
    .map((row) => ({
      reason: row.reason,
      amount: Math.max(0, roundMoney(row.amount)),
      doctorId: row.reason === 'doctor_commission_waiver' && row.doctorId ? Number(row.doctorId) : undefined,
      note: row.note?.trim() || undefined,
    }))
    .filter((row) => row.amount > 0);
}

export function getDiscountAllocationTotal(rows: DiscountAllocationRow[]): number {
  return roundMoney(rows.reduce((sum, row) => sum + Math.max(0, roundMoney(row.amount)), 0));
}

export function resolveDoctorWaiverPreviewStatus({
  hasDoctorWaiverAllocation,
  previewKey,
  verifiedPreviewKey,
  mutationPending,
  mutationFailed,
}: {
  hasDoctorWaiverAllocation: boolean;
  previewKey: string | null;
  verifiedPreviewKey: string | null;
  mutationPending: boolean;
  mutationFailed: boolean;
}): { pending: boolean; failed: boolean; verified: boolean; paymentBlocked: boolean } {
  const failed = hasDoctorWaiverAllocation && mutationFailed;
  const verified = hasDoctorWaiverAllocation
    && Boolean(previewKey)
    && !failed
    && verifiedPreviewKey === previewKey;
  const pending = hasDoctorWaiverAllocation
    && Boolean(previewKey)
    && !failed
    && (mutationPending || !verified);
  const paymentBlocked = hasDoctorWaiverAllocation && !verified;
  return { pending, failed, verified, paymentBlocked };
}

export function hasBalancedDiscountAllocations(totalDiscount: number, rows: DiscountAllocationRow[]): boolean {
  const total = Math.max(0, roundMoney(totalDiscount));
  if (total <= 0) return true;
  return Math.abs(getDiscountAllocationTotal(rows) - total) < 0.01;
}

function replaceAllocationRowReason(
  currentRows: DiscountAllocationRow[],
  rowId: string,
  reason: DiscountAllocationReason,
  currentTotal: number,
  currentContext: DiscountAllocationContext,
): DiscountAllocationRow[] {
  const target = currentRows.find((row) => row.id === rowId);
  if (!target) return currentRows;

  if (reason !== 'doctor_commission_waiver') {
    return currentRows.map((item) => item.id === rowId ? { ...item, reason, doctorId: null } : item);
  }

  const targetAmount = roundMoney(target.amount) || getRemainingDiscountAmount(currentRows, currentTotal, rowId);
  const doctorId = currentContext.selectedDoctorId ?? null;
  const availableDoctorWaiver = Math.max(0, roundMoney(currentContext.doctorAvailableWaiverAmount));
  const doctorAmount = doctorId && availableDoctorWaiver > 0 ? Math.min(targetAmount, availableDoctorWaiver) : 0;
  const hospitalAmount = roundMoney(targetAmount - doctorAmount);

  if (doctorId && (currentContext.doctorWaiverLoading || currentContext.doctorWaiverPreviewFailed)) {
    return currentRows.map((item) => item.id === rowId
      ? { ...item, reason: 'doctor_commission_waiver' as DiscountAllocationReason, amount: '', doctorId }
      : item);
  }

  if (doctorAmount <= 0) {
    const fallbackRows = [
      { ...target, reason: 'doctor_commission_waiver' as DiscountAllocationReason, amount: '', doctorId },
      createDiscountAllocationRow(amountToInput(targetAmount), 'normal_hospital_discount'),
    ];
    return currentRows.flatMap((item) => item.id === rowId ? fallbackRows : [item]);
  }

  const replacementRows = [
    { ...target, reason: 'doctor_commission_waiver' as DiscountAllocationReason, amount: amountToInput(doctorAmount), doctorId },
    ...(hospitalAmount > 0 ? [createDiscountAllocationRow(amountToInput(hospitalAmount), 'normal_hospital_discount')] : []),
  ];
  return currentRows.flatMap((item) => item.id === rowId ? replacementRows : [item]);
}

type Props = {
  totalDiscount: number;
  enabled: boolean;
  rows: DiscountAllocationRow[];
  onEnabledChange: (enabled: boolean) => void;
  onRowsChange: (rows: DiscountAllocationRow[]) => void;
  onQuickSourceSelected?: (reason: DiscountAllocationReason) => void;
  compact?: boolean;
  context?: DiscountAllocationContext;
};

export default function DiscountAllocationEditor({
  totalDiscount,
  enabled,
  rows,
  onEnabledChange,
  onRowsChange,
  onQuickSourceSelected,
  compact = false,
  context = {},
}: Props) {
  const total = Math.max(0, roundMoney(totalDiscount));
  const allocated = getDiscountAllocationTotal(rows);
  const remaining = roundMoney(total - allocated);
  const balanced = Math.abs(remaining) < 0.01;
  const suggestedReason = rows.find((row) => Number(row.amount || 0) > 0)?.reason ?? suggestDiscountSource(context);
  const suggestedLabel = getDiscountSourceLabel(suggestedReason);
  const benefit = context.patientBenefitEligibility;
  const doctorAvailableWaiver = Math.max(0, roundMoney(context.doctorAvailableWaiverAmount));
  const hasDoctorWaiverRow = rows.some((row) => row.reason === 'doctor_commission_waiver');

  useEffect(() => {
    const canAutoRefreshDoctorWaiver = rows.length > 0
      && rows.every((row) => row.reason === 'doctor_commission_waiver' || row.reason === 'normal_hospital_discount');
    if (!enabled || !hasDoctorWaiverRow || !canAutoRefreshDoctorWaiver || total <= 0) return;

    const nextRows = createAllocationsForSource(total, 'doctor_commission_waiver', {
      selectedDoctorId: context.selectedDoctorId,
      doctorAvailableWaiverAmount: doctorAvailableWaiver,
      doctorWaiverLoading: context.doctorWaiverLoading,
      doctorWaiverPreviewFailed: context.doctorWaiverPreviewFailed,
    });
    const currentKey = rows.map((row) => `${row.reason}:${row.amount}:${row.doctorId ?? ''}`).join('|');
    const nextKey = nextRows.map((row) => `${row.reason}:${row.amount}:${row.doctorId ?? ''}`).join('|');
    if (currentKey !== nextKey) onRowsChange(nextRows);
  }, [doctorAvailableWaiver, enabled, hasDoctorWaiverRow, onRowsChange, rows, total, context.doctorWaiverLoading, context.doctorWaiverPreviewFailed, context.selectedDoctorId]);

  const enableAdvanced = () => {
    if (!enabled) {
      onRowsChange(rows.length > 0 ? rows : createDefaultDiscountAllocations(total, context));
      onEnabledChange(true);
    } else {
      onEnabledChange(false);
    }
  };

  const applyPrimarySource = (reason: DiscountAllocationReason) => {
    onRowsChange(createAllocationsForSource(total, reason, context));
    if (reason === 'doctor_commission_waiver') onEnabledChange(true);
    onQuickSourceSelected?.(reason);
  };

  const applyQuickSource = (reason: DiscountAllocationReason) => {
    onRowsChange(createAllocationsForSource(total, reason, context));
    onQuickSourceSelected?.(reason);
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-[var(--color-text)]">Discount source allocation</div>
          <div className="text-[11px] text-[var(--color-text-muted)]">Print will show only the total discount, not these internal details.</div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {PRIMARY_SOURCE_OPTIONS.map((option) => {
            const meta = getReasonMeta(option.value);
            const active = option.value === 'normal_hospital_discount'
              ? (!enabled || rows.some((row) => row.reason === option.value))
              : rows.some((row) => row.reason === option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${meta.chipClass} ${active ? meta.activeChipClass : ''}`}
                onClick={() => applyPrimarySource(option.value)}
                title={meta.hint}
              >
                {option.label}
              </button>
            );
          })}
          <button
            type="button"
            className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1 text-xs font-semibold text-[var(--color-text)] shadow-sm hover:bg-[var(--color-bg-secondary)] dark:bg-slate-900"
            onClick={enableAdvanced}
          >
            {enabled ? 'Hide advanced' : 'Advanced / Split'}
          </button>
        </div>
      </div>

      {!enabled && (
        <div className="rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-2 text-[11px] text-[var(--color-text)] dark:bg-slate-900/50">
          {total > 0 ? (
            <div className="font-medium">Default source: {suggestedLabel} ৳{total.toLocaleString()}</div>
          ) : (
            <div className="font-medium">Open advanced to prepare scheme/source allocation before entering a discount.</div>
          )}
          {benefit?.eligible && (
            <div className="mt-1 text-[var(--color-text-muted)]">
              Eligible benefit found: {benefit.label ?? getDiscountSourceLabel(benefit.allocationReason ?? suggestedReason)}
              {benefit.suggestedAmount ? ` — suggested ৳${roundMoney(benefit.suggestedAmount).toLocaleString()}` : ''}
            </div>
          )}
        </div>
      )}

      {enabled && (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-white/70 p-2 space-y-2 dark:bg-slate-900/40">
          {hasDoctorWaiverRow && context.doctorWaiverPreviewFailed ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              Could not verify the selected doctor’s eligible commission. Select Doctor waiver again to retry before creating the invoice.
            </div>
          ) : hasDoctorWaiverRow && context.doctorWaiverLoading ? (
            <div className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
              Checking the selected doctor’s eligible commission. The discount will split automatically when the preview is ready.
            </div>
          ) : context.selectedDoctorId && doctorAvailableWaiver > 0 ? (
            <div className="rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-[11px] text-orange-800 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200">
              <div className="font-semibold">Doctor waiver available up to ৳{doctorAvailableWaiver.toLocaleString()}.</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                <span>Earned ৳{roundMoney(context.eligibleCommissionAmount).toLocaleString()}</span>
                <span>Performer reserve ৳{roundMoney(context.performerReserveAmount).toLocaleString()}</span>
                <span>Protected ৳{roundMoney(context.protectedCommissionAmount).toLocaleString()}</span>
                <span>Protected payable after max waiver ৳{roundMoney(context.payableCommissionAmount).toLocaleString()}</span>
              </div>
              <div className="mt-1">Any remaining discount will stay as Hospital discount unless you split it elsewhere.</div>
            </div>
          ) : hasDoctorWaiverRow ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              No eligible doctor commission was found for this bill, so the discount is hospital-funded.
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            {ADVANCED_QUICK_SOURCE_OPTIONS.map((option) => {
              const meta = getReasonMeta(option.value);
              const active = rows.some((row) => row.reason === option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${meta.chipClass} ${active ? meta.activeChipClass : ''}`}
                  onClick={() => applyQuickSource(option.value)}
                  title={meta.hint}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {rows.filter((row) => roundMoney(row.amount) > 0 || rows.length <= 1).map((row, index) => (
            <div key={row.id} className="grid grid-cols-12 gap-2 items-start">
              <select
                className="input col-span-12 md:col-span-4 text-xs"
                value={row.reason}
                onChange={(event) => {
                  const reason = event.target.value as DiscountAllocationReason;
                  onRowsChange(replaceAllocationRowReason(rows, row.id, reason, total, context));
                  onQuickSourceSelected?.(reason);
                }}
              >
                {DISCOUNT_REASON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <input
                type="number"
                className="input col-span-7 md:col-span-3 text-xs"
                min={0}
                step="0.01"
                value={row.amount}
                placeholder="Amount"
                onChange={(event) => onRowsChange(rows.map((item) => item.id === row.id ? { ...item, amount: event.target.value } : item))}
              />
              <button
                type="button"
                className="btn-ghost col-span-3 md:col-span-2 px-2 py-1 text-xs"
                onClick={() => {
                  const rowRemaining = getRemainingDiscountAmount(rows, total, row.id);
                  onRowsChange(rows.map((item) => item.id === row.id ? { ...item, amount: amountToInput(rowRemaining) } : item));
                }}
              >
                Use remaining
              </button>
              <button
                type="button"
                className="btn-ghost col-span-2 md:col-span-1 px-2 py-1 text-xs text-red-600"
                onClick={() => onRowsChange(rows.filter((item) => item.id !== row.id))}
                disabled={rows.length <= 1}
                aria-label={`Remove allocation ${index + 1}`}
              >
                ×
              </button>
              <input
                className="input col-span-12 md:col-span-2 text-xs"
                value={row.note ?? ''}
                placeholder="Note"
                onChange={(event) => onRowsChange(rows.map((item) => item.id === row.id ? { ...item, note: event.target.value } : item))}
              />
            </div>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-xs"
              onClick={() => onRowsChange(appendDiscountAllocationWithRemaining(rows, total, context))}
            >
              + Add source
            </button>
            <div className={balanced ? 'text-emerald-700' : 'text-amber-700'}>
              Allocated ৳{allocated.toLocaleString()} / ৳{total.toLocaleString()}
              {!balanced ? ` (${remaining > 0 ? 'remaining' : 'over'} ৳{Math.abs(remaining).toLocaleString()})` : ''}
            </div>
          </div>
          {!balanced && total > 0 && (
            <div className="rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Allocation total must match the discount amount before creating the bill.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
