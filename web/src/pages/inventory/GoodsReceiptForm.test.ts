import { describe, expect, it } from 'vitest';
import {
  goodsReceiptRejectedQuantityError,
  resolveGoodsReceiptSubmissionKey,
  toGoodsReceiptItemPayload,
  type GRItem,
} from './GoodsReceiptForm';

describe('GoodsReceiptForm', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./GoodsReceiptForm');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('rejects invalid rejected quantities before creating a GRN', () => {
    expect(goodsReceiptRejectedQuantityError(5, 2)).toBeNull();
    expect(goodsReceiptRejectedQuantityError(5, 6)).toBe('Rejected quantity cannot exceed received quantity');
    expect(goodsReceiptRejectedQuantityError(5, -1)).toBe('Rejected quantity cannot be negative');
  });

  it('reuses the same idempotency key for an unchanged retry payload', () => {
    const first = resolveGoodsReceiptSubmissionKey(null, { VendorId: 1 }, () => 'gr-key-1');
    const retry = resolveGoodsReceiptSubmissionKey(first, { VendorId: 1 }, () => 'gr-key-2');
    expect(retry).toEqual(first);
  });

  it('generates a new idempotency key when the receipt payload changes', () => {
    const first = resolveGoodsReceiptSubmissionKey(null, { VendorId: 1 }, () => 'gr-key-1');
    const changed = resolveGoodsReceiptSubmissionKey(first, { VendorId: 2 }, () => 'gr-key-2');
    expect(changed.key).toBe('gr-key-2');
  });

  it('sends the operator-entered rejected quantity to the goods receipt API', () => {
    const item: GRItem = {
      ItemId: 10,
      BatchNo: 'LOT-10',
      ManufactureDate: '2026-07-01',
      ExpiryDate: '2027-07-01',
      ReceivedQuantity: 5,
      RejectedQuantity: 2,
      FreeQuantity: 1,
      ItemRate: 500,
      MRP: 600,
      VATPercent: 0,
      TotalAmount: 2500,
      Remarks: 'Two kits rejected',
    };

    expect(toGoodsReceiptItemPayload(item)).toMatchObject({
      ItemId: 10,
      ReceivedQuantity: 5,
      RejectedQuantity: 2,
      FreeQuantity: 1,
    });
  });
});
