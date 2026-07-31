import { describe, expect, it } from 'vitest';
import { ApiClientError } from './apiClient';
import { shouldRotateInvoiceAttemptKey } from './invoiceIdempotency';

describe('shouldRotateInvoiceAttemptKey', () => {
  it('preserves the key for ambiguous network failures', () => {
    expect(shouldRotateInvoiceAttemptKey(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('preserves the key for server errors because the commit outcome may be unknown', () => {
    expect(shouldRotateInvoiceAttemptKey(new ApiClientError('Internal server error', 500))).toBe(false);
  });

  it('preserves the key while the same request is still being processed', () => {
    expect(shouldRotateInvoiceAttemptKey(new ApiClientError(
      'Billing request is already being processed. Please retry shortly.',
      409,
    ))).toBe(false);
  });

  it('rotates the key for definitive client errors that require a corrected request', () => {
    expect(shouldRotateInvoiceAttemptKey(new ApiClientError('Validation error', 400))).toBe(true);
    expect(shouldRotateInvoiceAttemptKey(new ApiClientError(
      'Idempotency key was already used for a different billing request',
      409,
    ))).toBe(true);
  });
});
