import { describe, expect, it } from 'vitest';

describe('BillPrint', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./BillPrint');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  }, 30_000);

  it('renders the visit serial as an appointment serial number only', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toMatch(/visitSerial/);
    expect(text).toContain('visitSerial={visitSerial}');
    expect(text).not.toContain('data-testid="visit-serial"');
    expect(text).toContain("token: l('Serial No.'");
  });

  it('uses the invoice number for the compact payment identifier', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toMatch(/largeSerialLabel/);
    expect(text).toMatch(/largeSerialLabel = bill\??\.invoice_no/);
    expect(text).toMatch(/data-testid="invoice-serial-large"/);
  });

  it('caps displayed outstanding at the deposit-adjusted computed balance', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toContain('const depositAdjusted = Math.max(getBillDepositAdjustedAmount(bill), fetchedDepositAdjusted);');
    expect(text).toContain('const billForAmounts = { ...bill, deposit_adjusted: depositAdjusted };');
    expect(text).toContain('const outstanding = getBillOutstandingAmount(billForAmounts);');
  });

  it('renders "Referred by" for hospital referral type', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toMatch(/data-testid="referred-by"/);
    expect(text).toMatch(/referredBy\.type === 'hospital'/);
    expect(text).toMatch(/referredBy\.hospitalName/);
  });

  it('renders "Referred by: Dr. {name}" for doctor referral type', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toMatch(/referredBy\.type === 'doctor'/);
    expect(text).toMatch(/Dr\.\s*\{referredBy\.doctorName\}/);
  });

  it('always supplies a formatted referrer to diagnostic invoices including self', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');

    expect(text).toContain('formatInvoiceReferrer');
    expect(text).toContain('referredBy={referredByLabel}');
    expect(text).toContain("self: l('Self'");
    expect(text).toContain("other: l('Other'");
  });

  it('does not render referred by section for self type', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toMatch(/referredBy\.type !== 'self'/);
  });

  it('includes visitSerial and referredBy in BillResponse interface', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toMatch(/visitSerial:\s*number\s*\|\s*null/);
    expect(text).toMatch(/referredBy:\s*ReferredBy/);
  });

  it('surfaces internal reagent inventory alerts on the bill print page', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toContain('reagent_inventory_alerts?: ReagentInventoryAlert[]');
    expect(text).toContain('const reagentInventoryAlerts = billData?.reagent_inventory_alerts ?? [];');
    expect(text).toContain('data-testid="reagent-inventory-alerts"');
    expect(text).toContain('Internal lab inventory alert');
  });

  it('supports a lab/test-only service copy without presenting full-invoice payment totals', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');

    expect(text).toContain("scope = 'full'");
    expect(text).toContain('filterLabTestInvoiceItems(allItems)');
    expect(text).toContain("const isLabTestOnly = scope === 'lab'");
    expect(text).toContain('getReceptionLabTestBillPrintPath(basePath, billId)');
    expect(text).toContain("l('Lab/Test Only', 'শুধু ল্যাব/টেস্ট')");
    expect(text).toContain('data-testid="lab-test-only-summary"');
    expect(text).toContain('isLabTestOnly ? (');
    expect(text).toContain('Payment status remains governed by the full invoice');
  });

  it('registers admin and reception lab/test-only print routes', async () => {
    const source = await import('../App?raw');
    const text = String(source.default ?? '');

    expect(text).toContain("lazy(() => import('./pages/LabTestBillPrint'))");
    expect(text).toContain('path="billing/:billId/lab-print"');
    expect(text).toContain('path="reception/billing/:billId/lab-print"');
  });

  it('composes focused category invoice components', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toContain('InvoiceBrandHeader');
    expect(text).toContain('ConsultationInvoiceBody');
    expect(text).toContain('DiagnosticInvoiceBody');
    expect(text).toContain('DischargeInvoiceBody');
    expect(text).toContain('InvoiceTotalsPayment');
    expect(text).toContain('InvoiceFooter');
    expect(text).toContain('getInvoiceLayout(items)');
  });

  it('reads the complete hospital profile used by the invoice footer', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toMatch(/email\?:\s*string/);
    expect(text).toMatch(/website\?:\s*string/);
    expect(text).toMatch(/registration_number\?:\s*string/);
    expect(text).toMatch(/bin_tin\?:\s*string/);
    expect(text).toMatch(/footer_text\?:\s*string/);
  });

  it('offers remembered A5 and A4 portrait paper sizes', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toContain("localStorage.getItem('billPrintPaperSize')");
    expect(text).toContain("localStorage.setItem('billPrintPaperSize'");
    expect(text).toContain('<option value="a5">A5</option>');
    expect(text).toContain('<option value="a4">A4</option>');
    expect(text).toContain('getInvoicePaperConfig(paperSize)');
    expect(text).toContain('@page { size: ${pageRule}; margin: ${margin}; }');
  });

  it('prints invoice issue date with creation time', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toContain('issueDate={formatLocalizedDateTime(bill.created_at)}');
    expect(text).toContain('formatLocalizedDateTime(bill.created_at)');
  });

  it('formats appointment times with an AM or PM suffix', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toMatch(/formatAppointmentTime[\s\S]*hour12:\s*true/);
  });

  it('formats the invoice issue date with AM or PM in the header', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toMatch(/function formatDateTime[\s\S]*hour12:\s*true/);
    expect(text).toContain('issueDate={formatLocalizedDateTime(bill.created_at)}');
  });

  it('keeps the invoice header visible and allows financial content to paginate naturally in print', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toContain('.invoice-brand-header { display: flex !important; }');
    expect(text).toContain('.invoice-financials { break-inside: auto !important; page-break-inside: auto !important; }');
    expect(text).toContain('html, body, .invoice-sheet');
    expect(text).toContain('@media screen and (max-width: 720px)');
  });

  it('keeps full-height invoice preview on screen and anchors print footer without forcing a second page', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toContain('.invoice-sheet {\n      display: flex; flex-direction: column;');
    expect(text).toContain('.invoice-paper-a5 { min-height: 210mm; }');
    expect(text).toContain('.invoice-paper-a4 { min-height: 297mm; }');
    expect(text).toContain('.invoice-footer { margin-top: auto;');
    expect(text).toContain('.invoice-paper-a5 { min-height: 210mm !important; }');
    expect(text).toContain('.invoice-paper-a4 { min-height: 297mm !important; }');
    expect(text).toContain('height: auto !important; overflow: visible !important;');
    expect(text).not.toContain('style={{ minHeight');
  });

  it('spreads a two-item footer across the left and right edges', async () => {
    const printSource = await import('./BillPrint?raw');
    const footerSource = await import('../components/invoice/InvoiceFooter?raw');
    const printText = String(printSource.default ?? '');
    const footerText = String(footerSource.default ?? '');

    expect(footerText).toContain("contactCount === 2 ? ' invoice-footer-pair' : ''");
    expect(printText).toContain('.invoice-footer-grid.invoice-footer-pair { grid-template-columns: minmax(0, auto) minmax(0, auto); justify-content: space-between; }');
    expect(printText).toContain('.invoice-footer-pair > div:last-child { justify-self: end; }');
  });

  it('emphasizes subtotal, tones down total amount, and enlarges footer contact text', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');

    expect(text).toContain('.invoice-totals .invoice-subtotal-row { font-weight: 800; }');
    expect(text).toContain('font-size: 11px; font-weight: 900;');
    expect(text).toContain('.invoice-footer-grid span { color: var(--invoice-teal-dark); font-size: 8px;');
    expect(text).toContain('.invoice-footer-grid strong { overflow-wrap: anywhere; color: #334155; font-size: 9.5px;');
  });

  it('uses larger consultation detail, header metadata, and payment text', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toContain('.invoice-layout-consultation .invoice-header-meta > div { font-size: 11px; }');
    expect(text).toContain('.invoice-layout-consultation .invoice-summary-column p { font-size: 11px; }');
    expect(text).toContain('.invoice-layout-consultation .invoice-detail-row { font-size: 11px; }');
    expect(text).toContain('.invoice-layout-consultation .invoice-payment-compact { font-size: 10px; }');
    expect(text).toContain('.invoice-layout-consultation .invoice-payment-compact-status strong { font-size: 16px; }');
  });

  it('marks follow-up consultation invoices and uses shared doctor-name normalization', async () => {
    const printSource = await import('./BillPrint?raw');
    const bodySource = await import('../components/invoice/ConsultationInvoiceBody?raw');
    const typeSource = await import('../components/invoice/types?raw');
    const printText = String(printSource.default ?? '');
    const bodyText = String(bodySource.default ?? '');
    const typeText = String(typeSource.default ?? '');

    expect(typeText).toContain('appointmentType?: string | null');
    expect(printText).toContain("followUp: l('Follow-up', 'ফলো-আপ')");
    expect(bodyText).toContain('formatDoctorDisplayName');
    expect(bodyText).toContain("['old_patient', 'follow_up', 'followup']");
    expect(bodyText).toContain('labels.followUp');
    expect(bodyText).not.toContain("appointment.doctorName.replace(/^Dr");
  });

  it('highlights the appointment token as a bordered badge', async () => {
    const printSource = await import('./BillPrint?raw');
    const bodySource = await import('../components/invoice/ConsultationInvoiceBody?raw');
    const printText = String(printSource.default ?? '');
    const bodyText = String(bodySource.default ?? '');

    expect(bodyText).toContain("' invoice-token-row'");
    expect(bodyText).toContain('testId="appointment-token" highlight');
    expect(printText).toContain('.invoice-token-row strong {');
    expect(printText).toContain('border: 1px solid var(--invoice-teal);');
    expect(printText).toContain('font-size: 15px;');
  });

  it('labels the consultation serial as a token number', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toContain("token: l('Serial No.'");
  });

  it('uses a branded thank-you footer instead of a computer-generated note', async () => {
    const printSource = await import('./BillPrint?raw');
    const footerSource = await import('../components/invoice/InvoiceFooter?raw');
    const printText = String(printSource.default ?? '');
    const footerText = String(footerSource.default ?? '');

    expect(printText).toContain("thankYou: l('Thank you for choosing'");
    expect(footerText).toContain('{labels.thankYou} {hospital.name}');
    expect(footerText).toContain('hospital.tagline &&');
    expect(footerText).not.toContain('computerGeneratedNote');
    expect(printText).not.toContain('This is a computer-generated invoice.');
  });

  it('prints through a hidden isolated iframe instead of the dashboard document or a visible popup', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toContain("document.createElement('iframe')");
    expect(text).toContain("printFrame.setAttribute('title', 'Invoice print frame')");
    expect(text).toContain("printDocument.write(`<!doctype html>");
    expect(text).toContain('${invoice.outerHTML}');
    expect(text).toContain('printWindow.print()');
    expect(text).toContain("printWindow.addEventListener('afterprint', cleanup, { once: true })");
    expect(text).toContain('printFrame.remove()');
    expect(text).toContain('window.print()');
    expect(text).not.toContain("window.open('', '_blank', 'width=900,height=1200')");
    expect(text).toContain('invoice-print-shell mx-auto space-y-4');
    expect(text).toContain('.invoice-print-shell > .invoice-sheet { margin-top: 0 !important; }');
    expect(text).toContain('.invoice-paper-a5 { min-height: 210mm !important; }');
    expect(text).toContain('.invoice-paper-a4 { min-height: 297mm !important; }');
    expect(text).not.toContain('style={{ minHeight');
    const printStyles = text.slice(text.indexOf('@media print'), text.indexOf('@media screen'));
    expect(printStyles).toContain('.invoice-sheet {');
    expect(printStyles).toContain('min-height: 0; height: auto !important; overflow: visible !important;');
    expect(printStyles).toContain('min-height: 210mm !important;');
    expect(printStyles).toContain('min-height: 297mm !important;');
    expect(printStyles).not.toContain('calc(210mm - 1px)');
    expect(printStyles).not.toContain('calc(297mm - 1px)');
    expect(printStyles).not.toContain('margin-top: 8px !important');
    expect(text).toContain('onClick={printInvoice}');
  });

  it('uses a grouped print toolbar with clear controls and actions', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toContain('no-print rounded-2xl border border-slate-200');
    expect(text).toContain("l('Print preview', 'প্রিন্ট প্রিভিউ')");
    expect(text).toContain("l('Paper', 'কাগজ')");
    expect(text).toContain("l('Language', 'ভাষা')");
    expect(text).toContain('btn-primary h-10 justify-center px-4 shadow-sm');
    expect(text).toContain("Use Print for paper copy. Use Save as PDF from the browser print dialog for digital copy.");
  });

  it('uses specialized layout classes without sample-only QR or delivery fields', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');
    expect(text).toContain('invoice-layout-${invoiceLayout}');
    expect(text).toContain("invoiceLayout === 'consultation'");
    expect(text).toContain("invoiceLayout === 'diagnostic'");
    expect(text).toContain("invoiceLayout === 'discharge'");
    expect(text).not.toContain('QRCode');
    expect(text).not.toContain('Collection Date');
    expect(text).not.toContain('Report Delivery');
  });

  it('keeps the diagnostic metadata in the previous boxed layout and reduces the hospital title size', async () => {
    const printSource = await import('./BillPrint?raw');
    const bodySource = await import('../components/invoice/DiagnosticInvoiceBody?raw');
    const printText = String(printSource.default ?? '');
    const bodyText = String(bodySource.default ?? '');

    expect(bodyText).not.toContain('diagnostic-meta-inline');
    expect(bodyText).toContain('diagnostic-meta-count-${metaItems.length}');
    expect(bodyText).toContain("key: 'patient-name'");
    expect(bodyText).toContain("key: 'patient-id'");
    expect(bodyText).toContain('const patientNameValue = patientMobile ? (');
    expect(bodyText).toContain('diagnostic-patient-value');
    expect(bodyText).toContain("<span>{patient.name || '-'}</span>");
    expect(bodyText).toContain('<small>{patientMobile}</small>');
    expect(bodyText).toContain('value: patientNameValue,');
    expect(bodyText).toContain("value: patient.code || '-'");
    expect(bodyText).toContain("const safeReferredBy = referredBy?.trim() || labels.self;");
    expect(bodyText).toContain("key: 'referred-by'");
    expect(bodyText).not.toContain('patientIdentity');
    expect(bodyText).not.toContain('issueDate');
    expect(printText).not.toContain("issueDate: l('Date'");
    expect(printText).toContain('.invoice-brand-identity h1 { margin: 0; font-size: 15px;');
    expect(printText).toContain('.invoice-title { margin: 0; font-size: 18px;');
    expect(printText).toContain("self: l('Self'");
    expect(printText).toContain('.diagnostic-meta-count-3 { grid-template-columns: minmax(0, 1.65fr) minmax(0, 0.9fr) minmax(0, 1.6fr); }');
    expect(printText).toContain('.diagnostic-meta-count-4 { grid-template-columns: minmax(0, 1.65fr) minmax(0, 0.92fr) minmax(0, 0.96fr) minmax(0, 1.47fr); }');
    expect(printText).toContain('.diagnostic-meta-count-5 { grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 2fr) minmax(0, 1fr); }');
    expect(printText).not.toContain('.invoice-layout-diagnostic .diagnostic-meta > div:last-child { display: none; }');
    expect(printText).toContain('display: grid; grid-template-columns: 27px 1fr; grid-template-rows: auto auto;');
    expect(printText).toContain('column-gap: 7px; padding: 3px 12px 8px;');
    expect(printText).toContain('overflow-wrap: break-word; word-break: normal; font-size: 11px; line-height: 1.18;');
    expect(printText).toContain('.diagnostic-meta > div:nth-child(1) strong,');
    expect(printText).toContain('.diagnostic-meta > div:nth-child(3) strong { font-size: 13px; line-height: 1.15; }');
  });


  it('selects the discharge invoice layout from admission data', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');

    expect(text).toContain('admission?: InvoiceAdmissionInfo | null;');
    expect(text).toContain("const isDischargeBill = Boolean(admission?.discharge_date || admission?.status === 'discharged');");
    expect(text).toContain("const invoiceLayout = isLabTestOnly");
    expect(text).toContain("? 'discharge'");
    expect(text).toContain(": getInvoiceLayout(items)");
    expect(text).toContain("? l('DISCHARGE BILL'");
    expect(text).toContain("l('DISCHARGE + INVOICE'");
  });

  it('anchors discharge payment and totals together directly above the footer', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');

    expect(text).toContain('.invoice-layout-discharge .invoice-financials {');
    expect(text).toContain('grid-template-areas: "payment totals";');
    expect(text).toContain('.invoice-layout-discharge .invoice-payment-compact { grid-area: payment;');
    expect(text).toContain('.invoice-layout-discharge .invoice-totals { grid-area: totals;');
    expect(text).toContain('.invoice-layout-discharge .invoice-footer { margin-top: 0; }');
  });

  it('uses a compact A5 discharge print layout so the footer does not spill onto a blank second page', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');

    expect(text).toContain('.invoice-layout-discharge.invoice-paper-a5 .invoice-brand-header { padding: 10px 20px 8px;');
    expect(text).toContain('.invoice-layout-discharge.invoice-paper-a5 .invoice-body { padding: 10px 20px 0; }');
    expect(text).toContain('.invoice-layout-discharge.invoice-paper-a5 .discharge-info-tile {');
    expect(text).toContain('min-height: 42px; padding: 6px 7px;');
    expect(text).toContain('.invoice-layout-discharge.invoice-paper-a5 .invoice-items-table td { padding: 5px 7px;');
    expect(text).toContain('gap: 10px; margin-top: auto; padding: 7px 20px 0;');
    expect(text).toContain('.invoice-layout-discharge.invoice-paper-a5 .invoice-payment-compact { min-height: 46px;');
    expect(text).toContain('.invoice-layout-discharge.invoice-paper-a5 .invoice-footer { padding: 6px 20px 8px;');
    expect(text).toContain('.invoice-paper-a5 { min-height: 210mm !important; }');
    expect(text).not.toContain('.invoice-layout-discharge.invoice-paper-a5 {\n        min-height: 0 !important;\n        height: auto !important;');
    expect(text).toContain('page-break-inside: auto !important;');
  });

  it('anchors diagnostic payment and totals together directly above the footer', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');

    expect(text).toContain('.invoice-layout-diagnostic .invoice-financials {');
    expect(text).toContain('grid-template-areas: "payment totals";');
    expect(text).toContain('margin-top: auto;');
    expect(text).toContain('.invoice-layout-diagnostic .invoice-payment-compact { grid-area: payment;');
    expect(text).toContain('.invoice-layout-diagnostic .invoice-totals { grid-area: totals;');
    expect(text).toContain('.invoice-layout-diagnostic .invoice-footer { margin-top: 0; }');
  });

  it('anchors generic admission payment status beside totals above the footer', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');

    expect(text).toContain('.invoice-layout-generic + .invoice-financials {');
    expect(text).toContain('grid-template-areas: "payment totals";');
    expect(text).toContain('margin-top: auto;');
    expect(text).toContain('.invoice-layout-generic + .invoice-financials .invoice-payment-compact { grid-area: payment;');
    expect(text).toContain('.invoice-layout-generic + .invoice-financials .invoice-totals { grid-area: totals;');
  });

  it('builds and passes payment history only for discharge invoices', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');

    expect(text).toContain("import { buildInvoicePaymentLedger, formatInvoiceLedgerDateTime } from '../lib/print/paymentLedger';");
    expect(text).toContain('const isFullySettled = outstanding <= 0');
    expect(text).toContain("const dischargePaymentLedger = invoiceLayout === 'discharge'");
    expect(text).toContain('buildInvoicePaymentLedger({');
    expect(text).toContain('payments,');
    expect(text).toContain('depositAllocations,');
    expect(text).toContain('isFullySettled,');
    expect(text).toContain('paymentLedger={localizedDischargePaymentLedger}');
    expect(text).toContain('formatLedgerDateTime={formatLocalizedLedgerDateTime}');
  });

  it('includes compact discharge ledger styles without changing the two-column totals layout', async () => {
    const source = await import('./BillPrint?raw');
    const text = String(source.default ?? '');

    expect(text).toContain('.invoice-payment-ledger {');
    expect(text).toContain('.invoice-payment-ledger-header {');
    expect(text).toContain('.invoice-payment-ledger-row {');
    expect(text).not.toContain('.invoice-payment-ledger-settlement {');
    expect(text).toContain('.invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger-row {');
    expect(text).toContain('.invoice-payment-compact.has-ledger { break-inside: auto; page-break-inside: auto; }');
    expect(text).toContain('.invoice-payment-ledger-row { break-inside: avoid; page-break-inside: avoid; }');
    expect(text).toContain('grid-template-areas: "payment totals";');
    expect(text).not.toContain('invoice-payment-ledger { max-height:');
    expect(text).not.toContain('invoice-payment-ledger { overflow: hidden;');
  });
});
