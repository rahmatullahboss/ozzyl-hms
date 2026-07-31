import type { RefObject } from 'react';
import { Clipboard, ExternalLink, FileDown, Printer, X } from 'lucide-react';
import type { InvoiceInspectorResponse } from '../../types/invoiceInspector';

interface Props {
  invoiceNo: string;
  status: string;
  actions: InvoiceInspectorResponse['actions'];
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
}

export default function InvoiceInspectorHeader({
  invoiceNo,
  status,
  actions,
  closeButtonRef,
  onClose,
}: Props) {
  return (
    <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Invoice inspector</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="break-all font-data text-xl font-bold text-[var(--color-text-primary)]">{invoiceNo}</h2>
            <span className="rounded-full bg-[var(--color-bg-secondary)] px-2 py-1 text-xs font-semibold capitalize text-[var(--color-text-secondary)]">
              {status.replace(/[_-]+/g, ' ')}
            </span>
          </div>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          className="btn-ghost min-h-11 min-w-11 shrink-0 p-2"
          aria-label="Close invoice inspector"
          onClick={onClose}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary min-h-11 gap-2 text-sm"
          aria-label="Copy invoice number"
          onClick={() => { void copyText(invoiceNo); }}
        >
          <Clipboard className="h-4 w-4" aria-hidden="true" />
          Copy
        </button>
        {actions.fullBillingUrl ? (
          <a className="btn-secondary min-h-11 gap-2 text-sm" href={actions.fullBillingUrl} aria-label="Open full billing details">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Full billing
          </a>
        ) : null}
        {actions.printUrl ? (
          <a className="btn-secondary min-h-11 gap-2 text-sm" href={actions.printUrl} aria-label="Print invoice">
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print
          </a>
        ) : null}
        {actions.pdfUrl ? (
          <a className="btn-secondary min-h-11 gap-2 text-sm" href={actions.pdfUrl} aria-label="Open invoice PDF">
            <FileDown className="h-4 w-4" aria-hidden="true" />
            PDF
          </a>
        ) : null}
      </div>
    </header>
  );
}
