import type { InvoiceInspectorDiscountAllocation } from '../../types/invoiceInspector';

const money = (value: number) => new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'BDT', currencyDisplay: 'code', minimumFractionDigits: 2,
}).format(Number(value || 0));
const label = (value?: string | null) => value?.trim().replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Not recorded';

export default function InvoiceDiscountTab({ discounts }: { discounts: InvoiceInspectorDiscountAllocation[] }) {
  if (discounts.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">No discount or referral allocations were found.</p>;
  return (
    <div className="space-y-3">
      {discounts.map((discount) => (
        <article key={discount.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/40 p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-[var(--color-text-primary)]">{discount.referenceName || `Allocation ${discount.id}`}</p><p className="mt-1 text-sm text-[var(--color-text-muted)]">{discount.reason || 'Reason not recorded'}</p></div><p className="font-data font-bold">{money(discount.amount)}</p></div>
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3"><div><dt className="text-xs text-[var(--color-text-muted)]">Source</dt><dd className="text-sm font-semibold">{label(discount.sourceType)}</dd></div><div><dt className="text-xs text-[var(--color-text-muted)]">Funder</dt><dd className="text-sm font-semibold">{label(discount.funderType)}</dd></div>{discount.doctorName ? <div><dt className="text-xs text-[var(--color-text-muted)]">Doctor</dt><dd className="text-sm font-semibold">{discount.doctorName}</dd></div> : null}</dl>
        </article>
      ))}
    </div>
  );
}
