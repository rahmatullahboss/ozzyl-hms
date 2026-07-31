import { describe, expect, it } from 'vitest';
import {
  calculateDaysOfCover,
  calculateReorderPoint,
  calculateSuggestedOrderQuantity,
  classifyDemandTrend,
  classifyRecommendationStatus,
  estimateStockoutDate,
} from '../../src/lib/inventory-intelligence/forecast';

describe('inventory intelligence forecast calculations', () => {
  it('calculates days of cover from usable stock and average daily usage', () => {
    expect(calculateDaysOfCover(35, 7)).toBe(5);
    expect(calculateDaysOfCover(35, 0)).toBeNull();
    expect(calculateDaysOfCover(0, 7)).toBe(0);
  });

  it('calculates reorder point as lead-time demand plus safety stock demand', () => {
    expect(calculateReorderPoint({ avgDailyUsage: 9, leadTimeDays: 5, safetyStockDays: 3 })).toBe(72);
  });

  it('suggests order quantity using max stock, reorder point, and open PR/PO coverage', () => {
    expect(calculateSuggestedOrderQuantity({
      usableStock: 25,
      maxStockQuantity: 200,
      reorderPoint: 90,
      openPrQty: 20,
      openPoQty: 30,
    })).toBe(125);
  });

  it('falls back to reorder-point gap when max stock is not configured', () => {
    expect(calculateSuggestedOrderQuantity({
      usableStock: 20,
      maxStockQuantity: 0,
      reorderPoint: 80,
      openPrQty: 10,
      openPoQty: 5,
    })).toBe(45);
  });

  it('classifies demand trends without AI heuristics', () => {
    expect(classifyDemandTrend({ avg7: 0, avg30: 0 })).toBe('no_data');
    expect(classifyDemandTrend({ avg7: 4, avg30: 0 })).toBe('new');
    expect(classifyDemandTrend({ avg7: 14, avg30: 10 })).toBe('up');
    expect(classifyDemandTrend({ avg7: 6, avg30: 10 })).toBe('down');
    expect(classifyDemandTrend({ avg7: 10, avg30: 10 })).toBe('stable');
  });

  it('estimates stockout date from a fixed current date', () => {
    expect(estimateStockoutDate({ usableStock: 30, avgDailyUsage: 10, today: '2026-07-05' })).toBe('2026-07-08');
    expect(estimateStockoutDate({ usableStock: 30, avgDailyUsage: 0, today: '2026-07-05' })).toBeNull();
  });

  it('classifies recommendation status for stockout, low, watch and ok states', () => {
    expect(classifyRecommendationStatus({ usableStock: 0, reorderPoint: 10, daysOfCover: 0, leadTimeDays: 7 })).toBe('stockout');
    expect(classifyRecommendationStatus({ usableStock: 5, reorderPoint: 10, daysOfCover: 2, leadTimeDays: 7 })).toBe('low');
    expect(classifyRecommendationStatus({ usableStock: 12, reorderPoint: 10, daysOfCover: 5, leadTimeDays: 7 })).toBe('watch');
    expect(classifyRecommendationStatus({ usableStock: 30, reorderPoint: 10, daysOfCover: 20, leadTimeDays: 7 })).toBe('ok');
  });
});
