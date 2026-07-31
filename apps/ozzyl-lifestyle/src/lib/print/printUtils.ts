/**
 * HMS Print Utilities
 * Uses the browser's native print dialog with print-specific CSS.
 * No external dependencies needed.
 */

export interface HospitalInfo {
  name: string;
  address: string;
  phone: string;
  logo?: string;
}

export interface PrintOptions {
  title?: string;
  hospital?: HospitalInfo;
}

/**
 * Open a new window with HTML content and trigger the print dialog.
 */
export function printHtml(html: string, title = 'Print'): void {
  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) {
    alert('Please allow popups to print.');
    return;
  }

  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <style>
    /* ── Reset ──────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Arial', sans-serif; font-size: 12px; color: #222; background: #fff; padding: 20px; }
    /* ── Layout helpers ─────────────────── */
    .flex { display: flex; }
    .flex-between { display: flex; justify-content: space-between; align-items: flex-start; }
    .text-center { text-align: center; }
    .text-right  { text-align: right; }
    /* ── Typography ─────────────────────── */
    h1 { font-size: 20px; font-weight: 700; }
    h2 { font-size: 15px; font-weight: 600; }
    h3 { font-size: 13px; font-weight: 600; }
    .text-sm  { font-size: 11px; }
    .text-xs  { font-size: 10px; color: #666; }
    /* ── Divider ────────────────────────── */
    hr  { border: none; border-top: 1px solid #ccc; margin: 8px 0; }
    .double-line { border-top: 3px double #333; margin: 8px 0; }
    /* ── Table ──────────────────────────── */
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th    { background: #f0f0f0; padding: 6px 8px; text-align: left; font-weight: 600; font-size: 11px; border: 1px solid #ddd; }
    td    { padding: 5px 8px; border: 1px solid #ddd; font-size: 11px; vertical-align: top; }
    .amount { text-align: right; font-family: monospace; }
    /* ── Totals ─────────────────────────── */
    .totals-block { margin-top: 12px; display: flex; justify-content: flex-end; }
    .totals-table { width: 260px; }
    .totals-table td:first-child { font-weight: 600; }
    .grand-total td { font-weight: 700; font-size: 13px; background: #f9f9f9; }
    /* ── Badge ──────────────────────────── */
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600; }
    .badge-paid   { background: #d1fae5; color: #065f46; }
    .badge-unpaid { background: #fee2e2; color: #991b1b; }
    /* ── Info grid ──────────────────────── */
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; margin-top: 8px; }
    .info-row  { display: flex; gap: 6px; }
    .info-label { font-weight: 600; min-width: 110px; }
    /* ── Print controls ─────────────────── */
    @media screen {
      .no-print { display: flex; justify-content: center; gap: 12px; margin-bottom: 16px; }
      .btn { padding: 8px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; }
      .btn-primary { background: #2563eb; color: white; }
      .btn-secondary { background: #6b7280; color: white; }
    }
    @media print {
      .no-print { display: none !important; }
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button class="btn btn-primary" onclick="window.print()">🖨 Print</button>
    <button class="btn btn-secondary" onclick="window.close()">✕ Close</button>
  </div>
  ${html}
</body>
</html>`);

  win.document.close();
  // Brief delay so fonts and images settle before auto-printing
  setTimeout(() => win.print(), 400);
}

/** Format integer paisa → "৳ X,XXX.XX" */
export function formatMoney(paisa: number): string {
  const taka = paisa / 100;
  return `৳ ${taka.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Format a YYYY-MM-DD string to "DD/MM/YYYY" */
export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/** Escape HTML special characters to prevent XSS */
export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
