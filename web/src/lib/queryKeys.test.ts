import { describe, it, expect } from 'vitest';
import { queryKeys } from './queryKeys';

describe('queryKeys', () => {
  it('returns stable array references for static keys', () => {
    expect(queryKeys.doctors.all).toBe(queryKeys.doctors.all);
    expect(queryKeys.billing.all).toBe(queryKeys.billing.all);
  });

  it('factory functions produce correct shapes', () => {
    expect(queryKeys.doctors.dashboard()).toEqual(['doctors', 'dashboard']);
    expect(queryKeys.patients.detail(42)).toEqual(['patients', 'detail', 42]);
    expect(queryKeys.billing.list({ status: 'paid' })).toEqual(['billing', 'list', { status: 'paid' }]);
    expect(queryKeys.cashOperations.overview()).toEqual(['cashOperations', 'overview']);
    expect(queryKeys.cashOperations.activity({ limit: 20 })).toEqual(['cashOperations', 'activity', { limit: 20 }]);
    expect(queryKeys.cashOperations.settings()).toEqual(['cashOperations', 'settings']);
  });

  it('different filter args produce different keys', () => {
    const a = queryKeys.appointments.list({ date: '2026-01-01' });
    const b = queryKeys.appointments.list({ date: '2026-01-02' });
    expect(a).not.toEqual(b);
  });

  it('all namespace prefixes child keys for invalidation', () => {
    const allPrefix = queryKeys.pharmacy.all[0];
    expect(queryKeys.pharmacy.medicines()[0]).toBe(allPrefix);
    expect(queryKeys.pharmacy.stock()[0]).toBe(allPrefix);
    expect(queryKeys.pharmacy.categories()[0]).toBe(allPrefix);
  });

  it('covers major domain namespaces', () => {
    const domains = Object.keys(queryKeys);
    expect(domains).toContain('doctors');
    expect(domains).toContain('patients');
    expect(domains).toContain('billing');
    expect(domains).toContain('pharmacy');
    expect(domains).toContain('laboratory');
    expect(domains).toContain('nursing');
    expect(domains).toContain('emergency');
    expect(domains).toContain('radiology');
    expect(domains).toContain('inventory');
    expect(domains).toContain('accounting');
    expect(domains).toContain('cashOperations');
  });
});
