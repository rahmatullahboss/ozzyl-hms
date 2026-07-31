import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getInvoiceSeriesConfig,
  resolveBillInvoiceSeries,
} from '../../src/lib/invoice-sequence';

describe('invoice sequence series', () => {
  const issuedAt = new Date('2026-06-19T06:00:00.000Z');

  it.each([
    ['appointment', 'invoice_appointment_2026', 'INV-A-2026'],
    ['diagnostic', 'invoice_diagnostic_2026', 'INV-D-2026'],
    ['ipd', 'invoice_ipd_2026', 'INV-I-2026'],
    ['pharmacy', 'invoice_pharmacy_2026', 'INV-PH-2026'],
    ['generic', 'invoice_generic_2026', 'INV-G-2026'],
  ] as const)('creates a separate yearly counter for %s invoices', (kind, counterType, prefix) => {
    expect(getInvoiceSeriesConfig(kind, issuedAt)).toEqual({ counterType, prefix });
  });

  it('maps pure consultation bills to the appointment invoice series', () => {
    expect(resolveBillInvoiceSeries({ doctorVisitBill: 500, testBill: 0 })).toBe('appointment');
  });

  it('maps pure test bills to the diagnostic invoice series', () => {
    expect(resolveBillInvoiceSeries({ testBill: 1200, doctorVisitBill: 0 })).toBe('diagnostic');
  });

  it('maps mixed or unclear bills to the generic invoice series', () => {
    expect(resolveBillInvoiceSeries({ doctorVisitBill: 500, testBill: 1200 })).toBe('generic');
    expect(resolveBillInvoiceSeries({})).toBe('generic');
  });

  it('wires appointment, diagnostic, and pharmacy routes to department invoice series helpers', () => {
    const routeFiles = [
      'src/routes/tenant/appointments.ts',
      'src/routes/tenant/lab.ts',
      'src/routes/tenant/radiology/orders.ts',
      'src/routes/tenant/pharmacy/invoices.ts',
      'src/lib/pharmacy-canonical.ts',
    ];

    for (const file of routeFiles) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toContain("'invoice', 'INV'");
      expect(text).toMatch(/getNextInvoiceNumber|getNextBillInvoiceNumber/);
    }
  });

});
