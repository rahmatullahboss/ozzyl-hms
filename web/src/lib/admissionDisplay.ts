import { formatDisplayDate, formatDisplayDateTime } from './date-utils';

export function formatAdmissionDisplay(value?: string | null): string {
  if (!value) return '—';
  const formatted = /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? formatDisplayDate(value)
    : formatDisplayDateTime(value);
  return formatted.replace(/\b(am|pm)\b/gi, (period) => period.toUpperCase());
}
