import { describe, expect, it } from 'vitest';
import { formatInvoiceReferrer } from './invoiceReferrer';

const labels = {
  self: 'Self',
  doctor: 'Doctor',
  hospital: 'Hospital',
  other: 'Other',
};

describe('formatInvoiceReferrer', () => {
  it('formats self, doctor, and hospital referrers', () => {
    expect(formatInvoiceReferrer({ type: 'self' }, labels)).toBe('Self');
    expect(formatInvoiceReferrer({ type: 'doctor', doctorName: 'Dr. Sadia Islam' }, labels))
      .toBe('Dr. Sadia Islam');
    expect(formatInvoiceReferrer({ type: 'hospital', hospitalName: 'City Hospital' }, labels))
      .toBe('City Hospital');
  });

  it('supports named and unnamed custom referrer types', () => {
    expect(formatInvoiceReferrer({ type: 'agent', name: 'Rahim Agency' }, labels))
      .toBe('Rahim Agency');
    expect(formatInvoiceReferrer({ type: 'agent' }, labels)).toBe('Agent');
    expect(formatInvoiceReferrer({ type: 'other' }, labels)).toBe('Other');
  });
});
