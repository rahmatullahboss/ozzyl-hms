import { describe, expect, it } from 'vitest';

describe('invoice item amounts', () => {
  it.each([
    './ConsultationInvoiceBody?raw',
    './DiagnosticInvoiceBody?raw',
    './DischargeInvoiceBody?raw',
    '../../pages/BillPrint?raw',
  ])('shows refund-aware net line amounts in %s', async (modulePath) => {
    const source = await import(/* @vite-ignore */ modulePath);
    const text = String(source.default ?? '');

    expect(text).toContain('getInvoiceItemDisplayAmount');
    expect(text).toContain('invoice-refund-label');
  });
});
