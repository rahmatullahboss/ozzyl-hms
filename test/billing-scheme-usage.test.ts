import { describe, expect, it } from 'vitest';
import { recordBillingSchemeUsage } from '../src/lib/billing-scheme-eligibility';

function createMockDb(allocationId: number | null) {
  const calls: Array<{ sql: string; binds: unknown[] }> = [];
  return {
    calls,
    db: {
      prepare(sql: string) {
        return {
          bind(...binds: unknown[]) {
            calls.push({ sql, binds });
            return {
              async first() {
                return allocationId ? { id: allocationId } : null;
              },
              async run() {
                return { success: true };
              },
            };
          },
        };
      },
    } as unknown as D1Database,
  };
}

describe('recordBillingSchemeUsage', () => {
  it('auto-links billing scheme usage to the matching discount allocation row', async () => {
    const { db, calls } = createMockDb(77);

    await recordBillingSchemeUsage(db, {
      tenantId: 'tenant-1',
      schemeId: 12,
      memberId: 34,
      patientId: 56,
      billId: 99,
      subtotal: 1000,
      discountAmount: 120,
      allocationType: 'staff_benefit',
      createdBy: 8,
    });

    expect(calls[0].sql).toContain('FROM bill_discount_allocations');
    expect(calls[0].binds).toEqual(['tenant-1', 99, 12]);
    expect(calls[1].sql).toContain('INSERT OR IGNORE INTO billing_scheme_usage');
    expect(calls[1].binds[5]).toBe(77);
  });

  it('uses an explicit allocation id without another lookup', async () => {
    const { db, calls } = createMockDb(77);

    await recordBillingSchemeUsage(db, {
      tenantId: 'tenant-1',
      schemeId: 12,
      billId: 99,
      allocationId: 55,
      subtotal: 1000,
      discountAmount: 120,
      allocationType: 'staff_benefit',
      createdBy: 8,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('INSERT OR IGNORE INTO billing_scheme_usage');
    expect(calls[0].binds[5]).toBe(55);
  });
});
