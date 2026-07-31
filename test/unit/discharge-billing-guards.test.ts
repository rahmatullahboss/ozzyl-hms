import { describe, expect, it } from 'vitest';
import { createMockDB } from '../integration/helpers/mock-db';
import {
  getPendingDischargeBilling,
  hasPendingDischargeBilling,
} from '../../src/lib/discharge-billing-guards';

describe('discharge billing guards', () => {
  it('can skip provisional rows when discharge bill creation will sweep them', async () => {
    const mockDB = createMockDB({
      queryOverride: () => ({ first: { amount: 0 } }),
    });

    const pending = await getPendingDischargeBilling(
      mockDB.db,
      'tenant-1',
      10,
      1,
      '2026-05-01',
      { includeProvisional: false },
    );

    expect(pending).toEqual({
      provisionalAmount: 0,
      pendingServiceAmount: 0,
      dueAmount: 0,
    });
    expect(mockDB.queries.some((query) => query.sql.includes('billing_provisional_items'))).toBe(false);
    expect(mockDB.queries.some((query) => query.sql.includes('visit_services'))).toBe(true);
    expect(mockDB.queries.some((query) => query.sql.includes('bills'))).toBe(true);
  });

  it('treats provisional, pending service, and due amounts as blocking by default', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.includes('billing_provisional_items')) return { first: { amount: 500 } };
        if (sql.includes('visit_services')) return { first: { amount: 300 } };
        if (sql.includes('bills')) return { first: { amount: 200 } };
        return null;
      },
    });

    const pending = await getPendingDischargeBilling(mockDB.db, 'tenant-1', 10, 1, '2026-05-01');

    expect(pending).toEqual({
      provisionalAmount: 500,
      pendingServiceAmount: 300,
      dueAmount: 200,
    });
    expect(hasPendingDischargeBilling(pending)).toBe(true);
  });

  it('includes admission_id filter in visit_services query', async () => {
    const mockDB = createMockDB({
      queryOverride: () => ({ first: { amount: 0 } }),
    });

    await getPendingDischargeBilling(mockDB.db, 'tenant-1', 42, 1, '2026-05-01');

    // Verify the visit_services query includes admission_id filter
    const visitServicesQuery = mockDB.queries.find(q => q.sql.includes('visit_services'));
    expect(visitServicesQuery).toBeTruthy();
    expect(visitServicesQuery!.sql).toContain('admission_id = ?');
    expect(visitServicesQuery!.sql).toContain('admission_id IS NULL');
    // The admissionId (42) should be in the bind params
    expect(visitServicesQuery!.params).toContain(42);
  });

  it('returns zero pending when no provisional items, services, or dues exist', async () => {
    const mockDB = createMockDB({
      queryOverride: () => ({ first: { amount: 0 } }),
    });

    const pending = await getPendingDischargeBilling(mockDB.db, 'tenant-1', 10, 1, '2026-05-01');

    expect(pending).toEqual({
      provisionalAmount: 0,
      pendingServiceAmount: 0,
      dueAmount: 0,
    });
    expect(hasPendingDischargeBilling(pending)).toBe(false);
  });

  it('handles null admissionDate correctly', async () => {
    const mockDB = createMockDB({
      queryOverride: () => ({ first: { amount: 100 } }),
    });

    await getPendingDischargeBilling(mockDB.db, 'tenant-1', 10, 1, null);

    // When admissionDate is null, the date filter should be skipped
    const visitServicesQuery = mockDB.queries.find(q => q.sql.includes('visit_services'));
    expect(visitServicesQuery).toBeTruthy();
    // The null should be passed as the admissionDate parameter
    expect(visitServicesQuery!.params).toContain(null);
  });
});
