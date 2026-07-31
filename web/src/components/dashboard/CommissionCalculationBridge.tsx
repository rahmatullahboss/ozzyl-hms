import type { DoctorCommissionDetailRow } from '../../types/executiveDashboard';

const money = (value: number) => `৳${new Intl.NumberFormat('en-BD', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value || 0))}`;

const display = (value: string | number | null | undefined) => String(value ?? '').trim() || 'Not recorded';

interface BridgeItemProps {
  label: string;
  value: string;
  emphasis?: boolean;
}

function BridgeItem({ label, value, emphasis = false }: BridgeItemProps) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${emphasis ? 'border-[var(--color-primary)]/40 bg-[var(--color-primary-light)]/40' : 'border-[var(--color-border)] bg-[var(--color-bg-card)]'}`}>
      <dt className="text-xs font-medium text-[var(--color-text-muted)]">{label}</dt>
      <dd className={`mt-1 break-words font-data text-sm ${emphasis ? 'font-bold text-[var(--color-primary)]' : 'font-semibold text-[var(--color-text-primary)]'}`}>{value}</dd>
    </div>
  );
}

interface Props {
  row: DoctorCommissionDetailRow;
  onInvoiceOpen?: (billId: number) => void;
}

export default function CommissionCalculationBridge({ row, onInvoiceOpen }: Props) {
  const ruleIdentity = row.commissionRuleId == null
    ? 'Rule not recorded'
    : row.commissionRuleVersion == null
      ? `Rule ${row.commissionRuleId}`
      : `Rule ${row.commissionRuleId} · version ${row.commissionRuleVersion}`;

  return (
    <article className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/40 p-4" aria-label={`${row.detailName || 'Commission'} compensation calculation`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold text-[var(--color-text-primary)]">{display(row.detailName)}</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{display(row.occurredAt)} · {display(row.incentiveType)} · {display(row.status)}</p>
        </div>
        {row.billId && onInvoiceOpen ? (
          <button
            type="button"
            className="min-h-11 shrink-0 rounded-lg border border-[var(--color-border)] px-3 text-sm font-semibold text-[var(--color-primary)] hover:bg-[var(--color-bg-secondary)]"
            aria-label={`Open invoice ${row.referenceNo || row.billId}`}
            onClick={() => onInvoiceOpen(row.billId as number)}
          >
            {row.referenceNo || `Bill ${row.billId}`}
          </button>
        ) : (
          <span className="text-xs text-[var(--color-text-muted)]">{display(row.referenceNo)}</span>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        <BridgeItem label="Gross" value={money(row.grossAmount)} />
        <BridgeItem label="Discount" value={money(row.discountAmount)} />
        <BridgeItem label="Performer reserve" value={money(row.performerReserveAmount)} />
        <BridgeItem label="Eligible base" value={money(row.commissionBaseAmount)} />
        <BridgeItem label="Rate" value={display(row.rateLabel)} />
        <BridgeItem label="Rule" value={ruleIdentity} />
        <BridgeItem label="Earned" value={money(row.earnedAmount)} />
        <BridgeItem label="Doctor waiver" value={money(row.waiverAmount)} />
        <BridgeItem label="Adjustment" value={money(row.adjustmentAmount)} />
        <BridgeItem label="Payable" value={money(row.payableAmount)} emphasis />
        <BridgeItem label="Paid" value={money(row.paidAmount)} />
        <BridgeItem label="Outstanding" value={money(row.outstandingAmount)} emphasis={row.outstandingAmount > 0} />
      </dl>

      <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 text-sm">
        <p className="font-semibold text-[var(--color-text-primary)]">{display(row.reasonLabel)}</p>
        <code className="mt-1 inline-block rounded bg-[var(--color-bg-secondary)] px-2 py-1 text-xs text-[var(--color-text-secondary)]">{display(row.reasonCode)}</code>
        {row.waiverReason ? <p className="mt-2 text-xs text-[var(--color-text-muted)]">Waiver note: {row.waiverReason}</p> : null}
      </div>

      {row.commissionRuleVersion == null ? (
        <p role="note" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Historical rule version not recorded
        </p>
      ) : null}
    </article>
  );
}
