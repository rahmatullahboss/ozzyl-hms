/**
 * Centralized formatters for currency and dates.
 *
 * - formatBDT(1234)        → "৳1,234"  (full precision)
 * - formatBDTLakh(150000)  → "৳1.5L"   (KPI card shorthand)
 * - formatDate(iso)        → "May 12, 2026" (en-BD, browser-locale independent)
 */

const BDT_FULL = new Intl.NumberFormat('en-BD', {
  maximumFractionDigits: 0,
});
const BDT_DATE = new Intl.DateTimeFormat('en-BD', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

export function formatBDT(amount: number | null | undefined): string {
  const n = amount ?? 0;
  return `৳${BDT_FULL.format(n)}`;
}

export function formatBDTLakh(amount: number | null | undefined): string {
  const n = amount ?? 0;
  if (n >= 100_000) {
    return `৳${(n / 100_000).toFixed(1)}L`;
  }
  return formatBDT(n);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return BDT_DATE.format(new Date(iso));
  } catch {
    return '-';
  }
}
