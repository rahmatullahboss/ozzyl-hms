export type WeekdayName =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

export type WeekendWeekPattern =
  | 'every'
  | '1st'
  | '2nd'
  | '3rd'
  | '4th'
  | '5th'
  | '1st_3rd'
  | '2nd_4th';

export type WorkCalendarDay = {
  date: string;
  dayOfWeek: WeekdayName;
  isConfiguredWeekend: boolean;
  holiday: null | {
    holidayId: number;
    name: string;
    type: 'public' | 'optional' | 'restricted';
  };
  isWorkingDay: boolean;
};

export function resolveWeekPattern(pattern: WeekendWeekPattern, weekOfMonth: number): boolean {
  if (!Number.isInteger(weekOfMonth) || weekOfMonth < 1 || weekOfMonth > 5) return false;
  if (pattern === 'every') return true;
  if (pattern === '1st_3rd') return weekOfMonth === 1 || weekOfMonth === 3;
  if (pattern === '2nd_4th') return weekOfMonth === 2 || weekOfMonth === 4;
  return Number.parseInt(pattern, 10) === weekOfMonth;
}
