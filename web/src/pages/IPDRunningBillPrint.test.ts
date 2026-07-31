import { describe, expect, it } from 'vitest';
import { buildRunningBillHtml } from '../lib/print';
import { buildPrintData, sanitizeRunningBillPreviewHtml } from './IPDRunningBillPrint';

describe('IPDRunningBillPrint', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./IPDRunningBillPrint');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('maps only deposit ledger entries and signs refunds and adjustments negatively', () => {
    const data = buildPrintData(
      {
        id: 7,
        admission_no: 'ADM-7',
        patient_id: 11,
        patient_name: 'Test Patient',
        admission_date: '2026-06-18',
      },
      {
        items: [],
        bed_charges: { segments: [], bed_total: 0 },
        summary: { grand_total: 0, deposit_balance: 700 },
        deposit_history: [
          { type: 'deposit', amount: 1000, receipt_no: 'DEP-1' },
          { type: 'refund', amount: 200, receipt_no: 'REF-1' },
          { type: 'adjustment', amount: 100, receipt_no: 'ADJ-1' },
        ],
      },
      null,
    );

    expect(data.payments).toEqual([
      expect.objectContaining({ type: 'deposit', amount: 1000, receipt_no: 'DEP-1' }),
      expect.objectContaining({ type: 'refund', amount: -200, receipt_no: 'REF-1' }),
      expect.objectContaining({ type: 'adjustment', amount: -100, receipt_no: 'ADJ-1' }),
    ]);
  });

  it('prints only RUNNING BILL in the header badge', () => {
    const data = buildPrintData(
      {
        id: 9,
        admission_no: 'ADM-9',
        patient_id: 19,
        patient_name: 'Sample Patient',
        admission_date: '2026-06-30',
      },
      {
        items: [{ item_name: 'Nursing Charge', item_category: 'service', unit_price: 500, quantity: 1, total_amount: 500 }],
        bed_charges: { segments: [], bed_total: 0 },
        summary: { grand_total: 500, deposit_balance: 200, net_payable: 300 },
        deposit_history: [],
      },
      null,
    );

    const html = buildRunningBillHtml(data, { paperSize: 'a5' });

    expect(html).toContain('<div class="badge"><b>RUNNING BILL</b></div>');
    expect(html).not.toContain('Not Final Invoice');
  });

  it('places deposit history and bill summary boxes directly above the footer', () => {
    const data = buildPrintData(
      {
        id: 10,
        admission_no: 'ADM-10',
        patient_id: 20,
        patient_name: 'Sample Patient',
        admission_date: '2026-06-30',
      },
      {
        items: [],
        bed_charges: { segments: [], bed_total: 0 },
        summary: { grand_total: 0, deposit_balance: 0, net_payable: 0 },
        deposit_history: [{ type: 'deposit', amount: 1000, receipt_no: 'DEP-10' }],
      },
      null,
    );

    const html = buildRunningBillHtml(data, { paperSize: 'a5' });
    const bottomIndex = html.indexOf('<div class="bottom"');
    const footerIndex = html.indexOf('<div class="foot"');

    expect(bottomIndex).toBeGreaterThan(-1);
    expect(footerIndex).toBeGreaterThan(bottomIndex);
    expect(html).toContain('.settlement{margin-top:auto');
    expect(html.slice(bottomIndex, footerIndex)).toContain('Deposit / Advance History');
    expect(html.slice(bottomIndex, footerIndex)).toContain('Bill Summary');
  });

  it('preserves generated print styles while removing executable markup', () => {
    const sanitized = sanitizeRunningBillPreviewHtml(`
      <style>.row{display:grid;gap:5px}</style>
      <div class="row" onclick="alert('xss')"><span>Patient ID</span><b>P-1</b></div>
      <script>alert('xss')</script>
    `);

    expect(sanitized).toContain('<style>.row{display:grid;gap:5px}</style>');
    expect(sanitized).not.toContain('onclick');
    expect(sanitized).not.toContain('<script');

    const host = document.createElement('div');
    host.innerHTML = sanitized;
    document.body.appendChild(host);
    expect(getComputedStyle(host.querySelector('.row') as Element).display).toBe('grid');
    host.remove();
  });

});
