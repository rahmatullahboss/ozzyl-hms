import type { InvoiceInspectorItem } from '../../types/invoiceInspector';

const money = (value: number) => new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'BDT', currencyDisplay: 'code', minimumFractionDigits: 2,
}).format(Number(value || 0));
const display = (value?: string | null) => value?.trim() || 'Not recorded';

export default function InvoiceItemsTab({ items }: { items: InvoiceInspectorItem[] }) {
  if (items.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">No invoice items or tests were found.</p>;
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <article key={item.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/40 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold text-[var(--color-text-primary)]">{item.description}</p>
              <p className="mt-1 text-xs font-medium capitalize text-[var(--color-text-muted)]">{item.category.replace(/[_-]+/g, ' ')}</p>
            </div>
            <p className="font-data text-sm font-bold text-[var(--color-text-primary)]">{money(item.lineTotal)}</p>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <div><dt className="text-xs text-[var(--color-text-muted)]">Quantity</dt><dd className="font-data text-sm font-semibold">{item.quantity}</dd></div>
            <div><dt className="text-xs text-[var(--color-text-muted)]">Rate</dt><dd className="font-data text-sm font-semibold">{money(item.rate)}</dd></div>
            <div><dt className="text-xs text-[var(--color-text-muted)]">Ordering doctor</dt><dd className="text-sm font-semibold">{display(item.orderingDoctorName)}</dd></div>
            <div><dt className="text-xs text-[var(--color-text-muted)]">Referring doctor</dt><dd className="text-sm font-semibold">{display(item.referringDoctorName)}</dd></div>
            <div><dt className="text-xs text-[var(--color-text-muted)]">Performing doctor</dt><dd className="text-sm font-semibold">{display(item.performingDoctorName)}</dd></div>
            <div><dt className="text-xs text-[var(--color-text-muted)]">Verifying doctor</dt><dd className="text-sm font-semibold">{display(item.verifyingDoctorName)}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  );
}
