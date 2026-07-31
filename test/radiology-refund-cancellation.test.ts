import { describe, expect, it } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import { cancelRadiologyRequisitionsForInvoiceItems } from '../src/lib/radiology-cancellation';
import { createMockDB } from './integration/helpers/mock-db';

describe('radiology refund cancellation', () => {
  it('cancels only a bill-linked pending requisition and records an audit row', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (/SELECT DISTINCT rr\.id/i.test(sql)) {
          return { results: [{ id: 81, order_status: 'pending', bill_id: 75 }] };
        }
        if (/UPDATE radiology_requisitions/i.test(sql)) return { meta: { changes: 1 } };
        return null;
      },
    });

    await expect(cancelRadiologyRequisitionsForInvoiceItems(mockDB.db, {
      tenantId: 'tenant-1',
      userId: 9,
      billId: 75,
      invoiceItemIds: [101],
      reason: 'Service was not performed',
    })).resolves.toBe(1);

    const lookup = mockDB.queries.find((query) => /SELECT DISTINCT rr\.id/i.test(query.sql));
    expect(lookup?.sql).toMatch(/rr\.bill_id = ii\.bill_id/i);
    const update = mockDB.queries.find((query) => /UPDATE radiology_requisitions/i.test(query.sql));
    expect(update?.params).toContain(81);
    expect(mockDB.queries.some((query) => /INSERT INTO audit_logs/i.test(query.sql))).toBe(true);
  });

  it('blocks a scanned or reported requisition', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (/SELECT DISTINCT rr\.id/i.test(sql)) {
          return { results: [{ id: 81, order_status: 'scanned', bill_id: 75 }] };
        }
        return null;
      },
    });

    await expect(cancelRadiologyRequisitionsForInvoiceItems(mockDB.db, {
      tenantId: 'tenant-1',
      userId: 9,
      billId: 75,
      invoiceItemIds: [101],
      reason: 'Service was not performed',
    })).rejects.toBeInstanceOf(HTTPException);
    expect(mockDB.queries.some((query) => /UPDATE radiology_requisitions/i.test(query.sql))).toBe(false);
  });
});
