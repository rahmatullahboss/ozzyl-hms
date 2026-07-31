import { describe, expect, it } from 'vitest';
import { getIpdCollectionBreakdown } from '../../src/lib/ipd-finance-reporting';
import { createMockDB } from '../integration/helpers/mock-db';

describe('IPD finance reporting', () => {
  it('reads the discount reference from the existing bills.discount_by_name column', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

        if (normalized.startsWith('select coalesce(sum(p.amount), 0) as total')) {
          return { results: [{ total: 500, row_count: 1 }] };
        }

        if (normalized.includes("'ipd_collection' as source_type")) {
          return {
            results: [{
              id: 'ipd-payment-1',
              occurred_at: '2026-07-22 10:00:00',
              source_type: 'ipd_collection',
              source_label: 'Admission/IPD collection',
              reference_no: 'PAY-1',
              amount: 500,
              bill_id: 10,
              invoice_no: 'IPD-10',
              discount_reference: 'Referral desk',
              discount_reason: 'Doctor reference',
              gross_amount: 700,
              discount_amount: 200,
              net_amount: 500,
              paid_amount: 500,
              due_amount: 0,
            }],
          };
        }

        return null;
      },
    });

    const result = await getIpdCollectionBreakdown(
      mockDB.db,
      'tenant-1',
      '2026-07-22',
      '2026-07-22',
      { pageSize: 50, offset: 0 },
    );

    const detailSql = mockDB.queries
      .map((query) => query.sql.replace(/\s+/g, ' ').trim().toLowerCase())
      .find((sql) => sql.includes("'ipd_collection' as source_type"));

    expect(detailSql).toContain('b.discount_by_name as discount_reference');
    expect(detailSql).not.toContain('b.discount_reference');
    expect(result.rows[0]?.discountReference).toBe('Referral desk');
  });
});
