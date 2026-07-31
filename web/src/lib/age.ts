export type AgeParts = {
  years: number;
  months: number;
  days: number;
};

function parseLocalDate(dateString?: string | null): Date | null {
  if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
  const [year, month, day] = dateString.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function toNonNegativeInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

export function calculateAgePartsFromDateOfBirth(dateOfBirth?: string | null, referenceDate: Date = new Date()): AgeParts | null {
  const dob = parseLocalDate(dateOfBirth);
  if (!dob) return null;

  const today = startOfLocalDay(referenceDate);
  if (dob > today) return null;

  let years = today.getFullYear() - dob.getFullYear();
  let months = today.getMonth() - dob.getMonth();
  let days = today.getDate() - dob.getDate();

  if (days < 0) {
    months -= 1;
    days += daysInMonth(today.getFullYear(), today.getMonth() - 1);
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  return { years, months, days };
}

export function estimateDateOfBirthFromAgeParts(parts: Partial<AgeParts>, referenceDate: Date = new Date()): string | null {
  const years = toNonNegativeInteger(parts.years);
  const months = toNonNegativeInteger(parts.months);
  const days = toNonNegativeInteger(parts.days);

  const today = startOfLocalDay(referenceDate);
  const dayAdjusted = new Date(today);
  dayAdjusted.setDate(dayAdjusted.getDate() - days);

  const totalMonths = years * 12 + months;
  const rawMonth = dayAdjusted.getMonth() - totalMonths;
  const targetYear = dayAdjusted.getFullYear() + Math.floor(rawMonth / 12);
  const targetMonth = ((rawMonth % 12) + 12) % 12;
  const targetDay = Math.min(dayAdjusted.getDate(), daysInMonth(targetYear, targetMonth));

  const estimated = new Date(targetYear, targetMonth, targetDay);

  const yyyy = estimated.getFullYear();
  const mm = String(estimated.getMonth() + 1).padStart(2, '0');
  const dd = String(estimated.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatAgeFromParts(parts: AgeParts | null | undefined, locale: string = 'en-GB'): string {
  if (!parts) return '—';
  const years = Math.max(0, parts.years);
  const months = Math.max(0, parts.months);
  const days = Math.max(0, parts.days);
  const isBangla = locale === 'bn' || locale === 'bn-BD' || locale.startsWith('bn-');

  if (isBangla) {
    if (years >= 12) return `${years} বছর`;
    if (years >= 2) return months > 0 ? `${years} বছর ${months} মাস` : `${years} বছর`;
    if (years >= 1) return months > 0 ? `${years} বছর ${months} মাস` : `${years} বছর`;
    if (months >= 1) return days > 0 ? `${months} মাস ${days} দিন` : `${months} মাস`;
    return `${days} দিন`;
  }

  if (years >= 12) return `${years}Y`;
  if (years >= 2) return months > 0 ? `${years}Y ${months}M` : `${years}Y`;
  if (years >= 1) return months > 0 ? `${years}Y ${months}M` : `${years}Y`;
  if (months >= 1) return days > 0 ? `${months}M ${days}D` : `${months}M`;
  return `${days}D`;
}

export function formatAgeFromDateOfBirth(dateOfBirth?: string | null, locale: string = 'en-GB', referenceDate: Date = new Date()): string {
  return formatAgeFromParts(calculateAgePartsFromDateOfBirth(dateOfBirth, referenceDate), locale);
}
