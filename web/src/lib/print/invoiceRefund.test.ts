import { describe, expect, it } from 'vitest';
import type { InvoicePrintItem } from '../../components/invoice/types';
import {
  getInvoiceItemDisplayAmount,
  getInvoiceItemNetAmount,
} from './invoiceRefund';

function item(overrides: Partial<InvoicePrintItem> = {}): InvoicePrintItem {
  return {
    id: 1,
    item_category: 'test',
    description: 'Urine R/E',
    quantity: 1,
    unit_price: 200,
    line_total: 160,
    tax_amount: null,
    ...overrides,
  };
}

describe('invoice refund print amounts', () => {
  it('shows zero for a fully returned service while preserving its financial subtotal contribution', () => {
    const refunded = item({
      original_line_amount: 200,
      refunded_quantity: 1,
      refunded_amount: 160,
      net_line_amount: 40,
      refund_status: 'refunded_pending_approval',
    });

    expect(getInvoiceItemNetAmount(refunded)).toBe(40);
    expect(getInvoiceItemDisplayAmount(refunded)).toBe(0);
  });

  it('keeps the financial net amount for a partially returned service', () => {
    const partiallyRefunded = item({
      quantity: 2,
      unit_price: 200,
      original_line_amount: 400,
      refunded_quantity: 1,
      refunded_amount: 160,
      net_line_amount: 240,
      refund_status: 'refunded',
    });

    expect(getInvoiceItemDisplayAmount(partiallyRefunded)).toBe(240);
  });
});
