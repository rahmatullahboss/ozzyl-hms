import { describe, expect, it } from 'vitest';
import { annotateInvoiceItemsWithRefunds, summarizeRefundApprovalRequests } from '../../src/lib/invoice-refund-presentation';

describe('invoice refund presentation', () => {
  it('marks a financially refunded line as approval-pending and calculates its net amount', () => {
    const requests = summarizeRefundApprovalRequests([{
      id: 91, entity_id: 75, entity_no: 'BL-75', status: 'pending', execution_status: 'succeeded', created_at: '2026-07-28 17:00:00',
      request_data: JSON.stringify({ refundKind: 'item_partial_refund', requestedRefundAmount: 160, items: [{ invoiceItemId: 101, returnQuantity: 1, description: 'Urine R/E' }] }),
    }]);
    const items = annotateInvoiceItemsWithRefunds(
      [{ id: 101, description: 'Urine R/E', item_category: 'test', quantity: 1, unit_price: 160, line_total: 160 }],
      [{ invoice_item_id: 101, refunded_quantity: 1, refunded_amount: 160, credit_note_nos: 'CN-1' }],
      requests,
    );

    expect(items[0]).toMatchObject({
      original_line_amount: 160,
      refunded_amount: 160,
      net_line_amount: 0,
      refund_status: 'refunded_pending_approval',
    });
  });

  it('keeps a request visible even before a credit amount exists', () => {
    const requests = summarizeRefundApprovalRequests([{
      id: 92, entity_id: 75, entity_no: 'BL-75', status: 'pending', execution_status: 'pending', created_at: '2026-07-28 17:05:00',
      request_data: JSON.stringify({ refundKind: 'item_partial_refund', items: [{ invoiceItemId: 102, returnQuantity: 1 }] }),
    }]);
    const items = annotateInvoiceItemsWithRefunds(
      [{ id: 102, description: 'ECG', item_category: 'test', quantity: 1, unit_price: 200, line_total: 200 }],
      [],
      requests,
    );

    expect(items[0]).toMatchObject({ net_line_amount: 200, refund_status: 'refund_requested' });
    expect(requests[0]).toMatchObject({ billId: 75, requestedRefundAmount: 0, itemCount: 1 });
  });

  it('shows a financially refunded line as final after the approval request is approved', () => {
    const requests = summarizeRefundApprovalRequests([{
      id: 93, entity_id: 75, entity_no: 'BL-75', status: 'approved', execution_status: 'succeeded', created_at: '2026-07-28 17:10:00',
      request_data: JSON.stringify({ refundKind: 'item_partial_refund', items: [{ invoiceItemId: 101, returnQuantity: 1 }] }),
    }]);
    const items = annotateInvoiceItemsWithRefunds(
      [{ id: 101, description: 'Urine R/E', item_category: 'test', quantity: 1, unit_price: 160, line_total: 160 }],
      [{ invoice_item_id: 101, refunded_quantity: 1, refunded_amount: 160, credit_note_nos: 'CN-1' }],
      requests,
    );

    expect(items[0]).toMatchObject({ refund_status: 'refunded' });
  });

  it('preserves the gross line amount so the existing discount summary is not applied twice', () => {
    const items = annotateInvoiceItemsWithRefunds(
      [{ id: 103, description: 'Discounted test', item_category: 'test', quantity: 1, unit_price: 100, line_total: 80 }],
      [{ invoice_item_id: 103, refunded_quantity: 1, refunded_amount: 80, credit_note_nos: 'CN-2' }],
      [],
    );

    expect(items[0]).toMatchObject({
      original_line_amount: 100,
      refunded_amount: 80,
      net_line_amount: 20,
      refund_status: 'refunded',
    });
  });
});
