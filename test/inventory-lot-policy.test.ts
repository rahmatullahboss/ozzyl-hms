import { describe, expect, it } from 'vitest';
import {
  getInventoryLotBlockReason,
  getInventoryUsableQuantity,
  isInventoryLotUsable,
} from '../src/lib/inventory-lot-policy';

describe('shared inventory lot policy', () => {
  it('treats a lot expiring today as expired', () => {
    const lot = { AvailableQuantity: 5, ExpiryDate: '2026-07-10', QCStatus: 'accepted' };

    expect(isInventoryLotUsable(lot, { today: '2026-07-10' })).toBe(false);
    expect(getInventoryLotBlockReason(lot, 1, { today: '2026-07-10' })).toBe('Stock batch is expired');
  });

  it('accepts not_required QC and blocks breached after-open expiry', () => {
    expect(isInventoryLotUsable({ AvailableQuantity: 2, QCStatus: 'not_required' }, { today: '2026-07-10' })).toBe(true);
    expect(getInventoryLotBlockReason({
      AvailableQuantity: 2,
      QCStatus: 'not_required',
      AfterOpenExpiryDate: '2026-07-10',
    }, 1, { today: '2026-07-10' })).toBe('Stock lot after-open expiry is breached');
  });

  it('subtracts reserved, damaged and blocked quantities from usable stock', () => {
    const lot = {
      AvailableQuantity: 100,
      ReservedQuantity: 10,
      DamagedQuantity: 4,
      BlockedQuantity: 6,
    };

    expect(getInventoryUsableQuantity(lot)).toBe(80);
    expect(getInventoryLotBlockReason(lot, 81)).toBe('Insufficient usable stock. Available 80, requested 81');
  });
});
