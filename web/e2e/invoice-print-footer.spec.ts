import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const billPrintSource = readFileSync(resolve(__dirname, "../src/pages/BillPrint.tsx"), "utf8");

async function countPdfPages(pdf: Buffer) {
  const document = await getDocument({ data: new Uint8Array(pdf), disableWorker: true }).promise;
  return document.numPages;
}

test("invoice print uses an isolated hidden iframe instead of the dashboard document", () => {
  expect(billPrintSource).toContain("document.createElement('iframe')");
  expect(billPrintSource).toContain("printDocument.write(`<!doctype html>");
  expect(billPrintSource).toContain("<main>${invoice.outerHTML}</main>");
  expect(billPrintSource).toContain("printWindow.print()");
  expect(billPrintSource).toContain("printWindow.addEventListener('afterprint', cleanup, { once: true })");
  expect(billPrintSource).not.toContain("window.open('', '_blank', 'width=900,height=1200')");
});

test("A5 appointment invoice PDF stays one page with footer at the bottom", async ({ page }) => {
  await page.emulateMedia({ media: "print" });
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          @page { size: A5 portrait; margin: 0; }
          :root { --invoice-navy: #10234a; --invoice-teal: #078d87; --invoice-teal-dark: #08736f; --invoice-teal-soft: #e9f7f6; --invoice-line: #cbd9df; --invoice-muted: #64748b; }
          html, body { margin: 0; padding: 0; background: white; }
          body { color: var(--invoice-navy); font-family: Arial, sans-serif; }
          main { width: 100%; margin: 0; padding: 0; overflow: visible; }
          .invoice-sheet { display: flex; flex-direction: column; box-sizing: border-box; width: 148mm; min-height: 210mm; background: white; color: var(--invoice-navy); }
          .invoice-paper-a5 { min-height: 210mm; }
          .invoice-brand-header { display: flex; justify-content: space-between; gap: 18px; padding: 16px 28px 13px; border-bottom: 2px solid var(--invoice-teal); }
          .invoice-brand-logo { width: 54px; height: 54px; border-radius: 50%; border: 1px solid #bde6e3; flex: none; }
          .invoice-brand-identity { display: flex; align-items: center; gap: 14px; min-width: 0; }
          .invoice-brand-identity h1 { margin: 0; font-size: 15px; line-height: 1.08; font-weight: 800; }
          .invoice-brand-tagline { margin: 5px 0 0; color: var(--invoice-teal-dark); font-size: 10px; font-weight: 600; }
          .invoice-brand-contact { margin: 4px 0 0; color: var(--invoice-muted); font-size: 10px; }
          .invoice-title { margin: 0; font-size: 18px; letter-spacing: .04em; line-height: 1; font-weight: 900; }
          .invoice-number-pill { display: inline-block; margin-top: 9px; padding: 6px 18px; border-radius: 999px; background: var(--invoice-teal); color: white; font-size: 12px; line-height: 1; font-weight: 800; }
          .invoice-header-meta { display: grid; gap: 4px; margin-top: 8px; text-align: left; }
          .invoice-header-meta > div { display: grid; grid-template-columns: 98px 1fr; align-items: center; gap: 6px; font-size: 11px; }
          .invoice-header-meta span { color: var(--invoice-muted); }
          .invoice-type-ribbon { padding: 7px 28px; background: #edfafa; color: var(--invoice-teal-dark); font-size: 11px; font-weight: 800; text-align: center; text-transform: uppercase; letter-spacing: .14em; }
          .invoice-body { padding: 18px 28px 0; }
          .consultation-summary { display: grid; grid-template-columns: 1fr 1.18fr; gap: 0; margin-bottom: 18px; border-bottom: 1px solid var(--invoice-line); }
          .invoice-summary-column { min-width: 0; padding: 4px 22px 18px 4px; }
          .invoice-summary-column + .invoice-summary-column { padding-left: 26px; border-left: 1px solid var(--invoice-line); }
          .invoice-section-title { margin-bottom: 12px; color: var(--invoice-teal-dark); font-size: 12px; font-weight: 800; text-transform: uppercase; }
          .invoice-summary-column h3 { margin: 0 0 10px 30px; font-size: 15px; }
          .invoice-summary-column p { margin: 6px 0; color: #334155; font-size: 11px; line-height: 1.45; }
          .invoice-detail-row { display: grid; grid-template-columns: 43% 57%; gap: 8px; margin: 5px 0; font-size: 11px; line-height: 1.35; }
          .invoice-token-row strong { width: fit-content; min-width: 38px; padding: 4px 13px; border: 1px solid var(--invoice-teal); border-radius: 999px; background: var(--invoice-teal-soft); color: var(--invoice-teal-dark); font-size: 15px; line-height: 1; text-align: center; }
          .invoice-items-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 11px; }
          .invoice-items-table th { padding: 9px 10px; background: var(--invoice-teal); color: white; font-size: 10px; text-align: left; text-transform: uppercase; }
          .invoice-items-table td { padding: 9px 10px; border-bottom: 1px solid #dbe4e8; color: #263755; vertical-align: top; }
          .invoice-items-table td:last-child, .invoice-items-table th:last-child { text-align: right; }
          .invoice-financials { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 52%); gap: 16px; padding: 8px 28px 0; }
          .invoice-payment-compact { min-height: 48px; padding: 10px 14px; border: 1px solid var(--invoice-teal); border-radius: 7px; background: var(--invoice-teal-soft); font-size: 10px; }
          .invoice-payment-compact-status strong { color: var(--invoice-teal-dark); font-size: 16px; }
          .invoice-totals { width: 100%; margin: 0; border: 1px solid var(--invoice-line); border-radius: 0 0 7px 7px; overflow: hidden; }
          .invoice-totals > div { display: flex; justify-content: space-between; gap: 20px; padding: 5px 12px; font-size: 10px; }
          .invoice-grand-total { padding-top: 8px !important; padding-bottom: 8px !important; background: var(--invoice-teal-soft); color: var(--invoice-teal-dark); font-size: 13px !important; font-weight: 900; }
          .invoice-footer { margin-top: auto; padding: 11px 28px 14px; border-top: 1px solid var(--invoice-line); }
          .invoice-footer-grid { display: grid; grid-template-columns: minmax(0, auto) minmax(0, auto); justify-content: space-between; gap: 12px; }
          .invoice-footer-grid > div { display: grid; grid-template-columns: 20px 1fr; column-gap: 7px; min-width: 0; }
          .invoice-footer-grid span { color: var(--invoice-teal-dark); font-size: 8px; font-weight: 800; text-transform: uppercase; }
          .invoice-footer-grid strong { color: #334155; font-size: 9.5px; line-height: 1.3; }
          .invoice-thank-you { display: flex; flex-direction: column; align-items: center; gap: 2px; margin: 11px -28px -14px; padding: 8px 28px; background: var(--invoice-teal); color: white; text-align: center; }
          .invoice-thank-you strong { font-size: 11px; line-height: 1.25; }
          .invoice-thank-you span { font-size: 8px; line-height: 1.2; opacity: .92; }
          @media print {
            html, body, .invoice-sheet { background: white !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            main { margin: 0 !important; padding: 0 !important; width: 100% !important; max-width: 100% !important; overflow: visible !important; }
            .invoice-sheet { width: 100% !important; max-width: none !important; min-height: 0; height: auto !important; overflow: visible !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
            .invoice-paper-a5 { min-height: 210mm !important; }
          }
        </style>
      </head>
      <body>
        <main>
          <article class="invoice-sheet invoice-paper-a5 invoice-layout-consultation" data-testid="sheet">
            <header class="invoice-brand-header"><div class="invoice-brand-identity"><div class="invoice-brand-logo"></div><div><h1>Patient Care Hospital &<br />Diagnostic Centre</h1><p class="invoice-brand-tagline">সুস্থতাই আমাদের অঙ্গীকার</p><p class="invoice-brand-contact">College road Barguna · +8801331434347</p></div></div><div><p class="invoice-title">INVOICE</p><span class="invoice-number-pill">INV-A-2026-000220</span><div class="invoice-header-meta"><div><span>Issue Date</span><strong>26 Jun 2026, 08:28 PM</strong></div><div><span>Appointment ID</span><strong>APT-000244</strong></div></div></div></header>
            <div class="invoice-type-ribbon">APPOINTMENT INVOICE</div>
            <section class="invoice-body"><div class="consultation-summary"><div class="invoice-summary-column"><div class="invoice-section-title">BILL TO</div><h3>Example Patient</h3><p>01000000000</p><p>Patient ID: P-000287</p><p>Age / Gender: 25 / male</p></div><div class="invoice-summary-column"><div class="invoice-section-title">APPOINTMENT DETAILS</div><div class="invoice-detail-row"><span>Doctor</span><strong>Dr. Example Four</strong></div><div class="invoice-detail-row"><span>Specialty</span><strong>Medicine and Diabetes</strong></div><div class="invoice-detail-row"><span>Appointment Date</span><strong>26 Jun 2026</strong></div><div class="invoice-detail-row invoice-token-row"><span>Serial No.</span><strong>2</strong></div></div></div><table class="invoice-items-table"><thead><tr><th>SL.</th><th>Description</th><th>Qty</th><th>Amount (BDT)</th></tr></thead><tbody><tr><td>1</td><td><strong>Consultation - Dr. Example Four</strong><br /><small>Dr. Example Four · Medicine and Diabetes</small></td><td>1</td><td>৳300.00</td></tr></tbody></table></section>
            <section class="invoice-financials"><div class="invoice-payment-compact"><div class="invoice-payment-compact-status"><strong>PAID</strong></div><p>Payment Method&nbsp; <strong>Cash</strong></p><p><strong>INV-A-2026-000220</strong></p></div><div class="invoice-totals"><div><span>Subtotal</span><strong>৳300.00</strong></div><div class="invoice-grand-total"><span>Total Amount</span><strong>৳300.00</strong></div><div><span>Paid</span><strong>৳300.00</strong></div></div></section>
            <footer class="invoice-footer" data-testid="footer"><div class="invoice-footer-grid"><div><span>Hotline</span><strong>+8801331434347</strong></div><div><span>Address</span><strong>College road Barguna</strong></div></div><div class="invoice-thank-you"><strong>Thank you for choosing Patient Care Hospital & Diagnostic Centre</strong><span>সুস্থতাই আমাদের অঙ্গীকার</span></div></footer>
          </article>
        </main>
      </body>
    </html>
  `);

  const metrics = await page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="sheet"]')!.getBoundingClientRect();
    const footer = document.querySelector('[data-testid="footer"]')!.getBoundingClientRect();
    return { sheetBottom: sheet.bottom, footerBottom: footer.bottom };
  });
  expect(metrics.footerBottom).toBeGreaterThanOrEqual(metrics.sheetBottom - 4);
  expect(metrics.footerBottom).toBeLessThanOrEqual(metrics.sheetBottom + 2);

  const pdf = await page.pdf({ format: "A5", printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
  await expect(countPdfPages(pdf)).resolves.toBe(1);
});
