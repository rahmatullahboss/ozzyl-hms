export type PatientAgeBucket =
  | '0_5'
  | '6_17'
  | '18_30'
  | '31_45'
  | '46_60'
  | '61_plus'
  | 'unknown';

export const PATIENT_AGE_BUCKET_ORDER: readonly PatientAgeBucket[] = [
  '0_5',
  '6_17',
  '18_30',
  '31_45',
  '46_60',
  '61_plus',
  'unknown',
] as const;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function parseIsoDate(value: unknown): CalendarDate | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || year < 1 || year > 9999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function anniversaryForYear(birth: CalendarDate, year: number): Pick<CalendarDate, 'month' | 'day'> {
  if (birth.month === 2 && birth.day === 29 && !isLeapYear(year)) {
    return { month: 2, day: 28 };
  }
  return { month: birth.month, day: birth.day };
}

export function calculateCompletedAgeAtService(
  dateOfBirth: unknown,
  serviceDate: unknown,
): number | null {
  const birth = parseIsoDate(dateOfBirth);
  const service = parseIsoDate(serviceDate);
  if (!birth || !service) return null;

  const birthKey = birth.year * 10_000 + birth.month * 100 + birth.day;
  const serviceKey = service.year * 10_000 + service.month * 100 + service.day;
  if (birthKey > serviceKey) return null;

  const anniversary = anniversaryForYear(birth, service.year);
  const serviceBeforeAnniversary = service.month < anniversary.month
    || (service.month === anniversary.month && service.day < anniversary.day);
  const age = service.year - birth.year - (serviceBeforeAnniversary ? 1 : 0);
  return Number.isInteger(age) && age >= 0 ? age : null;
}

export function bucketPatientAge(age: unknown): PatientAgeBucket {
  if (typeof age !== 'number' || !Number.isInteger(age) || age < 0) return 'unknown';
  if (age <= 5) return '0_5';
  if (age <= 17) return '6_17';
  if (age <= 30) return '18_30';
  if (age <= 45) return '31_45';
  if (age <= 60) return '46_60';
  return '61_plus';
}

export function resolvePatientAgeAtService(
  dateOfBirth: unknown,
  serviceDate: unknown,
): { ageAtService: number | null; bucket: PatientAgeBucket } {
  const ageAtService = calculateCompletedAgeAtService(dateOfBirth, serviceDate);
  return {
    ageAtService,
    bucket: bucketPatientAge(ageAtService),
  };
}
