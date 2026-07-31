import { describe, expect, it } from 'vitest';
import {
  averageDailyUsage,
  buildItemSnapshot,
  buildRecommendationForSnapshot,
  classifyDashboardStatus,
  summarizeStockLots,
} from '../../src/lib/inventory-intelligence/recompute';

describe('inventory intelligence recompute rules', () => {
  it('excludes expired, rejected, blocked, reserved and damaged stock from usable stock', () => {
    const summary = summarizeStockLots([
      { AvailableQuantity: 100, QCStatus: 'accepted', StockStatus: 'available', ExpiryDate: '2026-08-01' },
      { AvailableQuantity: 50, QCStatus: 'rejected', StockStatus: 'available', ExpiryDate: '2026-08-01' },
      { AvailableQuantity: 20, QCStatus: 'accepted', StockStatus: 'blocked', ExpiryDate: '2026-08-01' },
      { AvailableQuantity: 30, QCStatus: 'accepted', StockStatus: 'available', ExpiryDate: '2026-06-01' },
      { AvailableQuantity: 40, QCStatus: 'accepted', StockStatus: 'available', ExpiryDate: '2026-08-01', ReservedQuantity: 10, DamagedQuantity: 5, BlockedQuantity: 5 },
    ], '2026-07-05');

    expect(summary).toEqual({ currentStock: 240, usableStock: 120, blockedStock: 120 });
  });

  it('treats after-open expiry as unusable even when batch expiry is valid', () => {
    const summary = summarizeStockLots([
      { AvailableQuantity: 10, QCStatus: 'accepted', StockStatus: 'available', ExpiryDate: '2026-09-01', AfterOpenExpiryDate: '2026-07-01' },
      { AvailableQuantity: 12, QCStatus: 'accepted', StockStatus: 'available', ExpiryDate: '2026-09-01', AfterOpenExpiryDate: '2026-07-20' },
    ], '2026-07-05');

    expect(summary.usableStock).toBe(12);
    expect(summary.blockedStock).toBe(10);
  });

  it('calculates fixed-window daily usage from demand rows', () => {
    const avg7 = averageDailyUsage([
      { demand_date: '2026-07-05', consumed_qty: 14 },
      { demand_date: '2026-07-01', consumed_qty: 7 },
      { demand_date: '2026-06-20', consumed_qty: 99 },
    ], '2026-07-05', 7);

    expect(avg7).toBe(3);
  });

  it('builds a deterministic stockout snapshot using usable stock, usage, lead time and inbound quantities', () => {
    const snapshot = buildItemSnapshot({
      tenantId: 'tenant-1',
      inventoryItemId: 101,
      itemName: 'CBC Diluent',
      itemCode: 'CBC-DIL',
      today: '2026-07-05',
      currentStock: 40,
      usableStock: 30,
      blockedStock: 10,
      demandRows: [
        { demand_date: '2026-07-05', consumed_qty: 10 },
        { demand_date: '2026-07-04', consumed_qty: 10 },
        { demand_date: '2026-07-03', consumed_qty: 10 },
      ],
      leadTimeDays: 2,
      safetyStockDays: 1,
      maxStockQuantity: 100,
      openPrQty: 10,
      openPoQty: 5,
    });

    expect(snapshot.avgDailyUsage30d).toBe(1);
    expect(snapshot.reorderPoint).toBe(3);
    expect(snapshot.daysOfCover).toBe(30);
    expect(snapshot.suggestedOrderQty).toBe(55);
    expect(snapshot.recommendationStatus).toBe('ok');
    expect(snapshot.estimatedStockoutDate).toBe('2026-08-04');
  });

  it('builds actionable recommendation cards for stockout and low snapshots but not ok snapshots', () => {
    const stockout = buildItemSnapshot({
      tenantId: 'tenant-1', inventoryItemId: 1, itemName: 'CBC Kit', today: '2026-07-05',
      currentStock: 0, usableStock: 0, blockedStock: 0, demandRows: [{ demand_date: '2026-07-05', consumed_qty: 5 }],
      leadTimeDays: 7, safetyStockDays: 7, maxStockQuantity: 50,
    });
    const low = buildItemSnapshot({
      tenantId: 'tenant-1', inventoryItemId: 2, itemName: 'EDTA Tube', today: '2026-07-05',
      currentStock: 6, usableStock: 6, blockedStock: 0, demandRows: [{ demand_date: '2026-07-05', consumed_qty: 30 }],
      leadTimeDays: 7, safetyStockDays: 7, maxStockQuantity: 100,
    });
    const ok = buildItemSnapshot({
      tenantId: 'tenant-1', inventoryItemId: 3, itemName: 'Gloves', today: '2026-07-05',
      currentStock: 500, usableStock: 500, blockedStock: 0, demandRows: [],
      leadTimeDays: 7, safetyStockDays: 7, maxStockQuantity: 0,
    });

    expect(buildRecommendationForSnapshot(stockout)).toMatchObject({ severity: 'critical', suggested_action: 'create_purchase_order' });
    expect(buildRecommendationForSnapshot(low)).toMatchObject({ severity: 'warning', suggested_action: 'create_purchase_order' });
    expect(buildRecommendationForSnapshot(ok)).toBeNull();
  });

  it('classifies dashboard status as setup needed, stale, or ready', () => {
    expect(classifyDashboardStatus({ snapshotCount: 0, lastComputedAt: null, now: '2026-07-05T00:00:00.000Z' })).toBe('not_configured');
    expect(classifyDashboardStatus({ snapshotCount: 2, lastComputedAt: '2026-07-01T00:00:00.000Z', now: '2026-07-05T00:00:00.000Z' })).toBe('stale');
    expect(classifyDashboardStatus({ snapshotCount: 2, lastComputedAt: '2026-07-05T00:00:00.000Z', now: '2026-07-05T12:00:00.000Z' })).toBe('ready');
  });
});
