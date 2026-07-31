import { ShieldAlert } from 'lucide-react';
import type { InvoiceInspectorResponse } from '../../types/invoiceInspector';
import InvoiceReconciliationPanel from './InvoiceReconciliationPanel';

const money = (value: number) => new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'BDT',
  currencyDisplay: 'code',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value || 0));

function SummaryMetric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${emphasis
      ? 'border-[var(--color-primary)]/40 bg-[var(--color-primary-light)]/40'
      : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)]/50'}`}
    >
      <dt className="text-xs font-medium text-[var(--color-text-muted)]">{label}</dt>
      <dd className={`mt-1 break-words font-data text-base ${emphasis ? 'font-bold text-[var(--color-primary)]' : 'font-semibold text-[var(--color-text-primary)]'}`}>{value}</dd>
    </div>
  );
}

export default function InvoiceSummaryTab({ data }: { data: InvoiceInspectorResponse }) {
  const { summary } = data;
  return (
    <div className="space-y-5">
      <section aria-label="Invoice identity" className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Patient</p>
          {summary.patientIdentityRedacted ? (
            <div className="mt-2 flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-200">
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              Patient identity hidden by permission
            </div>
          ) : (
            <>
              <p className="mt-2 font-semibold text-[var(--color-text-primary)]">{summary.patientName || 'Patient not recorded'}</p>
              {summary.patientCode ? <p className="mt-1 text-sm text-[var(--color-text-muted)]">{summary.patientCode}</p> : null}
            </>
          )}
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Invoice context</p>
          <p className="mt-2 font-semibold capitalize text-[var(--color-text-primary)]">{summary.billType?.replace(/[_-]+/g, ' ') || 'General billing'}</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{summary.createdAt || 'Time not recorded'}</p>
        </div>
      </section>

      <section aria-label="Invoice amounts">
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">Amounts</h3>
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryMetric label="Gross" value={money(summary.grossAmount)} />
          <SummaryMetric label="Discount" value={money(summary.discountAmount)} />
          <SummaryMetric label="Net" value={money(summary.netAmount)} emphasis />
          <SummaryMetric label="Cash paid" value={money(summary.paidAmount)} />
          <SummaryMetric label="Deposit applied" value={money(summary.depositAppliedAmount)} />
          <SummaryMetric label="Due" value={money(summary.dueAmount)} emphasis={summary.dueAmount > 0} />
        </dl>
      </section>

      <InvoiceReconciliationPanel reconciliation={data.reconciliation} />
    </div>
  );
}
