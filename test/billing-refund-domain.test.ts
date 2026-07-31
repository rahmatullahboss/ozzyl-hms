import { describe, expect, it } from 'vitest';
import {
  calculateRefundFinancialImpact,
  calculateRefundSelection,
  loadRefundableInvoiceItems,
  tryCalculateRefundFinancialImpact,
  type RefundableInvoiceItem,
} from '../src/lib/billing-refund';
import { createMockDB } from './integration/helpers/mock-db';

function item(overrides: Partial<RefundableInvoiceItem> = {}): RefundableInvoiceItem {
  return {
    invoiceItemId: 101,
    description: 'CBC',
    itemCategory: 'test',
    quantity: 2,
    approvedReturnedQuantity: 0,
    pendingReservedQuantity: 0,
    availableQuantity: 2,
    refundableUnitAmount: 400,
    clinicalStatus: 'pending',
    eligible: true,
    blockReason: null,
    ...overrides,
  };
}

describe('billing refund domain', () => {
  it('calculates item-based refund from net line amount and selected quantity', () => {
    const result = calculateRefundSelection([item()], [{ invoiceItemId: 101, returnQuantity: 1 }]);
    expect(result.totalRefund).toBe(400);
    expect(result.items[0].refundAmount).toBe(400);
  });

  it('rounds aggregate values to two decimals', () => {
    const result = calculateRefundSelection([
      item({ refundableUnitAmount: 33.335 }),
      item({ invoiceItemId: 102, refundableUnitAmount: 12.345 }),
    ], [
      { invoiceItemId: 101, returnQuantity: 1 },
      { invoiceItemId: 102, returnQuantity: 1 },
    ]);
    expect(result.totalRefund).toBe(45.69);
  });

  it('splits a partially-paid item credit between receivable reduction and cash refund', () => {
    expect(calculateRefundFinancialImpact({
      originalTotal: 1000,
      originalPaid: 600,
      totalCredit: 500,
    })).toEqual({
      newTotal: 500,
      newPaid: 500,
      newDue: 0,
      cashRefund: 100,
      receivableReduction: 400,
    });
  });

  it('returns no cash refund when a credit only reduces an unpaid receivable', () => {
    expect(calculateRefundFinancialImpact({
      originalTotal: 1000,
      originalPaid: 200,
      totalCredit: 300,
    })).toEqual({
      newTotal: 700,
      newPaid: 200,
      newDue: 500,
      cashRefund: 0,
      receivableReduction: 300,
    });
  });

  it('returns no preview for a stale approval credit that exceeds the current bill total', () => {
    expect(tryCalculateRefundFinancialImpact({
      originalTotal: 1000,
      originalPaid: 1000,
      totalCredit: 1200,
    })).toBeNull();
  });

  it('rejects completed or verified diagnostic items', () => {
    expect(() => calculateRefundSelection([
      item({ clinicalStatus: 'verified', eligible: false, blockReason: 'Completed or verified services cannot be refunded' }),
    ], [{ invoiceItemId: 101, returnQuantity: 1 }])).toThrow(/completed|verified/i);
  });

  it('rejects quantities already approved or pending', () => {
    expect(() => calculateRefundSelection([
      item({ approvedReturnedQuantity: 1, pendingReservedQuantity: 1, availableQuantity: 0, eligible: false, blockReason: 'No refundable quantity remains' }),
    ], [{ invoiceItemId: 101, returnQuantity: 1 }])).toThrow(/quantity|refundable/i);
  });

  it('rejects duplicate item selections and invalid quantities', () => {
    expect(() => calculateRefundSelection([item()], [
      { invoiceItemId: 101, returnQuantity: 1 },
      { invoiceItemId: 101, returnQuantity: 1 },
    ])).toThrow(/duplicate/i);
    expect(() => calculateRefundSelection([item()], [{ invoiceItemId: 101, returnQuantity: 3 }])).toThrow(/available/i);
  });

  it('does not refund the list price when an invoice line was fully discounted to zero', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (/FROM invoice_items ii/i.test(sql)) {
          return { results: [{
            id: 101,
            description: 'Waived service',
            item_category: 'service',
            quantity: 1,
            unit_price: 800,
            line_total: 0,
            reference_id: null,
            invoice_status: 'active',
            approved_returned_qty: 0,
            pending_credit_note_qty: 0,
          }] };
        }
        if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [] };
        return null;
      },
    });

    const result = await loadRefundableInvoiceItems(mockDB.db, 'tenant-1', 75);
    expect(result[0]).toMatchObject({
      refundableUnitAmount: 0,
      eligible: false,
      blockReason: 'No refundable amount remains',
    });
  });

  it('keeps an unlinked diagnostic invoice item refundable when no diagnostic workflow is configured', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (/FROM invoice_items ii/i.test(sql)) {
          return { results: [{
            id: 101,
            description: 'ECG',
            item_category: 'test',
            quantity: 1,
            unit_price: 160,
            line_total: 160,
            reference_id: 700,
            invoice_status: 'active',
            approved_returned_qty: 0,
            pending_credit_note_qty: 0,
          }] };
        }
        if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [] };
        if (/FROM lab_order_items loi[\s\S]*JOIN lab_orders lo/i.test(sql)) return { results: [] };
        if (/FROM radiology_requisitions/i.test(sql)) return { results: [] };
        return null;
      },
    });

    const result = await loadRefundableInvoiceItems(mockDB.db, 'tenant-1', 75);
    expect(result[0]).toMatchObject({
      clinicalStatus: null,
      eligible: true,
      blockReason: null,
    });
  });

  it('resolves billing-counter diagnostic items through the catalog service-item mapping', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (/AS invoice_item_id[\s\S]*FROM invoice_items ii[\s\S]*JOIN lab_test_catalog ltc/i.test(sql)) {
          return { results: [{ invoice_item_id: 101, lab_order_item_id: 901, status: 'pending' }] };
        }
        if (/FROM invoice_items ii/i.test(sql)) {
          return { results: [{
            id: 101,
            description: 'FT4 (ELISA)',
            item_category: 'test',
            quantity: 1,
            unit_price: 949,
            line_total: 949,
            reference_id: 700,
            invoice_status: 'active',
            approved_returned_qty: 0,
            pending_credit_note_qty: 0,
          }] };
        }
        if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [] };
        if (/FROM lab_order_items loi[\s\S]*JOIN lab_orders lo/i.test(sql)) return { results: [] };
        if (/FROM radiology_requisitions/i.test(sql)) return { results: [] };
        return null;
      },
    });

    const result = await loadRefundableInvoiceItems(mockDB.db, 'tenant-1', 75);
    expect(result[0]).toMatchObject({
      clinicalStatus: 'pending',
      eligible: true,
      blockReason: null,
    });
  });

  it('fails closed when a catalog-mapped invoice item matches multiple lab order items', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (/AS invoice_item_id[\s\S]*FROM invoice_items ii[\s\S]*JOIN lab_test_catalog ltc/i.test(sql)) {
          return { results: [
            { invoice_item_id: 101, lab_order_item_id: 901, status: 'pending' },
            { invoice_item_id: 101, lab_order_item_id: 902, status: 'pending' },
          ] };
        }
        if (/FROM invoice_items ii/i.test(sql)) {
          return { results: [{
            id: 101,
            description: 'FT4 (ELISA)',
            item_category: 'test',
            quantity: 1,
            unit_price: 949,
            line_total: 949,
            reference_id: 700,
            invoice_status: 'active',
            approved_returned_qty: 0,
            pending_credit_note_qty: 0,
          }] };
        }
        if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [] };
        if (/FROM lab_order_items loi[\s\S]*JOIN lab_orders lo/i.test(sql)) return { results: [] };
        if (/FROM radiology_requisitions/i.test(sql)) return { results: [] };
        return null;
      },
    });

    const result = await loadRefundableInvoiceItems(mockDB.db, 'tenant-1', 75);
    expect(result[0]).toMatchObject({
      clinicalStatus: 'ambiguous',
      eligible: false,
      blockReason: 'Service linkage is ambiguous; use manual review',
    });
  });

  it('fails closed when direct and catalog lab links resolve to different lab items', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (/AS invoice_item_id[\s\S]*FROM invoice_items ii[\s\S]*JOIN lab_test_catalog ltc/i.test(sql)) {
          return { results: [{ invoice_item_id: 101, lab_order_item_id: 901, status: 'pending' }] };
        }
        if (/FROM invoice_items ii/i.test(sql)) {
          return { results: [{
            id: 101,
            description: 'FT4 (ELISA)',
            item_category: 'test',
            quantity: 1,
            unit_price: 949,
            line_total: 949,
            reference_id: 501,
            invoice_status: 'active',
            approved_returned_qty: 0,
            pending_credit_note_qty: 0,
          }] };
        }
        if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [] };
        if (/FROM lab_order_items loi[\s\S]*JOIN lab_orders lo/i.test(sql)) return { results: [{ id: 501, status: 'pending' }] };
        if (/FROM radiology_requisitions/i.test(sql)) return { results: [] };
        return null;
      },
    });

    const result = await loadRefundableInvoiceItems(mockDB.db, 'tenant-1', 75);
    expect(result[0]).toMatchObject({
      clinicalStatus: 'ambiguous',
      eligible: false,
      blockReason: 'Service linkage is ambiguous; use manual review',
    });
  });

  it('fails closed when the same diagnostic reference is linked to both lab and radiology for the bill', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (/FROM invoice_items ii/i.test(sql)) {
          return { results: [{
            id: 101,
            description: 'CBC',
            item_category: 'test',
            quantity: 1,
            unit_price: 800,
            line_total: 800,
            reference_id: 501,
            invoice_status: 'active',
            approved_returned_qty: 0,
            pending_credit_note_qty: 0,
          }] };
        }
        if (/SELECT id, request_data[\s\S]*FROM approval_requests/i.test(sql)) return { results: [] };
        if (/FROM lab_order_items loi[\s\S]*JOIN lab_orders lo/i.test(sql)) return { results: [{ id: 501, status: 'pending' }] };
        if (/FROM radiology_requisitions/i.test(sql)) return { results: [{ id: 501, status: 'completed' }] };
        return null;
      },
    });

    const result = await loadRefundableInvoiceItems(mockDB.db, 'tenant-1', 75);
    expect(result[0]).toMatchObject({
      clinicalStatus: 'ambiguous',
      eligible: false,
      blockReason: 'Service linkage is ambiguous; use manual review',
    });
    const labQuery = mockDB.queries.find((query) => /FROM lab_order_items loi/i.test(query.sql));
    const radiologyQuery = mockDB.queries.find((query) => /FROM radiology_requisitions/i.test(query.sql));
    expect(labQuery?.sql).toMatch(/lo\.bill_id = \?/i);
    expect(radiologyQuery?.sql).toMatch(/bill_id = \?/i);
  });
});
