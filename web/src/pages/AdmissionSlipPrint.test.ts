import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pagePath = path.resolve(process.cwd(), 'src/pages/AdmissionSlipPrint.tsx');

describe('AdmissionSlipPrint', () => {
  it('provides an invoice-style dedicated admission slip preview', () => {
    expect(existsSync(pagePath)).toBe(true);
    if (!existsSync(pagePath)) return;

    const source = readFileSync(pagePath, 'utf8');

    expect(source).toContain('InvoiceBrandHeader');
    expect(source).toContain('InvoiceFooter');
    expect(source).toContain('getInvoicePaperConfig');
    expect(source).toContain('parseInvoicePaperSize');
    expect(source).toContain("localStorage.getItem('admissionSlipPaperSize')");
    expect(source).toContain("localStorage.getItem('admissionSlipLang')");
    expect(source).toContain('`/api/admissions/${admissionId}/slip`');
    expect(source).toContain("'/api/settings'");
    expect(source).toContain("document.createElement('iframe')");
    expect(source).toContain("l('Patient Information', 'রোগীর তথ্য')");
    expect(source).toContain("l('Admission Details', 'ভর্তির তথ্য')");
    expect(source).toContain("l('Guardian / Care-of Person', 'অভিভাবক / দায়িত্বপ্রাপ্ত ব্যক্তি')");
    expect(source).not.toContain("<Detail label={l('Patient Name', 'রোগীর নাম')}");
    expect(source).toContain('.invoice-paper-a5 .admission-details-grid');
    expect(source).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(source).toContain('.admission-slip-sheet.invoice-paper-a5');
    expect(source).toContain('height: 210mm !important;');
    expect(source).toContain('.invoice-paper-a5 .admission-slip-body { display: flex; flex: 1; flex-direction: column;');
    expect(source).toContain('.invoice-paper-a5 .admission-detail span { font-size: 9px;');
    expect(source).toContain('.invoice-paper-a5 .admission-detail strong { margin-top: 3px; font-size: 10.5px;');
    expect(source).toContain('.invoice-paper-a5 .admission-signatures { gap: 16px; margin-top: auto;');
    expect(source).toContain('slip.created_by_name');
    expect(source).toContain('export default function AdmissionSlipPrint');
  });
});
