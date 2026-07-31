export type InventoryIntelligenceDashboardStatus = 'not_configured' | 'stale' | 'ready';

export interface InventoryDashboardSummaryForHelpers {
  lowStockItems: number;
  outOfStockItems: number;
  expiringSoonItems: number;
  expiredItems: number;
  damagedStockQuantity: number;
}

export interface InventoryIntelligenceSummaryForHelpers {
  stockout: number;
  low: number;
  watch: number;
}

export function money(value: number) {
  return `৳${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function alertClass(severity: string) {
  if (severity === 'danger') return 'border-red-200 bg-red-50 text-red-700';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-blue-200 bg-blue-50 text-blue-700';
}

export function urgentStockCount(summary: InventoryDashboardSummaryForHelpers) {
  return Number(summary.outOfStockItems || 0) + Number(summary.expiredItems || 0) + Number(summary.damagedStockQuantity || 0);
}

export function stockHealthLabel(summary: InventoryDashboardSummaryForHelpers) {
  const urgent = urgentStockCount(summary);
  if (urgent > 0) return `${urgent} urgent stock issue${urgent === 1 ? '' : 's'}`;
  if (summary.lowStockItems > 0 || summary.expiringSoonItems > 0) return 'Watch low stock and expiry';
  return 'Stock health looks good';
}

export function formatAlertType(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function smartStockVerdict(
  summary: InventoryDashboardSummaryForHelpers,
  intelligence?: InventoryIntelligenceSummaryForHelpers,
  status?: InventoryIntelligenceDashboardStatus,
) {
  if (status === 'not_configured') return 'Setup needed';
  if (status === 'stale') return 'Refresh needed';
  if ((intelligence?.stockout ?? 0) > 0 || urgentStockCount(summary) > 0) return 'Blocked today';
  if ((intelligence?.low ?? 0) > 0 || (intelligence?.watch ?? 0) > 0 || summary.lowStockItems > 0 || summary.expiringSoonItems > 0) {
    return 'Ready with risk';
  }
  return 'Ready';
}

export function formatSuggestedOrderQty(value?: number | null) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return 'No draft qty yet';
  return `${numericValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} units`;
}

export function formatRecommendationAction(action?: string) {
  if (!action) return 'Review';
  return formatAlertType(action);
}

export function recommendationToneClass(severity?: string | null) {
  if (severity === 'critical') return 'border-red-200 bg-red-50 text-red-700';
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-sky-200 bg-sky-50 text-sky-700';
}

export function formatComputedAt(value?: string | null) {
  if (!value) return 'Not computed yet';
  return value.slice(0, 16).replace('T', ' ');
}

export function intelligenceStatusCopy(status?: InventoryIntelligenceDashboardStatus) {
  if (status === 'not_configured') return 'Run recompute once to activate smart stock signals.';
  if (status === 'stale') return 'Stock brain is stale; refresh before purchase decisions.';
  return 'Stock brain is up to date.';
}
