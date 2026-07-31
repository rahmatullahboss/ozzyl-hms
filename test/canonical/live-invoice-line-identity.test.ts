import { describe, expect, it } from 'vitest';
import { buildLegacyLiveInvoiceSourceLineId } from '../../src/lib/canonical/live-invoice-line-identity';

describe('legacy live invoice line identity', () => {
  it('builds the same stable source line id for invoice and compensation projection', () => {
    expect(buildLegacyLiveInvoiceSourceLineId({
      lineNumber: 1,
      itemCategory: 'usg',
      referenceId: 44,
    })).toBe('1:usg:44');

    expect(buildLegacyLiveInvoiceSourceLineId({
      lineNumber: 2,
      itemCategory: 'doctor_visit',
      referenceId: null,
    })).toBe('2:doctor_visit:none');
  });

  it('rejects unstable or invalid identity components', () => {
    expect(() => buildLegacyLiveInvoiceSourceLineId({
      lineNumber: 0,
      itemCategory: 'usg',
      referenceId: 44,
    })).toThrow(/lineNumber/);
    expect(() => buildLegacyLiveInvoiceSourceLineId({
      lineNumber: 1,
      itemCategory: ' usg ',
      referenceId: 44,
    })).toThrow(/itemCategory/);
  });
});
