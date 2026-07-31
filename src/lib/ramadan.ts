/**
 * Ramadan Utilities
 *
 * Detects Ramadan dates, provides Sehri/Iftar times,
 * and adjusts meal tracking for fasting.
 *
 * Uses approximate Hijri calendar conversion.
 * For production, use a proper Islamic calendar API.
 */

interface RamadanInfo {
  isRamadan: boolean;
  dayOfRamadan?: number;
  daysRemaining?: number;
  sehriTime?: string;
  iftarTime?: string;
}

// Approximate Ramadan dates (Gregorian) — updated yearly
// 2026: ~Feb 18 to ~Mar 19
// 2027: ~Feb 7 to ~Mar 9
const RAMADAN_DATES: Array<{ year: number; start: string; end: string }> = [
  { year: 2026, start: '2026-02-18', end: '2026-03-19' },
  { year: 2027, start: '2027-02-07', end: '2027-03-09' },
  { year: 2028, start: '2028-01-28', end: '2028-02-26' },
];

// Approximate prayer times for Dhaka (adjust seasonally)
const DHAKA_TIMES: Record<number, { sehri: string; iftar: string }> = {
  1:  { sehri: '05:10', iftar: '17:50' },
  2:  { sehri: '05:05', iftar: '17:55' },
  3:  { sehri: '04:55', iftar: '18:05' },
  4:  { sehri: '04:45', iftar: '18:10' },
  5:  { sehri: '04:35', iftar: '18:15' },
  6:  { sehri: '04:30', iftar: '18:20' },
  7:  { sehri: '04:25', iftar: '18:25' },
  8:  { sehri: '04:20', iftar: '18:30' },
  9:  { sehri: '04:15', iftar: '18:35' },
  10: { sehri: '04:10', iftar: '18:40' },
  11: { sehri: '04:05', iftar: '18:40' },
  12: { sehri: '04:00', iftar: '18:45' },
};

export function getRamadanInfo(dateStr?: string): RamadanInfo {
  const date = dateStr ? new Date(dateStr) : new Date();
  const todayStr = date.toISOString().slice(0, 10);

  let match: { start: string; end: string } | null = null;

  for (const r of RAMADAN_DATES) {
    if (todayStr >= r.start && todayStr <= r.end) {
      match = r;
      break;
    }
  }

  // Dynamic fallback for years > 2028
  if (!match) {
    const year = date.getFullYear();
    if (year > 2028) {
      // Approximate: shifts back ~11 days per Gregorian year from 2028
      const yearsDiff = year - 2028;
      const daysShift = yearsDiff * 11;
      const estimatedStart = new Date('2028-01-28');
      estimatedStart.setDate(estimatedStart.getDate() - daysShift);
      const estimatedEnd = new Date(estimatedStart);
      estimatedEnd.setDate(estimatedEnd.getDate() + 29);
      
      const estStartStr = estimatedStart.toISOString().slice(0, 10);
      const estEndStr = estimatedEnd.toISOString().slice(0, 10);
      
      if (todayStr >= estStartStr && todayStr <= estEndStr) {
        match = { start: estStartStr, end: estEndStr };
      }
    }
  }

  if (match) {
    const startDate = new Date(match.start);
    const dayOfRamadan = Math.ceil((date.getTime() - startDate.getTime()) / 86400000) + 1;
    const endDate = new Date(match.end);
    const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - date.getTime()) / 86400000));

    // Get month to determine approximate times
    const month = date.getMonth() + 1;
    const times = DHAKA_TIMES[month] || { sehri: '04:30', iftar: '18:15' };

    return {
      isRamadan: true,
      dayOfRamadan,
      daysRemaining,
      sehriTime: times.sehri,
      iftarTime: times.iftar,
    };
  }

  return { isRamadan: false };
}

export function getIftarCountdown(): { hours: number; minutes: number; seconds: number } | null {
  const info = getRamadanInfo();
  if (!info.isRamadan || !info.iftarTime) return null;

  const now = new Date();
  const [h, m] = info.iftarTime.split(':').map(Number);
  const iftar = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);

  const diff = iftar.getTime() - now.getTime();
  if (diff <= 0) return null;

  return {
    hours: Math.floor(diff / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
  };
}

export const RAMADAN_MEAL_TYPES = [
  { key: 'sehri', bn: 'সেহেরী', en: 'Sehri' },
  { key: 'iftar', bn: 'ইফতার', en: 'Iftar' },
  { key: 'dinner', bn: 'রাতের খাবার', en: 'Dinner' },
] as const;
