import { describe, expect, it } from 'vitest';
import {
  calculateProportionalRefundAllocation,
  loadRefundAllocationItems,
  validateRefundAllocation,
  type RefundAllocationItem,
} from '../../src/lib/billing-refund';
import { createSqliteD1Harness } from '../helpers/sqlite-d1';

function item(invoiceItemId: number, refundableBalance: number): RefundAllocationItem {
  return {
    invoiceItemId,
    description: `Item ${invoiceItemId}`,
    itemCategory: 'test',
    lineAmount: refundableBalance,
    approvedCreditAmount: 0,
    pendingAllocatedAmount: 0,
    refundableBalance,
    referenceId: invoiceItemId,
    lineIndex: invoiceItemId,
  };
}

describe('refund amount allocation', () => {
  it('allocates proportionally and assigns the rounding remainder to the largest refundable item', () => {
    const result = calculateProportionalRefundAllocation([
      item(3058, 400),
      item(3059, 500),
      item(3060, 1200),
      item(3061, 1200),
    ], 400);

    expect(result.map((row) => row.allocatedRefundAmount)).toEqual([48.48, 60.61, 145.46, 145.45]);
    expect(result.map((row) => row.allocationSource)).toEqual(['auto', 'auto', 'auto', 'auto']);
    expect(result.reduce((sum, row) => sum + row.allocatedRefundAmount, 0)).toBeCloseTo(400, 2);
  });

  it('uses the lowest invoice item id to break equal-balance rounding ties', () => {
    const result = calculateProportionalRefundAllocation([
      item(20, 1),
      item(10, 1),
      item(30, 1),
    ], 0.01);

    expect(result).toEqual([
      expect.objectContaining({ invoiceItemId: 20, allocatedRefundAmount: 0 }),
      expect.objectContaining({ invoiceItemId: 10, allocatedRefundAmount: 0.01 }),
      expect.objectContaining({ invoiceItemId: 30, allocatedRefundAmount: 0 }),
    ]);
  });

  it('accepts requester adjustments only when the exact amount reconciles', () => {
    const items = [item(1, 200), item(2, 300)];
    const result = validateRefundAllocation(items, 400, [
      { invoiceItemId: 1, allocatedRefundAmount: 150 },
      { invoiceItemId: 2, allocatedRefundAmount: 250 },
    ]);

    expect(result.totalRefund).toBe(400);
    expect(result.items).toEqual([
      expect.objectContaining({ invoiceItemId: 1, allocatedRefundAmount: 150, allocationSource: 'requester_adjusted' }),
      expect.objectContaining({ invoiceItemId: 2, allocatedRefundAmount: 250, allocationSource: 'requester_adjusted' }),
    ]);
  });

  it('rejects an allocation that exceeds an item refundable balance', () => {
    expect(() => validateRefundAllocation([item(1, 100), item(2, 300)], 400, [
      { invoiceItemId: 1, allocatedRefundAmount: 150 },
      { invoiceItemId: 2, allocatedRefundAmount: 250 },
    ])).toThrow(/exceeds.*refundable balance/i);
  });

  it('rejects duplicate allocation rows', () => {
    expect(() => validateRefundAllocation([item(1, 500)], 400, [
      { invoiceItemId: 1, allocatedRefundAmount: 200 },
      { invoiceItemId: 1, allocatedRefundAmount: 200 },
    ])).toThrow(/duplicate/i);
  });

  it('rejects an allocation whose total does not equal the requested refund', () => {
    expect(() => validateRefundAllocation([item(1, 500)], 400, [
      { invoiceItemId: 1, allocatedRefundAmount: 399.99 },
    ])).toThrow(/must equal/i);
  });

  it('rejects an automatic allocation when refundable value is insufficient', () => {
    expect(() => calculateProportionalRefundAllocation([item(1, 100)], 100.01)).toThrow(/exceeds.*refundable/i);
  });

  it('loads refundable financial balances after approved and pending allocations', async () => {
    const { db, sqlite } = createSqliteD1Harness();
    sqlite.exec(`
      CREATE TABLE invoice_items (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        bill_id INTEGER NOT NULL,
        description TEXT,
        item_category TEXT,
        quantity INTEGER,
        unit_price REAL,
        line_total REAL,
        reference_id INTEGER,
        status TEXT
      );
      CREATE TABLE billing_credit_notes (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        status TEXT,
        is_active INTEGER
      );
      CREATE TABLE billing_credit_note_items (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        credit_note_id INTEGER NOT NULL,
        invoice_item_id INTEGER NOT NULL,
        total_amount REAL NOT NULL
      );
      CREATE TABLE approval_requests (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        request_data TEXT
      );
      INSERT INTO invoice_items VALUES
        (1, 'tenant-1', 75, 'CBC', 'test', 1, 400, 400, 101, 'active'),
        (2, 'tenant-1', 75, 'TSH', 'test', 1, 600, 600, 102, 'active');
      INSERT INTO billing_credit_notes VALUES (10, 'tenant-1', 'approved', 1);
      INSERT INTO billing_credit_note_items VALUES (11, 'tenant-1', 10, 1, 100);
      INSERT INTO approval_requests VALUES (
        20, 'tenant-1', 'refund', 75, 'pending',
        '{"items":[{"invoiceItemId":2,"allocatedRefundAmount":50}]}'
      );
      INSERT INTO approval_requests VALUES (
        21, 'tenant-1', 'refund', 75, 'pending',
        '{"items":[{"invoiceItemId":1,"allocatedRefundAmount":25}]}'
      );
    `);

    const result = await loadRefundAllocationItems(db, 'tenant-1', 75, { excludeApprovalRequestId: 21 });

    expect(result).toEqual([
      expect.objectContaining({
        invoiceItemId: 1,
        lineAmount: 400,
        approvedCreditAmount: 100,
        pendingAllocatedAmount: 0,
        refundableBalance: 300,
        lineIndex: 1,
      }),
      expect.objectContaining({
        invoiceItemId: 2,
        lineAmount: 600,
        approvedCreditAmount: 0,
        pendingAllocatedAmount: 50,
        refundableBalance: 550,
        lineIndex: 2,
      }),
    ]);
  });
});
