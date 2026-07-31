import { describe, expect, it } from 'vitest';
import {
  assertNoPaidPerformerReserves,
  cancelUnpaidPerformerReserves,
  cancelUnpaidPerformerReserveQuantities,
} from '../../src/lib/diagnostic-performer-reserve';
import { createMockDB } from '../integration/helpers/mock-db';

describe('diagnostic performer reserve lifecycle', () => {
  it('blocks cancellation or refund when any linked performer reserve is paid', async () => {
    const mock = createMockDB({
      queryOverride: (sql) => /FROM diagnostic_performer_reserves/i.test(sql)
        ? { first: { id: 701, settlement_id: 91 } }
        : null,
    });

    await expect(assertNoPaidPerformerReserves(mock.db, 'tenant-1', { billId: 501 }))
      .rejects.toThrow('Reverse the doctor payout before cancelling or refunding the linked test');
    const query = mock.queries.find((entry) => /FROM diagnostic_performer_reserves/i.test(entry.sql));
    expect(query?.sql).toContain("status = 'paid'");
    expect(query?.params).toEqual(["tenant-1", 501]);
  });

  it('scopes paid-reserve checks to selected invoice items', async () => {
    const mock = createMockDB({
      queryOverride: (sql) => /FROM diagnostic_performer_reserves/i.test(sql) ? { first: null } : null,
    });

    await assertNoPaidPerformerReserves(mock.db, 'tenant-1', { billId: 501, invoiceItemIds: [301, 303] });
    const query = mock.queries.find((entry) => /FROM diagnostic_performer_reserves/i.test(entry.sql));
    expect(query?.sql).toContain('invoice_item_id IN (?,?)');
    expect(query?.params).toEqual(['tenant-1', 501, 301, 303]);
  });

  it('cancels only reserved rows and preserves paid or reversed history', async () => {
    const mock = createMockDB({
      tables: {
        diagnostic_performer_reserves: [
          { id: 701, tenant_id: 'tenant-1', bill_id: 501, invoice_item_id: 301, unit_sequence: 1, reserved_amount: 25, status: 'reserved', canonical_source_key: null },
          { id: 702, tenant_id: 'tenant-1', bill_id: 501, invoice_item_id: 301, unit_sequence: 2, reserved_amount: 25, status: 'paid', canonical_source_key: null },
          { id: 703, tenant_id: 'tenant-1', bill_id: 501, invoice_item_id: 303, unit_sequence: 1, reserved_amount: 30, status: 'reserved', canonical_source_key: null },
          { id: 704, tenant_id: 'tenant-1', bill_id: 501, invoice_item_id: 303, unit_sequence: 2, reserved_amount: 30, status: 'reversed', canonical_source_key: null },
        ],
      },
      queryOverride: (sql) => {
        if (/SELECT[\s\S]+FROM diagnostic_performer_reserves/i.test(sql)) {
          return {
            results: [
              { id: 701, bill_id: 501, invoice_item_id: 301, unit_sequence: 1, reserved_amount: 25, status: 'reserved', canonical_source_key: null },
              { id: 703, bill_id: 501, invoice_item_id: 303, unit_sequence: 1, reserved_amount: 30, status: 'reserved', canonical_source_key: null },
            ],
          };
        }
        return /UPDATE diagnostic_performer_reserves/i.test(sql)
          ? { meta: { changes: 1 } }
          : null;
      },
    });

    const changed = await cancelUnpaidPerformerReserves(mock.db, 'tenant-1', {
      billId: 501,
      invoiceItemIds: [301, 303],
      reason: 'Bill item cancelled',
      userId: 99,
    });

    expect(changed).toBe(2);
    const updates = mock.queries.filter((entry) => /UPDATE diagnostic_performer_reserves/i.test(entry.sql));
    expect(updates).toHaveLength(2);
    expect(updates.every((query) => query.sql.includes("status='reserved'"))).toBe(true);
    expect(updates.every((query) => query.sql.includes("SET status='cancelled'"))).toBe(true);
    expect(updates.flatMap((query) => query.params)).toEqual(
      expect.arrayContaining([99, 'Bill item cancelled', 'tenant-1', 501, 301, 303]),
    );
  });

  it('cancels the oldest reserved units up to each credit-note return quantity', async () => {
    const mock = createMockDB({
      tables: {
        diagnostic_performer_reserves: [
          { id: 801, tenant_id: 'tenant-1', bill_id: 501, invoice_item_id: 301, unit_sequence: 1, reserved_amount: 25, status: 'reserved', canonical_source_key: null },
          { id: 802, tenant_id: 'tenant-1', bill_id: 501, invoice_item_id: 301, unit_sequence: 2, reserved_amount: 25, status: 'reserved', canonical_source_key: null },
          { id: 803, tenant_id: 'tenant-1', bill_id: 501, invoice_item_id: 303, unit_sequence: 1, reserved_amount: 30, status: 'reserved', canonical_source_key: null },
          { id: 804, tenant_id: 'tenant-1', bill_id: 501, invoice_item_id: 303, unit_sequence: 2, reserved_amount: 30, status: 'reserved', canonical_source_key: null },
          { id: 805, tenant_id: 'tenant-1', bill_id: 501, invoice_item_id: 303, unit_sequence: 3, reserved_amount: 30, status: 'reserved', canonical_source_key: null },
        ],
      },
      queryOverride: (sql) => {
        if (/SELECT[\s\S]+FROM diagnostic_performer_reserves/i.test(sql)) {
          return {
            results: [
              { id: 801, bill_id: 501, invoice_item_id: 301, unit_sequence: 1, reserved_amount: 25, status: 'reserved', canonical_source_key: null },
              { id: 802, bill_id: 501, invoice_item_id: 301, unit_sequence: 2, reserved_amount: 25, status: 'reserved', canonical_source_key: null },
              { id: 803, bill_id: 501, invoice_item_id: 303, unit_sequence: 1, reserved_amount: 30, status: 'reserved', canonical_source_key: null },
              { id: 804, bill_id: 501, invoice_item_id: 303, unit_sequence: 2, reserved_amount: 30, status: 'reserved', canonical_source_key: null },
              { id: 805, bill_id: 501, invoice_item_id: 303, unit_sequence: 3, reserved_amount: 30, status: 'reserved', canonical_source_key: null },
            ],
          };
        }
        return /UPDATE diagnostic_performer_reserves/i.test(sql)
          ? { meta: { changes: 1 } }
          : null;
      },
    });

    const changed = await cancelUnpaidPerformerReserveQuantities(mock.db, 'tenant-1', {
      billId: 501,
      items: [{ invoiceItemId: 301, quantity: 1 }, { invoiceItemId: 303, quantity: 2 }],
      reason: 'Credit note approved',
      userId: 99,
    });

    expect(changed).toBe(3);
    expect(mock.queries.filter((entry) => /UPDATE diagnostic_performer_reserves/i.test(entry.sql))).toHaveLength(3);
    expect(mock.queries[0].sql).toContain('ORDER BY invoice_item_id ASC,unit_sequence ASC,id ASC');
  });
});
