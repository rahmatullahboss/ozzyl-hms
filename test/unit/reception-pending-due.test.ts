import { describe, expect, it } from 'vitest';
import { DEFAULT_DUE_COLLECTION_SCOPE } from '../../web/src/lib/receptionPendingDue';

describe('reception pending due defaults', () => {
  it('opens the collection view on all open dues so dashboard outstanding totals reconcile', () => {
    expect(DEFAULT_DUE_COLLECTION_SCOPE).toBe('all');
  });
});
