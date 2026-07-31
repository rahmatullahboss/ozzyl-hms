import { describe, expect, it } from 'vitest';
import {
  formatSuggestedOrderQty,
  recommendationToneClass,
  smartStockVerdict,
} from '../../web/src/pages/inventory/inventoryDashboardSmartHelpers';

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

describe('InventoryDashboard smart stock assistant helpers', () => {
  it('shows setup verdict before any intelligence snapshot exists', () => {
    expect(smartStockVerdict(baseSummary, baseIntelligenceSummary, 'not_configured')).toBe('Setup needed');
  });

  it('shows refresh verdict when intelligence snapshots are stale', () => {
    expect(smartStockVerdict(baseSummary, baseIntelligenceSummary, 'stale')).toBe('Refresh needed');
  });

  it('shows blocked verdict when deterministic intelligence detects stockout', () => {
    expect(smartStockVerdict(baseSummary, { ...baseIntelligenceSummary, stockout: 1 }, 'ready')).toBe('Blocked today');
  });

  it('shows ready with risk when intelligence has low or watch items', () => {
    expect(smartStockVerdict(baseSummary, { ...baseIntelligenceSummary, low: 2 }, 'ready')).toBe('Ready with risk');
    expect(smartStockVerdict(baseSummary, { ...baseIntelligenceSummary, watch: 3 }, 'ready')).toBe('Ready with risk');
  });

  it('falls back to operational summary risk when intelligence tables are empty', () => {
    expect(smartStockVerdict({ ...baseSummary, outOfStockItems: 1 }, undefined)).toBe('Blocked today');
    expect(smartStockVerdict({ ...baseSummary, expiredItems: 1 }, undefined)).toBe('Blocked today');
    expect(smartStockVerdict({ ...baseSummary, damagedStockQuantity: 1 }, undefined)).toBe('Blocked today');
    expect(smartStockVerdict({ ...baseSummary, lowStockItems: 1 }, undefined)).toBe('Ready with risk');
  });

  it('shows ready when no risk signal exists and intelligence is ready', () => {
    expect(smartStockVerdict(baseSummary, baseIntelligenceSummary, 'ready')).toBe('Ready');
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
