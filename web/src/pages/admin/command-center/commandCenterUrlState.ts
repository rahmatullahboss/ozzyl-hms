import {
  DASHBOARD_DATE_BASES,
  type DashboardDateBasis,
} from '../../../../../packages/shared/src/dashboard';
import { resolveExecutiveDashboardFilters } from '../../../components/dashboard/ExecutiveDashboardRangeFilter';
import type {
  DashboardRange,
  ExecutiveDashboardFilters,
  PatientAgeBucket,
} from '../../../types/executiveDashboard';

export const COMMAND_CENTER_TABS = [
  'overview',
  'money',
  'doctors',
  'patients',
  'ipd',
  'diagnostics',
  'inventory',
  'audit',
] as const;

export type CommandCenterTab = (typeof COMMAND_CENTER_TABS)[number];

export interface CommandCenterUrlState {
  tab: CommandCenterTab;
  filters: ExecutiveDashboardFilters;
  dateBasis?: DashboardDateBasis;
  doctorId?: number;
  testId?: number;
  invoiceId?: number;
  ageBucket?: PatientAgeBucket;
}

export interface CommandCenterUrlPatch {
  tab?: CommandCenterTab | null;
  range?: DashboardRange | null;
  from?: string | null;
  to?: string | null;
  dateBasis?: DashboardDateBasis | null;
  doctorId?: number | null;
  testId?: number | null;
  invoiceId?: number | null;
  ageBucket?: PatientAgeBucket | null;
}

const TABS = new Set<string>(COMMAND_CENTER_TABS);
const PATIENT_AGE_BUCKETS = new Set<PatientAgeBucket>([
  '0_5',
  '6_17',
  '18_30',
  '31_45',
  '46_60',
  '61_plus',
  'unknown',
]);
const DATE_BASES = new Set<string>(DASHBOARD_DATE_BASES);
const RANGES = new Set<DashboardRange>([
  'today',
  'yesterday',
  'this_week',
  'this_month',
  'last_month',
  '7d',
  '30d',
  'custom',
]);

function isIsoDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function parsePositiveCommandCenterId(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function resolveFilters(params: URLSearchParams, today: string): ExecutiveDashboardFilters {
  const rawRange = params.get('range');
  const range = rawRange && RANGES.has(rawRange as DashboardRange)
    ? rawRange as DashboardRange
    : 'today';

  if (range === 'custom') {
    const startDate = params.get('from');
    const endDate = params.get('to');
    if (isIsoDate(startDate) && isIsoDate(endDate) && startDate <= endDate) {
      return { preset: 'custom', startDate, endDate };
    }
    return resolveExecutiveDashboardFilters('today', today);
  }

  return resolveExecutiveDashboardFilters(range, today);
}

export function parseCommandCenterUrlState(
  params: URLSearchParams,
  today: string,
): CommandCenterUrlState {
  const rawTab = params.get('tab');
  const tab = rawTab && TABS.has(rawTab) ? rawTab as CommandCenterTab : 'overview';
  const rawDateBasis = params.get('dateBasis');
  const dateBasis = rawDateBasis && DATE_BASES.has(rawDateBasis)
    ? rawDateBasis as DashboardDateBasis
    : undefined;
  const doctorId = parsePositiveCommandCenterId(params.get('doctorId'));
  const testId = parsePositiveCommandCenterId(params.get('testId'));
  const invoiceId = parsePositiveCommandCenterId(params.get('invoiceId'));
  const rawAgeBucket = params.get('ageBucket');
  const ageBucket = rawAgeBucket && PATIENT_AGE_BUCKETS.has(rawAgeBucket as PatientAgeBucket)
    ? rawAgeBucket as PatientAgeBucket
    : undefined;

  return {
    tab,
    filters: resolveFilters(params, today),
    ...(dateBasis ? { dateBasis } : {}),
    ...(doctorId ? { doctorId } : {}),
    ...(testId ? { testId } : {}),
    ...(invoiceId ? { invoiceId } : {}),
    ...(ageBucket ? { ageBucket } : {}),
  };
}

function setOrDelete(params: URLSearchParams, key: string, value: string | number | null | undefined): void {
  if (value === null || value === undefined || value === '') {
    params.delete(key);
    return;
  }
  params.set(key, String(value));
}

export function updateCommandCenterUrl(
  current: URLSearchParams,
  patch: CommandCenterUrlPatch,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if ('tab' in patch) setOrDelete(next, 'tab', patch.tab);
  if ('range' in patch) setOrDelete(next, 'range', patch.range);
  if ('from' in patch) setOrDelete(next, 'from', patch.from);
  if ('to' in patch) setOrDelete(next, 'to', patch.to);
  if ('dateBasis' in patch) setOrDelete(next, 'dateBasis', patch.dateBasis);
  if ('doctorId' in patch) setOrDelete(next, 'doctorId', patch.doctorId);
  if ('testId' in patch) setOrDelete(next, 'testId', patch.testId);
  if ('invoiceId' in patch) setOrDelete(next, 'invoiceId', patch.invoiceId);
  if ('ageBucket' in patch) setOrDelete(next, 'ageBucket', patch.ageBucket);
  return next;
}

export function openCommandCenterInvoice(current: URLSearchParams, billId: number): URLSearchParams {
  if (!Number.isInteger(billId) || billId <= 0) return new URLSearchParams(current);
  return updateCommandCenterUrl(current, { invoiceId: billId });
}

export function closeCommandCenterInvoice(current: URLSearchParams): URLSearchParams {
  return updateCommandCenterUrl(current, { invoiceId: null });
}

export function openCommandCenterDoctor(current: URLSearchParams, doctorId: number): URLSearchParams {
  if (!Number.isInteger(doctorId) || doctorId <= 0) return new URLSearchParams(current);
  return updateCommandCenterUrl(current, { tab: 'doctors', doctorId });
}
