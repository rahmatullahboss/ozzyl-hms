import type { DemandTrendLabel, RecommendationStatus } from './types';

export function roundTo(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function calculateDaysOfCover(usableStock: number, avgDailyUsage: number): number | null {
  const stock = Math.max(0, Number(usableStock || 0));
  const usage = Math.max(0, Number(avgDailyUsage || 0));
  if (usage === 0) return null;
  return roundTo(stock / usage, 2);
}

export function calculateReorderPoint(input: { avgDailyUsage: number; leadTimeDays: number; safetyStockDays: number }): number {
  const usage = Math.max(0, Number(input.avgDailyUsage || 0));
  const leadTime = Math.max(0, Number(input.leadTimeDays || 0));
  const safety = Math.max(0, Number(input.safetyStockDays || 0));
  return roundTo(usage * (leadTime + safety), 2);
}

export function calculateSuggestedOrderQuantity(input: { usableStock: number; maxStockQuantity?: number | null; reorderPoint: number; openPrQty?: number | null; openPoQty?: number | null }): number {
  const usableStock = Math.max(0, Number(input.usableStock || 0));
  const maxStockQuantity = Math.max(0, Number(input.maxStockQuantity || 0));
  const reorderPoint = Math.max(0, Number(input.reorderPoint || 0));
  const inboundQty = Math.max(0, Number(input.openPrQty || 0)) + Math.max(0, Number(input.openPoQty || 0));
  const maxGap = maxStockQuantity > 0 ? maxStockQuantity - usableStock - inboundQty : 0;
  const reorderGap = reorderPoint - usableStock - inboundQty;
  return roundTo(Math.max(maxGap, reorderGap, 0), 2);
}

export function classifyDemandTrend(input: { avg7: number; avg30: number }): DemandTrendLabel {
  const avg7 = Math.max(0, Number(input.avg7 || 0));
  const avg30 = Math.max(0, Number(input.avg30 || 0));
  if (avg7 === 0 && avg30 === 0) return 'no_data';
  if (avg30 === 0 && avg7 > 0) return 'new';
  if (avg30 > 0 && avg7 > avg30 * 1.3) return 'up';
  if (avg30 > 0 && avg7 < avg30 * 0.7) return 'down';
  return 'stable';
}

export function estimateStockoutDate(input: { usableStock: number; avgDailyUsage: number; today?: string | Date }): string | null {
  const days = calculateDaysOfCover(input.usableStock, input.avgDailyUsage);
  if (days === null) return null;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const base = input.today instanceof Date ? new Date(input.today) : new Date(`${today}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + Math.ceil(days));
  return base.toISOString().slice(0, 10);
}

export function classifyRecommendationStatus(input: { usableStock: number; reorderPoint: number; daysOfCover: number | null; leadTimeDays: number }): RecommendationStatus {
  const usableStock = Math.max(0, Number(input.usableStock || 0));
  const reorderPoint = Math.max(0, Number(input.reorderPoint || 0));
  const leadTimeDays = Math.max(0, Number(input.leadTimeDays || 0));
  if (usableStock <= 0) return 'stockout';
  if (reorderPoint > 0 && usableStock <= reorderPoint) return 'low';
  if (input.daysOfCover !== null && input.daysOfCover <= leadTimeDays) return 'watch';
  return 'ok';
}
