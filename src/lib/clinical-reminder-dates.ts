import { getTodayGMT6 } from './date-utils';

function shiftIsoDate(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function isMissedOrOverdueFollowUp(
  status: string,
  appointmentDate: string,
  today: string = getTodayGMT6(),
): boolean {
  const normalizedStatus = status.toLowerCase();
  return ['no_show', 'cancelled'].includes(normalizedStatus)
    || (normalizedStatus === 'scheduled' && Boolean(appointmentDate) && appointmentDate < today);
}

export function isMedicationEndingSoon(
  endDate: string,
  today: string = getTodayGMT6(),
  reviewWindowDays = 7,
): boolean {
  return Boolean(endDate) && endDate <= shiftIsoDate(today, reviewWindowDays);
}
