import { describe, expect, it } from 'vitest';
import { normalizeExternalTransactionId, requiresPaymentReference } from './paymentReference';

describe('payment reference helpers', () => {
  it('does not require a reference for cash or zero immediate payment', () => {
    expect(requiresPaymentReference('cash', 500)).toBe(false);
    expect(requiresPaymentReference('bkash', 0)).toBe(false);
    expect(requiresPaymentReference('card', -1)).toBe(false);
  });

  it('requires a reference for positive paid non-cash methods', () => {
    for (const method of ['bkash', 'nagad', 'rocket', 'card', 'bank', 'bank_transfer', 'cheque', 'other']) {
      expect(requiresPaymentReference(method, 1)).toBe(true);
    }
  });

  it('trims a valid reference and omits cash or blank references', () => {
    expect(normalizeExternalTransactionId('bkash', 500, '  TXN-123  ')).toBe('TXN-123');
    expect(normalizeExternalTransactionId('cash', 500, 'CASH-REF')).toBeUndefined();
    expect(normalizeExternalTransactionId('bkash', 500, '   ')).toBeUndefined();
    expect(normalizeExternalTransactionId('card', 0, 'CARD-REF')).toBeUndefined();
  });
});
