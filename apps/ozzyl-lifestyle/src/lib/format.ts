/**
 * Locale-aware formatting helpers for currency, dates, and date-times.
 *
 * Mirrors web/src/lib/format.ts (single source of truth lives in the web app;
 * this lifestyle fork is kept in sync to avoid silent drift).
 */
import i18n from './i18n';

type SupportedLocale = 'en' | 'bn';

const LOCALE_MAP: Record<SupportedLocale, string> = {
  en: 'en-US',
  bn: 'bn-BD',
};

const CURRENCY_LOCALE_MAP: Record<SupportedLocale, string> = {
  en: 'en-US',
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
  amount: number | null | undefined,
  options: { fractionDigits?: number } = {},
): string {
  const { fractionDigits = 0 } = options;
  const value = Number(amount ?? 0);
  if (Number.isNaN(value)) return '0';
  return new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  const v = Number(value ?? 0);
  if (Number.isNaN(v)) return '0%';
  return `${v.toFixed(fractionDigits)}%`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(getLocale());
}

export function formatDateLong(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(getLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatDateMedium(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(getLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(getLocale());
}

export function formatDateTimeShort(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(getLocale(), { dateStyle: 'short', timeStyle: 'short' });
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
}

export function formatDurationMinutes(minutes: number | null | undefined): string {
  const m = Number(minutes ?? 0);
  if (!Number.isFinite(m) || m < 0) return '0m';
  if (m < 60) return `${Math.round(m)}m`;
  const hours = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}
