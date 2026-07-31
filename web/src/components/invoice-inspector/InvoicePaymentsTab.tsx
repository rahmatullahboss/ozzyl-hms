import type { InvoiceInspectorDeposit, InvoiceInspectorPayment } from '../../types/invoiceInspector';

const money = (value: number) => new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'BDT', currencyDisplay: 'code', minimumFractionDigits: 2,
}).format(Number(value || 0));
const label = (value?: string | null) => value?.trim().replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Not recorded';

export default function InvoicePaymentsTab({ payments, deposits }: { payments: InvoiceInspectorPayment[]; deposits: InvoiceInspectorDeposit[] }) {
  if (payments.length === 0 && deposits.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">No payments or deposit adjustments were found.</p>;
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">Cash and other payments</h3>
        <div className="mt-3 space-y-2">
          {payments.length > 0 ? payments.map((payment) => (
            <article key={payment.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/40 p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{payment.receiptNo || `Payment ${payment.id}`}</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">{label(payment.method)} · {label(payment.paymentType)} · {payment.paidAt || 'Time not recorded'}</p></div><p className="font-data font-bold">{money(payment.amount)}</p></div>
              <dl className="mt-3 grid grid-cols-2 gap-2"><div><dt className="text-xs text-[var(--color-text-muted)]">Collector</dt><dd className="text-sm font-semibold">{payment.collectorName || 'Not recorded'}</dd></div><div><dt className="text-xs text-[var(--color-text-muted)]">Counter</dt><dd className="text-sm font-semibold">{payment.counterName || 'Not recorded'}</dd></div></dl>
            </article>
          )) : <p className="text-sm text-[var(--color-text-muted)]">No cash or other payments were found.</p>}
        </div>
      </section>
      <section>
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">Deposit adjustments</h3>
        <div className="mt-3 space-y-2">
          {deposits.length > 0 ? deposits.map((deposit) => (
            <article key={deposit.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/40 p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{deposit.referenceNo || `Deposit ${deposit.id}`}</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">{label(deposit.adjustmentType)} · {label(deposit.paymentMethod)} · {deposit.occurredAt || 'Time not recorded'}</p></div><p className="font-data font-bold">{money(deposit.amount)}</p></div>
            </article>
          )) : <p className="text-sm text-[var(--color-text-muted)]">No deposit adjustments were found.</p>}
        </div>
      </section>
    </div>
  );
}
