import type { DashboardRange } from '../../types/executiveDashboard';

export type DashboardPeriod = {
  startDate: string;
  endDate: string;
  label: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isDashboardIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function assertDashboardPeriod(period: DashboardPeriod): DashboardPeriod {
  if (!isDashboardIsoDate(period.startDate) || !isDashboardIsoDate(period.endDate)) {
    throw new Error('Dashboard period dates must use YYYY-MM-DD.');
  }
  if (period.startDate > period.endDate) {
    throw new Error('Dashboard period startDate must not be after endDate.');
  }
  return period;
}

export function singleDayPeriod(date: string): DashboardPeriod {
  return assertDashboardPeriod({ startDate: date, endDate: date, label: date });
}

function shiftUtcDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function periodForRange(
  range: DashboardRange,
  customStart: string,
  customEnd: string,
  today: string,
): DashboardPeriod {
  if (!isDashboardIsoDate(today)) throw new Error('Dashboard today must use YYYY-MM-DD.');
  if (range === 'custom') {
    const startDate = customStart.trim();
    const endDate = customEnd.trim();
    return assertDashboardPeriod({ startDate, endDate, label: `${startDate} – ${endDate}` });
  }
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 1;
  const startDate = shiftUtcDate(today, -(days - 1));
  return { startDate, endDate: today, label: startDate === today ? today : `${startDate} – ${today}` };
}

export function dashboardPeriodQuery(period: DashboardPeriod): string {
  const valid = assertDashboardPeriod(period);
  return `?from=${encodeURIComponent(valid.startDate)}&to=${encodeURIComponent(valid.endDate)}`;
}

export function appendDashboardPeriod(path: string, period: DashboardPeriod): string {
  const valid = assertDashboardPeriod(period);
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}from=${encodeURIComponent(valid.startDate)}&to=${encodeURIComponent(valid.endDate)}`;
}
