import type { WeekendPolicyRecord, WorkCalendarRepository } from '../application/ports';
import type { WeekendWeekPattern, WeekdayName } from '../domain/work-calendar';

type DatabaseRow = Record<string, unknown>;

const WEEK_PATTERN_MAP: Record<string, WeekendWeekPattern> = {
  every: 'every',
  first: '1st',
  second: '2nd',
  third: '3rd',
  fourth: '4th',
  fifth: '5th',
  first_and_third: '1st_3rd',
  second_and_fourth: '2nd_4th',
  '1st': '1st',
  '2nd': '2nd',
  '3rd': '3rd',
  '4th': '4th',
  '5th': '5th',
  '1st_3rd': '1st_3rd',
  '2nd_4th': '2nd_4th',
};

function stringValue(value: unknown, fallback = ''): string {
  return value === null || value === undefined ? fallback : String(value);
}

function booleanValue(value: unknown, fallback = false): boolean {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value === '1' || value === 'true';
}

function mapWeekendPolicy(row: DatabaseRow): WeekendPolicyRecord | null {
  const weekday = stringValue(row.day_of_week).toLowerCase() as WeekdayName;
  const weekPattern = WEEK_PATTERN_MAP[stringValue(row.week_pattern).toLowerCase()];
  if (!weekPattern) return null;
  if (!['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].includes(weekday)) {
    return null;
  }
  return {
    weekday,
    weekPattern,
    isActive: booleanValue(row.is_active, true),
  };
}

export function createD1WorkCalendarRepository(db: D1Database): WorkCalendarRepository {
  return {
    async listWeekendPolicies(tenantId, year) {
      const { results } = await db.prepare(`
        SELECT day_of_week, week_pattern, is_active
        FROM hr_weekend_policies
        WHERE CAST(tenant_id AS TEXT) = ?
          AND year = ?
          AND is_active = 1
        ORDER BY day_of_week
      `).bind(tenantId, year).all<DatabaseRow>();

      return (results ?? [])
        .map(mapWeekendPolicy)
        .filter((policy): policy is WeekendPolicyRecord => policy !== null);
    },

    async getHoliday(tenantId, date) {
      const row = await db.prepare(`
        SELECT id, holiday_name, holiday_type
        FROM hr_holidays
        WHERE CAST(tenant_id AS TEXT) = ?
          AND holiday_date = ?
          AND is_active = 1
        LIMIT 1
      `).bind(tenantId, date).first<DatabaseRow>();

      if (!row) return null;
      const type = stringValue(row.holiday_type, 'public');
      return {
        holidayId: Number(row.id),
        name: stringValue(row.holiday_name),
        type: type === 'optional' || type === 'restricted' ? type : 'public',
      };
    },
  };
}
