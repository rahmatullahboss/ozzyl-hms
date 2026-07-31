import type { WorkCalendarDay, WeekdayName } from '../domain/work-calendar';
import { resolveWeekPattern } from '../domain/work-calendar';
import type { WeekendPolicyRecord, WorkCalendarRepository } from './ports';

export type WorkCalendarService = {
  evaluateDay(tenantId: string, date: string): Promise<WorkCalendarDay>;
  evaluateDays(tenantId: string, dates: readonly string[]): Promise<WorkCalendarDay[]>;
};

const WEEKDAYS: readonly WeekdayName[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

function parseCalendarDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError('date must be YYYY-MM-DD');
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new RangeError('date is invalid');
  }
  return parsed;
}

export function createWorkCalendarService(dependencies: {
  calendar: WorkCalendarRepository;
}): WorkCalendarService {
  const { calendar } = dependencies;
  const policyCache = new Map<string, Promise<WeekendPolicyRecord[]>>();

  function getPolicies(tenantId: string, year: number): Promise<WeekendPolicyRecord[]> {
    const key = `${tenantId}:${year}`;
    const cached = policyCache.get(key);
    if (cached) return cached;
    const pending = calendar.listWeekendPolicies(tenantId, year);
    policyCache.set(key, pending);
    return pending;
  }

  async function evaluateDay(tenantId: string, date: string): Promise<WorkCalendarDay> {
    const parsed = parseCalendarDate(date);
    const year = parsed.getUTCFullYear();
    const dayOfWeek = WEEKDAYS[parsed.getUTCDay()];
    const weekOfMonth = Math.floor((parsed.getUTCDate() - 1) / 7) + 1;
    const [policies, holiday] = await Promise.all([
      getPolicies(tenantId, year),
      calendar.getHoliday(tenantId, date),
    ]);

    const isConfiguredWeekend = policies.some((policy) =>
      policy.isActive
      && policy.weekday === dayOfWeek
      && resolveWeekPattern(policy.weekPattern, weekOfMonth),
    );

    return {
      date,
      dayOfWeek,
      isConfiguredWeekend,
      holiday,
      isWorkingDay: !isConfiguredWeekend && holiday === null,
    };
  }

  return {
    evaluateDay,
    evaluateDays(tenantId, dates) {
      return Promise.all(dates.map((date) => evaluateDay(tenantId, date)));
    },
  };
}
