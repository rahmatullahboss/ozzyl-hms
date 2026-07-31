/**
 * Locale-aware formatting helpers for currency, dates, and date-times.
 *
 * All formatters read the current i18next language (en / bn) and use Intl.*
 * so the output matches the user's selected language:
 *   - en: "৳1,500.00"  (currency with thousand separators)
 *   - bn: "৳১,৫০০.০০" (Bengali numerals)
 *
 * Defaults to en-US / en-GB during tests where i18next isn't initialized.
 */
import i18n from './i18n';

type SupportedLocale = 'en' | 'bn';

const LOCALE_MAP: Record<SupportedLocale, string> = {
  en: 'en-GB',
  bn: 'bn-BD',
};

const CURRENCY_LOCALE_MAP: Record<SupportedLocale, string> = {
  en: 'en-GB',
  bn: 'bn-BD',
};

function getLocale(): string {
  try {
    const lng = i18n?.language;
    if (lng === 'bn' || lng?.startsWith('bn')) return LOCALE_MAP.bn;
    if (lng === 'en' || lng?.startsWith('en')) return LOCALE_MAP.en;
  } catch {
    // i18n not ready yet (e.g., in tests) — fall through to default
  }
  return LOCALE_MAP.en;
}

function normalizeAmPm(value: string): string {
  return value.replace(/\b(am|pm)\b/gi, (match) => match.toUpperCase());
}

function formatNumericDatePart(date: Date): string {
  return new Intl.DateTimeFormat(getLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Dhaka',
  }).format(date).replace(/\//g, '-');
}

function formatTimePart(date: Date): string {
  return normalizeAmPm(new Intl.DateTimeFormat(getLocale(), {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Dhaka',
  }).format(date));
}

function parseDisplayDate(date: string | Date): Date {
  if (date instanceof Date) return date;
  const raw = String(date).trim();
  if (!raw) return new Date(NaN);
  const normalized = raw.replace(' ', 'T');
  const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  if (hasExplicitTimezone) return new Date(normalized);
  // Database naive timestamps (e.g. SQLite `datetime('now')`) are stored in UTC.
  // Append Z so the Date is parsed as UTC, then Asia/Dhaka formatting converts correctly.
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return new Date(`${normalized}T00:00:00Z`);
  return new Date(`${normalized}Z`);
}

function getCurrencyLocale(): string {
  try {
    const lng = i18n?.language;
    if (lng === 'bn' || lng?.startsWith('bn')) return CURRENCY_LOCALE_MAP.bn;
    if (lng === 'en' || lng?.startsWith('en')) return CURRENCY_LOCALE_MAP.en;
  } catch {
    // fall through
  }
  return CURRENCY_LOCALE_MAP.en;
}

/**
 * Format a numeric amount as currency in Taka (BDT).
 * Uses ৳ prefix + locale-appropriate number formatting.
 *
 * @param amount - Number to format
 * @param options.fractionDigits - Number of decimal places (default 2)
 * @returns e.g. "৳1,500.00" in en, "৳১,৫০০.০০" in bn
 */
export function formatCurrency(
  amount: number | null | undefined,
  options: { fractionDigits?: number } = {},
): string {
  const { fractionDigits = 2 } = options;
  const value = Number(amount ?? 0);
  if (Number.isNaN(value)) return '৳0.00';

  const formatted = new Intl.NumberFormat(getCurrencyLocale(), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);

  return `৳${formatted}`;
}

/**
 * Format a numeric amount as a plain number (no currency symbol).
 * Useful for quantities, counts, rates, percentages.
 */
export function formatNumber(
  value: number | null | undefined,
  options: Intl.NumberFormatOptions = {},
): string {
  const n = Number(value ?? 0);
  if (Number.isNaN(n)) return '0';
  return new Intl.NumberFormat(getLocale(), options).format(n);
}

/**
 * Format a percentage value.
 * @param value - Percentage as a number (e.g., 23.5 for 23.5%)
 * @param fractionDigits - Default 1
 */
export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  const n = Number(value ?? 0);
  if (Number.isNaN(n)) return '0%';
  return `${new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n)}%`;
}

/**
 * Format a date as a numeric day-month-year string (e.g. "11-06-2026" in en,
 * "১১-০৬-২০২৬" in bn).
 */
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = parseDisplayDate(date);
  if (Number.isNaN(d.getTime())) return '—';
  return formatNumericDatePart(d);
}

/**
 * Format a date as a long date string with weekday.
 * (e.g. "Thursday, 11-06-2026" in en, "বৃহস্পতিবার, ১১-০৬-২০২৬" in bn)
 */
export function formatDateLong(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = parseDisplayDate(date);
  if (Number.isNaN(d.getTime())) return '—';
  const weekday = new Intl.DateTimeFormat(getLocale(), {
    weekday: 'long',
    timeZone: 'Asia/Dhaka',
  }).format(d);
  return `${weekday}, ${formatNumericDatePart(d)}`;
}

/**
 * Format a date as a medium numeric day-month-year string (e.g. "11-06-2026" in en).
 */
export function formatDateMedium(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = parseDisplayDate(date);
  if (Number.isNaN(d.getTime())) return '—';
  return formatNumericDatePart(d);
}

/**
 * Format a date-time as a numeric day-month-year timestamp.
 * (e.g. "11-06-2026, 3:45 PM" in en, "১১-০৬-২০২৬, ৩:৪৫ PM" in bn)
 */
export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = parseDisplayDate(date);
  if (Number.isNaN(d.getTime())) return '—';
  return `${formatNumericDatePart(d)}, ${formatTimePart(d)}`;
}

/**
 * Format a date-time as a compact numeric day-month-year timestamp.
 * (e.g. "11-06-2026, 3:45 PM")
 */
export function formatDateTimeShort(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = parseDisplayDate(date);
  if (Number.isNaN(d.getTime())) return '—';
  return `${formatNumericDatePart(d)}, ${formatTimePart(d)}`;
}

/**
 * Format just the time portion of a date.
 * (e.g. "3:45 PM" in en, "৩:৪৫ PM" in bn)
 */
export function formatTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = parseDisplayDate(date);
  if (Number.isNaN(d.getTime())) return '—';
  return normalizeAmPm(new Intl.DateTimeFormat(getLocale(), {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Dhaka',
  }).format(d));
}

/**
 * Format a number as a duration in minutes, e.g. "30m" or "1h 30m".
 */
export function formatDurationMinutes(minutes: number | null | undefined): string {
  const m = Number(minutes ?? 0);
  if (Number.isNaN(m) || m === 0) return '0m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}
