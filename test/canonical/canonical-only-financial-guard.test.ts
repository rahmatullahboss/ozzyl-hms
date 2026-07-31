import { describe, expect, it } from 'vitest';
import { evaluateCanonicalOnlyFinancialRequest } from '../../src/middleware/canonical-only-financial-guard';

describe('retired canonical-only financial guard', () => {
  it.each([
    ['100', 'POST', '/api/billing'],
    ['100', 'POST', '/api/deposits'],
    ['100', 'POST', '/api/credit-notes'],
    ['101', 'POST', '/api/billing'],
  ])('never blocks %s %s %s after canonical-only withdrawal', (tenantId, method, path) => {
    expect(evaluateCanonicalOnlyFinancialRequest({
      tenantId,
      method,
      path,
      policy: tenantId === '100'
        ? { enabled: true, writePolicy: 'strict' }
        : { enabled: false, writePolicy: 'legacy' },
    })).toEqual({ allowed: true });
  });
});
