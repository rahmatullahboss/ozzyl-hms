export type UtcIso = string & { readonly __utcIsoBrand: unique symbol };
export type BusinessDate = string & { readonly __businessDateBrand: unique symbol };

export type TimestampInput = string | number | Date;

const EXPLICIT_ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/i;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1] ?? 0;
}

function validateTimestampString(value: string): void {
  const match = EXPLICIT_ISO_TIMESTAMP.exec(value);
  if (!match) throw new RangeError('Timestamp string must be an explicit ISO timestamp with UTC or numeric offset');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offset = match[8].toUpperCase();

  if (
    month < 1
    || month > 12
    || day < 1
    || day > daysInMonth(year, month)
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    throw new RangeError('Timestamp contains an invalid calendar date or clock time');
  }

  if (offset !== 'Z') {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
      throw new RangeError('Timestamp contains an invalid numeric UTC offset');
    }
  }
}

function parseTimestamp(value: TimestampInput): Date {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('Timestamp number must be finite');
    if (!Number.isInteger(value)) throw new RangeError('Timestamp milliseconds must be an integer');
  }
  if (typeof value === 'string') validateTimestampString(value.trim());

  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new RangeError('Invalid timestamp');
  return parsed;
}

export function toUtcIso(value: TimestampInput = new Date()): UtcIso {
  return parseTimestamp(value).toISOString() as UtcIso;
}

/** Derives a calendar date in an IANA time zone from an explicit timestamp. */
export function deriveBusinessDate(utcIso: string, timeZone: string): BusinessDate {
  const instant = parseTimestamp(utcIso);
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch (error) {
    throw new RangeError(`Invalid IANA time zone: ${timeZone}`, { cause: error });
  }

  const parts = formatter.formatToParts(instant);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new RangeError(`Unable to derive business date for time zone: ${timeZone}`);

  return `${year}-${month}-${day}` as BusinessDate;
}
