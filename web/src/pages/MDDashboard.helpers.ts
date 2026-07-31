import { formatCurrency } from '../lib/format';
import {
  rangePendingApprovalDateWindow,
  type PendingApprovalDateWindow,
  type PendingApprovalRange,
} from '../lib/pendingApprovalDateWindow';
import type { DashboardRange } from '../types/executiveDashboard';

export type { DashboardRange } from '../types/executiveDashboard';

/** Sentinel key used in the aggregation result for staff with no department. */
export const UNASSIGNED_KEY = '__unassigned__';

export interface StaffLike {
  id: number;
  department?: string;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

/** Build the shared executive dashboard query string. */
export function executiveDateParams(
  range: DashboardRange,
  startDate: string,
  endDate: string,
): string {
  const params = new URLSearchParams();
  params.set('preset', range);

  if (range === 'custom') {
    const normalizedStart = startDate.trim();
    const normalizedEnd = endDate.trim();
    if (!isIsoDate(normalizedStart) || !isIsoDate(normalizedEnd) || normalizedStart > normalizedEnd) {
      return '';
    }
    params.set('startDate', normalizedStart);
    params.set('endDate', normalizedEnd);
  }

  return `?${params.toString()}`;
}

/**
 * Compatibility wrapper for the existing MD dashboard while its callers migrate
 * to the shared executive range contract.
 */
export function dateParamFor(range: DashboardRange, customEnd: string): string {
  if (range === 'custom') {
    const normalizedEnd = customEnd.trim();
    return isIsoDate(normalizedEnd) ? `?date=${encodeURIComponent(normalizedEnd)}` : '';
  }
  if (range === '7d' || range === '30d') {
    return `?range=${range}`;
  }
  return '';
}

export function pendingRequestWindowFor(
  range: PendingApprovalRange,
  customEnd: string,
  today: string,
): PendingApprovalDateWindow {
  return rangePendingApprovalDateWindow(range, customEnd, today);
}

/** Aggregate staff by department, sort by count desc, cap at topN. */
export function aggregateStaffByDepartment<T extends StaffLike>(
  staff: T[],
  topN: number = 5,
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const s of staff) {
    const raw = s.department ?? '';
    const key = raw.trim().length > 0 ? raw : UNASSIGNED_KEY;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);
}

export function computeTodayProfit(todayIncome: number, todayExpenses: number): number {
  return todayIncome - todayExpenses;
}

export function profitColor(profit: number): string {
  return profit >= 0 ? 'text-[var(--color-primary)]' : 'text-red-600';
}

export function formatMonthlyProfit(profit: number, margin: string, fractionDigits = 0): string {
  return `${formatCurrency(profit, { fractionDigits })} (${margin}%)`;
}
