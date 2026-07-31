import type { DoctorActivityRow } from '../../types/executiveDashboard';

const money = (value: number) => `৳${new Intl.NumberFormat('en-BD', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value || 0))}`;

const titleCase = (value: string | null | undefined) => {
  const normalized = value?.trim().replace(/[_-]+/g, ' ');
  return normalized ? normalized.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Not recorded';
};

const reasonLabel = (value: string | null | undefined) => {
  const labels: Record<string, string> = {
    rule_matched: 'Rule matched',
    no_matching_rule: 'No matching rule',
    doctor_missing: 'Doctor missing',
    bill_unpaid: 'Bill unpaid',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
    eligible_base_zero: 'Eligible base is zero',
    doctor_waived: 'Doctor waived commission',
    manual_adjustment: 'Manual adjustment',
    reversal: 'Reversal',
    held_for_review: 'Held for review',
  };
  const normalized = value?.trim().toLowerCase() ?? '';
  return labels[normalized] ?? titleCase(value);
};

interface Props {
  rows: DoctorActivityRow[];
  onInvoiceOpen?: (billId: number) => void;
}

export default function DoctorActivityTimeline({ rows, onInvoiceOpen }: Props) {
  return (
    <ol role="list" aria-label="Doctor activity timeline" className="space-y-3">
      {rows.map((row) => (
        <li key={row.eventId} className="relative rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/40 p-4 pl-6">
          <span className="absolute left-2 top-5 h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]" aria-hidden="true" />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold text-[var(--color-text-primary)]">{row.title}</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{row.occurredAt} · {titleCase(row.eventType)}</p>
            </div>
            <span className="font-data text-sm font-bold text-[var(--color-text-primary)]">{money(row.amount)}</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            {row.patientIdentityRedacted ? (
              <span className="rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">Patient identity hidden by permission</span>
            ) : row.patientName ? (
              <span className="rounded-full bg-[var(--color-bg-card)] px-2 py-1">{row.patientName}</span>
            ) : null}
            {row.status ? <span className="rounded-full bg-[var(--color-bg-card)] px-2 py-1">{titleCase(row.status)}</span> : null}
            {row.reasonCode ? <span className="rounded-full bg-[var(--color-bg-card)] px-2 py-1">{reasonLabel(row.reasonCode)}</span> : null}
          </div>

          {row.billId && onInvoiceOpen ? (
            <button
              type="button"
              className="mt-3 min-h-11 rounded-lg border border-[var(--color-border)] px-3 text-sm font-semibold text-[var(--color-primary)] hover:bg-[var(--color-bg-secondary)]"
              aria-label={`Open invoice ${row.invoiceNo || row.billId}`}
              onClick={() => onInvoiceOpen(row.billId as number)}
            >
              {row.invoiceNo || `Bill ${row.billId}`}
            </button>
          ) : row.invoiceNo ? (
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">{row.invoiceNo}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
