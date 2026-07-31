import { getTodayGMT6 } from './date-utils';

export type ExecutivePeriodPreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | '7d'
  | '30d'
  | 'custom';

export interface ExecutiveDashboardPeriod {
  startDate: string;
  endDate: string;
  label: string;
  preset: ExecutivePeriodPreset;
}

export interface ResolveExecutiveDashboardPeriodInput {
  preset?: string | null;
  range?: string | null;
  date?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  today?: string;
}

const PRESETS = new Set<ExecutivePeriodPreset>([
  'today',
  'yesterday',
  'this_week',
  'this_month',
  'last_month',
  '7d',
  '30d',
  'custom',
]);

function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function dateToEpochDay(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function formatPeriod(
  startDate: string,
  endDate: string,
  preset: ExecutivePeriodPreset,
): ExecutiveDashboardPeriod {
  return {
    startDate,
    endDate,
    label: startDate === endDate ? endDate : `${startDate} → ${endDate}`,
    preset,
  };
}

function normalizePreset(input: ResolveExecutiveDashboardPeriodInput): ExecutivePeriodPreset | null {
  const explicitPreset = input.preset?.trim();
  if (explicitPreset) {
    return PRESETS.has(explicitPreset as ExecutivePeriodPreset)
      ? explicitPreset as ExecutivePeriodPreset
      : null;
  }

  const legacyRange = input.range?.trim();
  if (legacyRange) {
    return PRESETS.has(legacyRange as ExecutivePeriodPreset)
      ? legacyRange as ExecutivePeriodPreset
      : null;
  }

  if (input.date) return 'custom';
  return 'today';
}

export function resolveExecutiveDashboardPeriod(
  input: ResolveExecutiveDashboardPeriodInput,
): ExecutiveDashboardPeriod | null {
  const today = input.today ?? getTodayGMT6();
  if (!isIsoDate(today)) return null;

  const preset = normalizePreset(input);
  if (!preset) return null;

  const legacyDate = input.date?.trim();
  if (legacyDate) {
    if (!isIsoDate(legacyDate)) return null;
    return formatPeriod(legacyDate, legacyDate, 'custom');
  }

  if (preset === 'custom') {
    const startDate = input.startDate?.trim();
    const endDate = input.endDate?.trim();
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) return null;
    if (startDate > endDate) return null;
    const inclusiveDays = dateToEpochDay(endDate) - dateToEpochDay(startDate) + 1;
    if (inclusiveDays < 1 || inclusiveDays > 366) return null;
    return formatPeriod(startDate, endDate, preset);
  }

  if (preset === 'today') return formatPeriod(today, today, preset);
  if (preset === 'yesterday') {
    const yesterday = addDays(today, -1);
    return formatPeriod(yesterday, yesterday, preset);
  }
  if (preset === '7d') return formatPeriod(addDays(today, -6), today, preset);
  if (preset === '30d') return formatPeriod(addDays(today, -29), today, preset);

  const [year, month] = today.split('-').map(Number);
  if (preset === 'this_week') {
    const dayOfWeek = new Date(`${today}T00:00:00Z`).getUTCDay();
    const mondayOffset = (dayOfWeek + 6) % 7;
    return formatPeriod(addDays(today, -mondayOffset), today, preset);
  }
  if (preset === 'this_month') {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    return formatPeriod(startDate, today, preset);
  }

  const previousMonthLastDay = new Date(Date.UTC(year, month - 1, 0));
  const previousYear = previousMonthLastDay.getUTCFullYear();
  const previousMonth = previousMonthLastDay.getUTCMonth() + 1;
  const startDate = `${previousYear}-${String(previousMonth).padStart(2, '0')}-01`;
  const endDate = previousMonthLastDay.toISOString().slice(0, 10);
  return formatPeriod(startDate, endDate, 'last_month');
}
