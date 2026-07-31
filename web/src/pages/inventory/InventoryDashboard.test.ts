import { describe, expect, it } from 'vitest';
import {
  alertClass,
  formatAlertType,
  formatSuggestedOrderQty,
  money,
  recommendationToneClass,
  smartStockVerdict,
  stockHealthLabel,
  urgentStockCount,
} from './inventoryDashboardSmartHelpers';

const baseSummary = {
  totalStockValue: 0,
  lowStockItems: 0,
  outOfStockItems: 0,
  expiringSoonItems: 0,
  expiredItems: 0,
  pendingPurchaseRequests: 0,
  pendingDepartmentRequests: 0,
  todayReceivedQuantity: 0,
  todayIssuedQuantity: 0,
  damagedStockQuantity: 0,
  assetMaintenanceDue: 0,
};

const baseIntelligenceSummary = {
  stockout: 0,
  low: 0,
  watch: 0,
  ok: 0,
  suggestedOrderQtyTotal: 0,
};

describe('InventoryDashboard helpers', () => {
  describe('money', () => {
    it('formats number with taka symbol', () => {
      expect(money(1500)).toBe('৳1,500');
    });

    it('formats zero', () => {
      expect(money(0)).toBe('৳0');
    });

    it('handles undefined as zero', () => {
      expect(money(undefined as unknown as number)).toBe('৳0');
    });

    it('handles null as zero', () => {
      expect(money(null as unknown as number)).toBe('৳0');
    });

    it('truncates decimals', () => {
      expect(money(1234.56)).toBe('৳1,235');
    });

    it('formats large numbers with commas', () => {
      expect(money(1000000)).toBe('৳1,000,000');
    });
  });

  describe('alertClass', () => {
    it('returns red classes for danger severity', () => {
      expect(alertClass('danger')).toContain('red');
    });

    it('returns amber classes for warning severity', () => {
      expect(alertClass('warning')).toContain('amber');
    });

    it('returns blue classes for unknown severity', () => {
      expect(alertClass('info')).toContain('blue');
    });

    it('returns blue classes for empty string', () => {
      expect(alertClass('')).toContain('blue');
    });
  });

  describe('stock command center helpers', () => {
    it('counts urgent issues from out-of-stock, expired, and damaged stock', () => {
      expect(urgentStockCount({ ...baseSummary, outOfStockItems: 2, expiredItems: 3, damagedStockQuantity: 4 })).toBe(9);
    });

    it('labels urgent stock risk first', () => {
      expect(stockHealthLabel({ ...baseSummary, outOfStockItems: 1 })).toBe('1 urgent stock issue');
      expect(stockHealthLabel({ ...baseSummary, outOfStockItems: 2, expiredItems: 1 })).toBe('3 urgent stock issues');
    });

    it('labels low stock and expiry watch state when no urgent issue exists', () => {
      expect(stockHealthLabel({ ...baseSummary, lowStockItems: 2 })).toBe('Watch low stock and expiry');
      expect(stockHealthLabel({ ...baseSummary, expiringSoonItems: 2 })).toBe('Watch low stock and expiry');
    });

    it('labels healthy stock when no risk signal exists', () => {
      expect(stockHealthLabel(baseSummary)).toBe('Stock health looks good');
    });

    it('formats snake-case alert labels for staff-readable UI', () => {
      expect(formatAlertType('low_stock')).toBe('Low Stock');
      expect(formatAlertType('pending_purchase_request')).toBe('Pending Purchase Request');
    });
  });

  describe('smart stock assistant helpers', () => {
    it('shows blocked verdict when deterministic intelligence detects stockout', () => {
      expect(smartStockVerdict(baseSummary, { ...baseIntelligenceSummary, stockout: 1 })).toBe('Blocked today');
    });

    it('shows ready with risk when intelligence has low or watch items', () => {
      expect(smartStockVerdict(baseSummary, { ...baseIntelligenceSummary, low: 2 })).toBe('Ready with risk');
      expect(smartStockVerdict(baseSummary, { ...baseIntelligenceSummary, watch: 3 })).toBe('Ready with risk');
    });

    it('falls back to operational summary risk when intelligence tables are empty', () => {
      expect(smartStockVerdict({ ...baseSummary, outOfStockItems: 1 }, undefined)).toBe('Blocked today');
      expect(smartStockVerdict({ ...baseSummary, expiredItems: 1 }, undefined)).toBe('Blocked today');
      expect(smartStockVerdict({ ...baseSummary, damagedStockQuantity: 1 }, undefined)).toBe('Blocked today');
      expect(smartStockVerdict({ ...baseSummary, lowStockItems: 1 }, undefined)).toBe('Ready with risk');
    });

    it('shows ready when no risk signal exists', () => {
      expect(smartStockVerdict(baseSummary, baseIntelligenceSummary)).toBe('Ready');
    });

    it('formats suggested order quantity safely', () => {
      expect(formatSuggestedOrderQty(42)).toBe('42 units');
      expect(formatSuggestedOrderQty(0)).toBe('No draft qty yet');
      expect(formatSuggestedOrderQty(null)).toBe('No draft qty yet');
    });

    it('maps recommendation severity to staff-readable tone classes', () => {
      expect(recommendationToneClass('critical')).toContain('red');
      expect(recommendationToneClass('warning')).toContain('amber');
      expect(recommendationToneClass('info')).toContain('sky');
    });
  });
});
