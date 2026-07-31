export type PendingApprovalRange = 'today' | '7d' | '30d' | 'custom';

export interface PendingApprovalDateWindow {
  from: string;
  to: string;
}

function shiftDateOnly(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function singlePendingApprovalDateWindow(date: string): PendingApprovalDateWindow {
  return { from: date, to: date };
}

export function rangePendingApprovalDateWindow(
  range: PendingApprovalRange,
  customEnd: string,
  today: string,
): PendingApprovalDateWindow {
  if (range === 'custom' && customEnd.trim()) {
    return singlePendingApprovalDateWindow(customEnd.trim());
  }
  if (range === '7d') {
    return { from: shiftDateOnly(today, -6), to: today };
  }
  if (range === '30d') {
    return { from: shiftDateOnly(today, -29), to: today };
  }
  return singlePendingApprovalDateWindow(today);
}
