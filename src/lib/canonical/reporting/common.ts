import { deriveBusinessDate } from '../time';

export interface CanonicalReportingPreparedStatement {
  bind(...values: unknown[]): CanonicalReportingPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface CanonicalReportingDatabase {
  prepare(sql: string): CanonicalReportingPreparedStatement;
}

export function exact(value: string, label: string): string {
  if (!value || value.trim() !== value) throw new TypeError(`${label} must be a non-empty exact string`);
  return value;
}

export function reportingDate(value: string, label: string): string {
  exact(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${label} must be a valid calendar date`);
  }
  return value;
}

export function reportingRange(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const start = reportingDate(startDate, 'startDate');
  const end = reportingDate(endDate, 'endDate');
  if (start > end) throw new RangeError('startDate must be on or before endDate');
  return { startDate: start, endDate: end };
}

export function utcEnvelope(startDate: string, endDate: string): { startUtc: string; endExclusiveUtc: string } {
  const range = reportingRange(startDate, endDate);
  const start = new Date(`${range.startDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(`${range.endDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 2);
  return { startUtc: start.toISOString(), endExclusiveUtc: end.toISOString() };
}

export function isInBusinessDateRange(
  utcIso: string,
  timeZone: string,
  startDate: string,
  endDate: string,
): boolean {
  const businessDate = deriveBusinessDate(utcIso, exact(timeZone, 'timeZone'));
  return businessDate >= startDate && businessDate <= endDate;
}

export function safeNonNegativeInteger(value: unknown, label: string): number {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return number;
}

export function safeSignedInteger(value: unknown, label: string): number {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number)) throw new RangeError(`${label} must be a safe integer`);
  return number;
}

export function addSafe(total: number, value: number, label: string): number {
  const next = total + value;
  if (!Number.isSafeInteger(next)) throw new RangeError(`${label} exceeds the safe integer range`);
  return next;
}

export function addCurrencyAmount(target: Record<string, number>, currencyCode: string | null, amount: number, label: string): void {
  if (amount === 0 && !currencyCode) return;
  const currency = exact(currencyCode ?? '', 'currencyCode');
  if (!/^[A-Z]{3}$/.test(currency)) throw new RangeError('currencyCode must use three uppercase letters');
  target[currency] = addSafe(target[currency] ?? 0, amount, label);
}

export async function all<T>(statement: CanonicalReportingPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}
