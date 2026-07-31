import type { InvoiceInspectorAuditEvent } from '../../types/invoiceInspector';

const label = (value?: string | null) => value?.trim().replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Event';

export default function InvoiceAuditTab({ audit }: { audit: InvoiceInspectorAuditEvent[] }) {
  if (audit.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">No invoice audit events were found.</p>;
  return (
    <ol role="list" aria-label="Invoice audit timeline" className="space-y-3">
      {audit.map((event) => (
        <li key={event.id} className="relative rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/40 p-4 pl-6">
          <span className="absolute left-2 top-5 h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]" aria-hidden="true" />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div><p className="font-semibold text-[var(--color-text-primary)]">{event.description || label(event.eventType)}</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">{event.occurredAt || 'Time not recorded'} · {label(event.eventType)}</p></div>
            {event.status ? <span className="rounded-full bg-[var(--color-bg-card)] px-2 py-1 text-xs font-semibold">{label(event.status)}</span> : null}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2"><div><dt className="text-xs text-[var(--color-text-muted)]">Actor</dt><dd className="text-sm font-semibold">{event.actorName || 'Not recorded'}</dd></div><div><dt className="text-xs text-[var(--color-text-muted)]">Reference</dt><dd className="break-all text-sm font-semibold">{event.referenceNo || 'Not recorded'}</dd></div></dl>
        </li>
      ))}
    </ol>
  );
}
