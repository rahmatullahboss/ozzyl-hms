import { describe, expect, it } from 'vitest';
import voucherRoutes from '../../../src/routes/tenant/vouchers';
import { createTestApp } from '../helpers/test-app';

describe('voucher numbering routes', () => {
  it('previews the next voucher number without consuming the sequence', async () => {
    const { app, mockDB } = createTestApp({
      route: voucherRoutes,
      routePath: '/vouchers',
      role: 'accountant',
      tables: {
        voucher_types: [{ id: 3, tenant_id: 'tenant-1', code: 'JV', name: 'Journal Voucher', is_active: 1 }],
        fiscal_years: [{ id: 2, tenant_id: 'tenant-1', fiscal_year_name: 'FY26' }],
        voucher_numbering: [{ tenant_id: 'tenant-1', voucher_type_id: 3, fiscal_year_id: 2, last_number: 5 }],
      },
    });

    const res = await app.request('/vouchers/next-number?voucherTypeCode=JV&fiscalYearId=2');
    const body = await res.json() as { voucherNumber: string };

    expect(res.status).toBe(200);
    expect(body.voucherNumber).toBe('JV-FY26-006');
    expect(mockDB.queries.some((q) => /INSERT INTO voucher_numbering/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /UPDATE voucher_numbering/i.test(q.sql))).toBe(false);
  });
});
