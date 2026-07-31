import { describe, expect, it } from 'vitest';
import { getStockIssueBlockReason, selectFefoStockAllocations } from '../src/lib/inventory-core';

describe('inventory stock QC issue gates', () => {
  it('blocks production issue for QC pending, failed, rejected, or blocked stock lots', () => {
    expect(getStockIssueBlockReason({ StockId: 1, AvailableQuantity: 5, QCStatus: 'pending' } as any, 1)).toBe('Stock lot QC is pending');
    expect(getStockIssueBlockReason({ StockId: 1, AvailableQuantity: 5, QCStatus: 'failed' } as any, 1)).toBe('Stock lot QC failed');
    expect(getStockIssueBlockReason({ StockId: 1, AvailableQuantity: 5, QCStatus: 'rejected' } as any, 1)).toBe('Stock lot QC is rejected');
    expect(getStockIssueBlockReason({ StockId: 1, AvailableQuantity: 5, QCStatus: 'blocked' } as any, 1)).toBe('Stock lot QC is blocked');
  });

  it('normalizes mixed-case QC values before deciding production usability', () => {
    expect(getStockIssueBlockReason({ StockId: 1, AvailableQuantity: 5, QCStatus: 'FAILED' } as any, 1)).toBe('Stock lot QC failed');
    expect(getStockIssueBlockReason({ StockId: 1, AvailableQuantity: 5, QCStatus: ' Passed ' } as any, 1)).toBeNull();
  });

  it('allows QC passed, accepted, not-required, and blank statuses for backward compatibility', () => {
    expect(getStockIssueBlockReason({ StockId: 1, AvailableQuantity: 5, QCStatus: 'passed' } as any, 1)).toBeNull();
    expect(getStockIssueBlockReason({ StockId: 1, AvailableQuantity: 5, QCStatus: 'accepted' } as any, 1)).toBeNull();
    expect(getStockIssueBlockReason({ StockId: 1, AvailableQuantity: 5, QCStatus: 'not_required' } as any, 1)).toBeNull();
    expect(getStockIssueBlockReason({ StockId: 1, AvailableQuantity: 5 } as any, 1)).toBeNull();
  });

  it('skips QC-failed lots when selecting FEFO allocations', () => {
    const allocations = selectFefoStockAllocations([
      { StockId: 1, AvailableQuantity: 5, ExpiryDate: '2099-01-01', QCStatus: 'failed' } as any,
      { StockId: 2, AvailableQuantity: 5, ExpiryDate: '2099-02-01', QCStatus: 'passed' } as any,
    ], 2, { today: '2026-07-09' });

    expect(allocations).toEqual([{ stockId: 2, quantity: 2, balanceAfterIssue: 3 }]);
  });

  it('skips QC-pending lots even when they expire earlier than passed lots', () => {
    const allocations = selectFefoStockAllocations([
      { StockId: 1, AvailableQuantity: 5, ExpiryDate: '2099-01-01', QCStatus: 'pending' } as any,
      { StockId: 2, AvailableQuantity: 5, ExpiryDate: '2099-02-01', QCStatus: 'passed' } as any,
    ], 3, { today: '2026-07-09' });

    expect(allocations).toEqual([{ stockId: 2, quantity: 3, balanceAfterIssue: 2 }]);
  });

  it('fails allocation when all available lots are blocked by QC', () => {
    expect(() => selectFefoStockAllocations([
      { StockId: 1, AvailableQuantity: 5, ExpiryDate: '2099-01-01', QCStatus: 'failed' } as any,
      { StockId: 2, AvailableQuantity: 5, ExpiryDate: '2099-02-01', QCStatus: 'pending' } as any,
    ], 1, { today: '2026-07-09' })).toThrow('Insufficient non-expired stock. Missing 1');
  });
});
