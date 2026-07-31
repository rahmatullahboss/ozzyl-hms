import { describe, expect, it } from 'vitest';
import { isRefundBatchAssertionError } from '../src/lib/billing-refund-batch-guard';

describe('refund batch assertion error detection', () => {
  it('recognizes a refund assertion constraint nested inside a strict financial wrapper', () => {
    const constraint = new Error('CHECK constraint failed: billing_refund_batch_guard.assertion_value');
    const strict = new Error('Canonical strict financial write failed', { cause: constraint });

    expect(isRefundBatchAssertionError(strict)).toBe(true);
  });

  it('does not classify unrelated nested failures as refund assertion errors', () => {
    const strict = new Error('Canonical strict financial write failed', {
      cause: new Error('network unavailable'),
    });

    expect(isRefundBatchAssertionError(strict)).toBe(false);
  });
});
