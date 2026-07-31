/**
 * Reception Print Module — Base Renderer
 *
 * This module is the SINGLE source of styling/layout for all reception-side
 * PDFs (single documents, slips, vouchers, statements). Admin PDFs use a
 * separate renderer; do NOT import admin-side print utilities here.
 *
 * Design rules:
 *  - HTML + window.print() (Bangla-friendly via Noto Sans Bengali)
 *  - Standard header (hospital/branch/document no) + standard footer (status/signatures)
 *  - Optional watermark (DUPLICATE / DRAFT / VOID) — passes through CSS
 *  - Optional QR placeholder (verification code or doc URL)
 *  - Soft audit hook — caller passes auditMeta; module calls a callback after print fires
 *
 * No external dependencies beyond the existing @/lib/format and @/lib/print/printUtils helpers.
 */

import { formatCurrency } from '../../format';

// ── Types ────────────────────────────────────────────────────────────────

export type DocumentStatus =
  | 'draft'
  | 'submitted'
  | 'pending_approval'
  | 'approved'
  | 'cancelled'
  | 'paid'
  | 'partial'
  | 'due';

export type Watermark = 'duplicate' | 'draft' | 'void' | 'cancelled' | 'pending';

export type PageSize = 'a4' | 'a5';

export type Orientation = 'portrait' | 'landscape';

export type ReceptionContext = {
  hospitalName: string;
  branchName?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Counter / desk identifier (e.g., "Counter R01") */
  counterName?: string | null;
  counterCode?: string | null;
  /** Current shift / session */
  shiftId?: number | string | null;
  shiftName?: string | null;
  /** Active cashier / receptionist */
  cashierName?: string | null;
  cashierId?: number | string | null;
  /** Document-level status badge */
  status?: DocumentStatus | null;
  /** Document number / reference (e.g., voucher no, slip no) */
  documentNo?: string | null;
  /** Document title shown in header right column */
  documentTitle?: string | null;
  /** When the document was generated (ISO string) */
  generatedAt?: string | null;
  /** Who generated it (receptionist name) */
  generatedBy?: string | null;
};

export type AuditMeta = {
  documentType: string;
  documentId: number | string;
  copyNumber?: number;
  watermark?: Watermark;
};

export type SignatureRole =
  | 'cashier'
  | 'receiver'
  | 'supervisor'
  | 'admin'
  | 'patient'
  | 'doctor'
  | 'delivered_to'
  | 'prepared_by';

export type SignatureLine = {
  role: SignatureRole;
  label: string;
  /** Optional second line (e.g., employee ID, designation) */
  subLabel?: string;
};

export type WrapOptions = {
  pageSize?: PageSize;
  orientation?: Orientation;
  watermark?: Watermark;
  /** Copy number for duplicate receipts (1, 2, 3...) — adds "COPY N" indicator */
  copyNumber?: number;
  /** Override default signature lines */
  signatures?: SignatureLine[];
  /** Hide the default signature block in footer when a document places signatures inline */
  hideSignatures?: boolean;
  /** Disable the toolbar (no print/close buttons — for embedded use) */
  hideToolbar?: boolean;
  /** QR code data — when provided, renders a small QR with the data payload */
  qrPayload?: string;
  /** Hide QR even if provided (debugging) */
  disableQR?: boolean;
  /** Auto-trigger window.print() on open (default true) */
  autoPrint?: boolean;
  /** Soft audit metadata — when provided, the audit callback fires after print */
  auditMeta?: AuditMeta;
  /** Called after the print window opens (or fails). Use for fire-and-forget audit. */
  onAfterPrint?: () => void | Promise<void>;
};

const DEFAULT_SIGNATURES: SignatureLine[] = [
  { role: 'cashier', label: 'Cashier' },
  { role: 'receiver', label: 'Receiver' },
  { role: 'admin', label: 'Admin / Accounts' },
];

// ── Helpers ──────────────────────────────────────────────────────────────

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown): string {
  return formatCurrency(num(value), { fractionDigits: 2 });
}

