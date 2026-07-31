import { describe, expect, it } from 'vitest';
import { normalizeInventoryReceiptLot } from '../src/lib/inventory-receipt-normalization';

describe('inventory receipt normalization', () => {
  it('converts purchase units and free quantity into issue-unit stock and cost', () => {
    expect(normalizeInventoryReceiptLot({
      receivedQuantity: 2,
      freeQuantity: 1,
      landedCostPerPurchaseUnit: 500,
      unitConversionFactor: 10,
      itemType: 'lab_reagent',
    })).toEqual({
      stockQuantity: 30,
      costPerIssueUnit: 50,
      qcStatus: 'pending',
      stockStatus: 'blocked',
    });
  });

  it('keeps factor-one non-reagent receipts available', () => {
    expect(normalizeInventoryReceiptLot({
      receivedQuantity: 4,
      freeQuantity: 0,
      landedCostPerPurchaseUnit: 75,
      unitConversionFactor: 1,
      itemType: 'general',
    })).toEqual({
      stockQuantity: 4,
      costPerIssueUnit: 75,
      qcStatus: 'accepted',
      stockStatus: 'available',
    });
  });

  it('defaults a missing conversion factor to one', () => {
    expect(normalizeInventoryReceiptLot({
      receivedQuantity: 3,
      freeQuantity: 2,
      landedCostPerPurchaseUnit: 100,
      unitConversionFactor: null,
      itemType: 'general',
    }).stockQuantity).toBe(5);
  });

  it('excludes rejected purchase units from available issue-unit stock', () => {
    expect(normalizeInventoryReceiptLot({
      receivedQuantity: 5,
      rejectedQuantity: 2,
      freeQuantity: 1,
      landedCostPerPurchaseUnit: 500,
      unitConversionFactor: 10,
      itemType: 'lab_reagent',
    }).stockQuantity).toBe(40);
  });

  it('rejects rejected quantity greater than received quantity', () => {
    expect(() => normalizeInventoryReceiptLot({
      receivedQuantity: 1,
      rejectedQuantity: 2,
      freeQuantity: 0,
      landedCostPerPurchaseUnit: 100,
      unitConversionFactor: 1,
      itemType: 'general',
    })).toThrow('Rejected quantity cannot exceed received quantity');
  });

  it('rejects a non-positive conversion factor', () => {
    expect(() => normalizeInventoryReceiptLot({
      receivedQuantity: 1,
      freeQuantity: 0,
      landedCostPerPurchaseUnit: 100,
      unitConversionFactor: 0,
      itemType: 'lab_reagent',
    })).toThrow('Unit conversion factor must be greater than zero');
  });
});
