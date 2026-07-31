/**
 * Date utilities for Ozzyl HMS
 * Standardizing on GMT+6 (Bangladesh Time)
 */

function normalizeAmPm(value: string): string {
  return value.replace(/\b(am|pm)\b/gi, (match) => match.toUpperCase());
}

function formatNumericDateGMT6(date: Date, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    timeZone: 'Asia/Dhaka',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date).replace(/\//g, '-');
}

export function getNowGMT6(): Date {
  // Use the system date but adjust for display if needed. 
  // However, most modern browsers handle timezone conversion correctly if we provide a UTC string.
  // For generating "now" in BD time:
  return new Date(new Date().toLocaleString("en-GB", { timeZone: "Asia/Dhaka" }));
}

export function getTodayGMT6(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { // en-CA gives YYYY-MM-DD
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(now);
}

export function parseDatabaseTimestampAsUtc(value?: string | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = String(value).trim();
  if (!raw) return null;
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized = raw.replace(' ', 'T');
  const date = new Date(hasTimezone ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatAuditDateTimeGMT6(dateStr?: string | Date | null, locale = 'en'): string {
  const date = parseDatabaseTimestampAsUtc(dateStr);
  if (!date) return '—';
  const time = normalizeAmPm(date.toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    timeZone: 'Asia/Dhaka',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }));
  return `${formatNumericDateGMT6(date, locale)}, ${time}`;
}

export function getAuditDateKeyGMT6(dateStr?: string | Date | null): string {
  const date = parseDatabaseTimestampAsUtc(dateStr);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatDisplayDate(dateStr?: string | Date | null): string {
  if (!dateStr) return '—';

  try {
    if (typeof dateStr === 'string') {
      const match = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const [, year, month, day] = match;
        return `${day}-${month}-${year}`;
      }
    }

    const date = dateStr instanceof Date ? dateStr : new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '—';

    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dhaka',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date).replace(/\//g, '-');
  } catch {
    return '—';
  }
}

export function formatDisplayDateTime(dateStr?: string | Date | null): string {
  const formatted = formatDateTimeGMT6(dateStr);
  return formatted;
}

export function formatDateTimeGMT6(dateStr?: string | Date | null): string {
  if (!dateStr) return '—';
  
  try {
    if (typeof dateStr === 'string' && !dateStr.includes('Z') && !dateStr.includes('+') && !/ [A-Z]{3,4}$/.test(dateStr)) {
      const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
      if (match) {
        const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
        if (!match[4]) return `${day}-${month}-${year}`;
        const hourNum = Number(hour);
        const hour12 = hourNum % 12 || 12;
        const period = hourNum >= 12 ? 'PM' : 'AM';
        return `${day}-${month}-${year} ${String(hour12).padStart(2, '0')}:${minute}:${second} ${period}`;
      }
    }

    let date: Date;
    
    if (typeof dateStr === 'string') {
      date = new Date(dateStr);
    } else {
      date = dateStr;
    }
    
    // Check if it's a valid date
    if (isNaN(date.getTime())) {
      return '—';
    }

    return date.toLocaleString('en-GB', { 
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).replace(',', '').replace(/\//g, '-');
  } catch (e) {
    return '—';
  }
}

export function getFullTimestampGMT6(): string {
  return formatDateTimeGMT6(new Date());
}

/**
 * Returns the start and end date for a given range in GMT+6
 */
export function getDateRangeGMT6(range: '30d' | '90d' | 'ytd' | 'today'): { startDate: string; endDate: string } {
  const today = getTodayGMT6();
  
  if (range === 'today') {
    return { startDate: today, endDate: today };
  }

  const now = new Date();
  const start = new Date(now);
  
  if (range === '30d') {
    start.setDate(start.getDate() - 30);
  } else if (range === '90d') {
    start.setDate(start.getDate() - 90);
  } else {
    return { startDate: `${new Date().getFullYear()}-01-01`, endDate: today };
  }
  
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  return { startDate: formatter.format(start), endDate: today };
}

/**
 * Formats a date string or Date object to YYYY-MM-DD in GMT+6
 */
export function formatToTodayGMT6(date?: Date | string): string {
  if (!date) return getTodayGMT6();
  const d = typeof date === 'string' ? new Date(date) : date;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(d);
}

/**
 * Format a Date object to YYYY-MM-DD string
 */
export function formatDateForAPI(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

/**
 * Add days to a date string (YYYY-MM-DD)
 */
export function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00');
  date.setDate(date.getDate() + days);
  return formatDateForAPI(date);
}

/**
 * Get array of 7 dates starting from the week containing the given date
 */
export function getWeekDates(dateStr: string): string[] {
  const date = new Date(dateStr + 'T00:00:00');
  const dayOfWeek = date.getDay(); // 0 = Sunday
  const diffToSaturday = (dayOfWeek - 6 + 7) % 7; // Saturday is day 6
  const saturday = new Date(date);
  saturday.setDate(date.getDate() - diffToSaturday);

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(saturday);
    d.setDate(saturday.getDate() + i);
    dates.push(formatDateForAPI(d));
  }
  return dates;
}