function watermarkText(w: Watermark): string {
  switch (w) {
    case 'duplicate':
      return 'DUPLICATE COPY';
    case 'draft':
      return 'DRAFT';
    case 'void':
      return 'VOID';
    case 'cancelled':
      return 'CANCELLED';
    case 'pending':
      return 'PENDING APPROVAL';
    default:
      return '';
  }
}

function statusBadge(status?: DocumentStatus | null): { label: string; bg: string; fg: string } | null {
  if (!status) return null;
  const map: Record<DocumentStatus, { label: string; bg: string; fg: string }> = {
    draft: { label: 'DRAFT', bg: '#fef3c7', fg: '#92400e' },
    submitted: { label: 'SUBMITTED', bg: '#dbeafe', fg: '#1e40af' },
    pending_approval: { label: 'PENDING APPROVAL', bg: '#fef3c7', fg: '#92400e' },
    approved: { label: 'APPROVED', bg: '#d1fae5', fg: '#065f46' },
    cancelled: { label: 'CANCELLED', bg: '#fee2e2', fg: '#991b1b' },
    paid: { label: 'PAID', bg: '#d1fae5', fg: '#065f46' },
    partial: { label: 'PARTIAL', bg: '#fef3c7', fg: '#92400e' },
    due: { label: 'DUE', bg: '#fee2e2', fg: '#991b1b' },
  };
  return map[status] ?? null;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

// ── Header ───────────────────────────────────────────────────────────────

/**
 * Standard reception header.
 * Left: hospital name + branch + address/phone
 * Right: document title + document no + generated at/by + status badge
 * Bottom: shift / counter / cashier meta strip (cyan-teal accent line)
 */
export function buildReceptionHeader(ctx: ReceptionContext): string {
  const generatedAt = ctx.generatedAt ?? new Date().toISOString();
  const badge = statusBadge(ctx.status);

  const addressLine = [ctx.address, ctx.phone].filter(Boolean).join(' · ');

  return `
    <header class="rec-header">
      <div class="rec-header-left">
        <h1 class="rec-hospital">${escapeHtml(ctx.hospitalName)}</h1>
        ${ctx.branchName ? `<p class="rec-branch">${escapeHtml(ctx.branchName)}</p>` : ''}
        ${addressLine ? `<p class="rec-address">${escapeHtml(addressLine)}</p>` : ''}
      </div>
      <div class="rec-header-right">
        <h2 class="rec-doc-title">${escapeHtml(ctx.documentTitle ?? 'Reception Document')}</h2>
        ${ctx.documentNo ? `<p class="rec-doc-no">No. <strong>${escapeHtml(ctx.documentNo)}</strong></p>` : ''}
        <p class="rec-gen"><strong>Generated:</strong> ${escapeHtml(formatDateTime(generatedAt))}</p>
        ${ctx.generatedBy ? `<p class="rec-gen"><strong>By:</strong> ${escapeHtml(ctx.generatedBy)}</p>` : ''}
        ${badge ? `<span class="rec-status" style="background:${badge.bg};color:${badge.fg}">${badge.label}</span>` : ''}
      </div>
    </header>
    <section class="rec-meta-strip">
      ${ctx.shiftName || ctx.shiftId ? `<div><span>Shift</span><strong>${escapeHtml(ctx.shiftName ?? `#${ctx.shiftId}`)}</strong></div>` : ''}
      ${ctx.counterName || ctx.counterCode ? `<div><span>Counter</span><strong>${escapeHtml([ctx.counterCode, ctx.counterName].filter(Boolean).join(' · '))}</strong></div>` : ''}
      ${ctx.cashierName ? `<div><span>Cashier</span><strong>${escapeHtml(ctx.cashierName)}</strong></div>` : ''}
    </section>
  `;
}

// ── Footer ───────────────────────────────────────────────────────────────

/**
 * Standard reception footer with signature lines.
 * Three columns by default: Cashier | Receiver | Admin/Accounts.
 * Pass custom `signatures` array to override.
 */
export function buildReceptionSignatureBlock(opts: { signatures?: SignatureLine[] } = {}): string {
  const lines = opts.signatures && opts.signatures.length > 0 ? opts.signatures : DEFAULT_SIGNATURES;
  const signatureHtml = lines
    .map(
      (line) => `
    <div class="rec-sig">
      <span class="rec-sig-line"></span>
      <strong>${escapeHtml(line.label)}</strong>
      ${line.subLabel ? `<small>${escapeHtml(line.subLabel)}</small>` : ''}
      <small>Date: ____________</small>
    </div>
  `,
    )
    .join('');

  return `<section class="rec-signatures">${signatureHtml}</section>`;
}

export function buildReceptionFooter(opts: { signatures?: SignatureLine[]; hideSignatures?: boolean } = {}): string {
  return `
    ${opts.hideSignatures ? '' : buildReceptionSignatureBlock({ signatures: opts.signatures })}
    <footer class="rec-footer">
      <p>This is a system-generated reception document. Final approval by Admin/Accounts is required for audit purposes.</p>
    </footer>
  `;
}

// ── QR Code ──────────────────────────────────────────────────────────────

/**
 * Render a QR code as an inline PNG via a public QR service.
 * Avoids adding `qrcode` or `qrcode.react` to the print bundle — works without build-time dep.
 * Returns empty string when payload is missing or QR is disabled.
 */
function renderQR(payload: string | undefined, disableQR?: boolean): string {
  if (!payload || disableQR) return '';
  const encoded = encodeURIComponent(payload);
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=80x80&margin=0&data=${encoded}`;
  return `<img class="rec-qr" src="${escapeHtml(url)}" alt="QR" />`;
}

// ── Page wrapper ─────────────────────────────────────────────────────────

/**
 * Wrap document body in full HTML page with @page rules, header, footer, watermark, QR.
 * Returns the full HTML string — pass to `openPrintWindow()` to open the print window.
 */
export function wrapReceptionPage(
  ctx: ReceptionContext,
  body: string,
  options: WrapOptions = {},
): string {
  const pageSize = options.pageSize ?? 'a5';
  const orientation = options.orientation ?? 'portrait';
  const isA5 = pageSize === 'a5';
  const pageWidth = isA5 ? (orientation === 'landscape' ? '190mm' : '128mm') : (orientation === 'landscape' ? '277mm' : '190mm');
  const pageMinHeight = isA5 ? (orientation === 'landscape' ? '128mm' : '190mm') : (orientation === 'landscape' ? '190mm' : '277mm');
  const fontSize = isA5 ? '10.5px' : '12px';
  const headingSize = isA5 ? '15px' : '19px';
  const subheadingSize = isA5 ? '12.5px' : '16.5px';
  const padding = isA5 ? '5mm' : '8mm';
  const margin = isA5 ? '5mm' : '8mm';
  const sigCount = options.signatures?.length ?? DEFAULT_SIGNATURES.length;
  const sigColumns = Math.min(Math.max(sigCount, 1), 4);

  const watermark = options.watermark
    ? `<div class="rec-watermark" aria-hidden="true">${escapeHtml(watermarkText(options.watermark))}</div>`
    : '';

  const copyIndicator =
    options.copyNumber && options.copyNumber > 1
      ? `<span class="rec-copy">COPY #${options.copyNumber}</span>`
      : '';

  const qr = renderQR(options.qrPayload, options.disableQR);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(ctx.documentTitle ?? ctx.documentNo ?? 'Reception Document')}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    @page { size: ${pageSize.toUpperCase()} ${orientation}; margin: ${margin}; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #f1f5f9; color: #153044; }
    body { font-family: 'Arial', 'Noto Sans Bengali', Helvetica, sans-serif; font-size: ${fontSize}; line-height: 1.35; }
    .rec-toolbar { display: ${options.hideToolbar ? 'none' : 'flex'}; justify-content: center; gap: 8px; padding: 10px; background: #e0f2fe; border-bottom: 1px solid #bae6fd; }
    .rec-toolbar button { border: 0; border-radius: 8px; padding: 8px 14px; font-weight: 700; cursor: pointer; font-family: inherit; font-size: ${fontSize}; }
    .rec-toolbar .rec-btn-primary { background: #0891a6; color: #fff; }
    .rec-toolbar .rec-btn-secondary { background: #cbd5e1; color: #153044; }
    .rec-page { width: ${pageWidth}; min-height: ${pageMinHeight}; margin: 14px auto; background: #fff; padding: ${padding}; box-shadow: 0 6px 18px rgba(15,23,42,.14); position: relative; overflow: hidden; }
    .rec-watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: ${isA5 ? '52px' : '72px'}; color: rgba(15, 23, 42, 0.06); font-weight: 800; letter-spacing: 0.1em; pointer-events: none; white-space: nowrap; z-index: 0; }
    .rec-page > * { position: relative; z-index: 1; }
    .rec-header { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; border-bottom: 2.5px solid #0891a6; padding-bottom: 8px; }
    .rec-hospital { margin: 0; color: #0f4055; font-size: ${headingSize}; font-weight: 700; line-height: 1.1; }
    .rec-branch { margin: 2px 0 0; color: #334155; font-size: ${subheadingSize}; font-weight: 600; }
    .rec-address { margin: 2px 0 0; color: #64748b; font-size: ${fontSize}; }
    .rec-header-right { text-align: right; max-width: 50%; }
    .rec-doc-title { margin: 0; color: #0f4055; font-size: ${subheadingSize}; font-weight: 700; line-height: 1.1; }
    .rec-doc-no { margin: 3px 0 0; color: #334155; font-size: ${fontSize}; }
    .rec-gen { margin: 2px 0 0; color: #64748b; font-size: ${fontSize}; }
    .rec-status { display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 999px; font-size: ${isA5 ? '8px' : '9.5px'}; font-weight: 700; letter-spacing: 0.05em; }
    .rec-copy { display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 6px; font-size: ${isA5 ? '8px' : '9.5px'}; font-weight: 700; background: #fde68a; color: #92400e; }
    .rec-meta-strip { margin-top: 8px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 12px; background: #ecfeff; border: 1px solid #a5f3fc; border-radius: 6px; padding: 6px 10px; }
    .rec-meta-strip > div { display: flex; flex-direction: column; }
    .rec-meta-strip span { color: #155e75; font-weight: 700; font-size: ${isA5 ? '7.5px' : '8.5px'}; text-transform: uppercase; letter-spacing: 0.05em; }
    .rec-meta-strip strong { color: #0f4055; font-size: ${fontSize}; font-family: ui-monospace, Menlo, monospace; }
    .rec-qr { position: absolute; top: ${padding}; right: ${padding}; width: 60px; height: 60px; opacity: 0.85; }
    .rec-section { margin-top: 10px; }
    .rec-section-title { color: #0f4055; font-size: ${subheadingSize}; font-weight: 700; margin: 0 0 4px; }
    .rec-section-sub { color: #64748b; font-size: ${fontSize}; margin: 0 0 6px; }
    .rec-table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    .rec-table th { background: #0891a6; color: white; text-align: left; padding: 4px 6px; font-size: ${isA5 ? '7.5px' : '9px'}; line-height: 1.2; }
    .rec-table td { border-bottom: 1px solid #e2e8f0; padding: 4px 6px; vertical-align: top; word-break: break-word; line-height: 1.3; }
    .rec-table .right { text-align: right; white-space: nowrap; font-family: ui-monospace, Menlo, monospace; }
    .rec-table .center { text-align: center; }
    .rec-table .empty { text-align: center; color: #64748b; padding: 18px; }
    .rec-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; margin-top: 6px; }
    .rec-info-row { display: grid; grid-template-columns: ${isA5 ? '70px' : '90px'} 1fr; gap: 6px; }
    .rec-info-row > strong { color: #334155; }
    .rec-summary-grid { display: grid; grid-template-columns: repeat(${isA5 ? '3' : '4'}, 1fr); gap: 5px; margin-top: 8px; }
    .rec-metric { border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px 7px; }
    .rec-metric > span { display: block; color: #64748b; font-weight: 700; font-size: ${isA5 ? '7px' : '8.5px'}; text-transform: uppercase; letter-spacing: 0.04em; }
    .rec-metric > strong { display: block; margin-top: 2px; color: #0f4055; font-family: ui-monospace, Menlo, monospace; font-size: ${isA5 ? '10px' : '13px'}; }
    .rec-metric.in > strong { color: #047857; }
    .rec-metric.out > strong { color: #b91c1c; }
    .rec-metric.neutral > strong { color: #0f4055; }
    .rec-signatures { display: grid; grid-template-columns: repeat(${sigColumns}, 1fr); gap: ${isA5 ? '14px' : '24px'}; margin-top: ${isA5 ? '20px' : '32px'}; text-align: center; }
    .rec-sig { display: flex; flex-direction: column; }
    .rec-sig-line { display: block; border-top: 1px solid #94a3b8; height: 1px; margin-bottom: 4px; min-height: 26px; }
    .rec-sig > strong { color: #153044; font-size: ${fontSize}; }
    .rec-sig > small { color: #64748b; font-size: ${isA5 ? '7.5px' : '8.5px'}; }
    .rec-footer { margin-top: 14px; padding-top: 6px; border-top: 1px dashed #cbd5e1; color: #64748b; text-align: center; font-size: ${isA5 ? '7.5px' : '8.5px'}; }
    .rec-pill { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: ${isA5 ? '7.5px' : '9px'}; font-weight: 700; background: #e0f2fe; color: #0369a1; }
    .rec-pill.warn { background: #fef3c7; color: #92400e; }
    .rec-pill.danger { background: #fee2e2; color: #b91c1c; }
    .rec-pill.ok { background: #d1fae5; color: #065f46; }
    @media print {
      body { background: white; }
      .rec-toolbar { display: none !important; }
      .rec-page { width: auto; min-height: auto; margin: 0; box-shadow: none; padding: 0; }
      .rec-watermark { color: rgba(15, 23, 42, 0.08); }
    }
  </style>
</head>
<body>
  ${options.hideToolbar ? '' : `<div class="rec-toolbar"><button class="rec-btn-primary" onclick="window.print()">Print / Save PDF</button><button class="rec-btn-secondary" onclick="window.close()">Close</button></div>`}
  <main class="rec-page">
    ${watermark}
    ${qr}
    ${buildReceptionHeader(ctx)}
    ${copyIndicator}
    ${body}
    ${buildReceptionFooter({ signatures: options.signatures, hideSignatures: options.hideSignatures })}
  </main>
</body>
</html>`;
}

// ── Open print window (Blob URL approach — no document.write) ───────────

/**
 * Open a new window with the given HTML and trigger the print dialog.
 * Returns the opened window (or null if popup blocked).
 *
 * Implementation: writes HTML to a Blob and opens via blob: URL. This avoids
 * the security and performance pitfalls of `document.write()`. The browser
 * renders the HTML natively; the print dialog still works.
 *
 * If `onAfterPrint` is provided, it fires after the print window opens.
 * Use this for fire-and-forget audit logging.
 */
export function openPrintWindow(
  html: string,
  options: { autoPrint?: boolean; onAfterPrint?: () => void | Promise<void> } = {},
): Window | null {
  const autoPrint = options.autoPrint ?? true;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url, '_blank', 'width=1100,height=900');
  if (!printWindow) {
    URL.revokeObjectURL(url);
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined') {
      window.alert('Please allow popups to print.');
    }
    return null;
  }
  // Revoke the blob URL after the window has had time to load it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  if (autoPrint) {
    setTimeout(() => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch {
        // user closed the window before print fired
      }
      if (options.onAfterPrint) {
        setTimeout(() => {
          void options.onAfterPrint?.();
        }, 200);
      }
    }, 600);
  } else if (options.onAfterPrint) {
    setTimeout(() => {
      void options.onAfterPrint?.();
    }, 600);
  }
  return printWindow;
}

/**
 * Convenience: build + open in one call.
 */
export function printReceptionDocument(
  ctx: ReceptionContext,
  body: string,
  options: WrapOptions = {},
): Window | null {
  const html = wrapReceptionPage(ctx, body, options);
  return openPrintWindow(html, {
    autoPrint: options.autoPrint ?? true,
    onAfterPrint: options.onAfterPrint,
  });
}

// ── Export public API for direct use by singleDocuments.ts ───────────────

export { escapeHtml, num, money, formatDateTime };
