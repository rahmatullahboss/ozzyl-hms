import {
  DASHBOARD_DATE_BASES,
  type AdminDashboardRequest,
  type DashboardComparisonMode,
  type DashboardDateBasis,
  type DashboardRolePreset,
} from '../../../packages/shared/src/dashboard';
import {
  resolveExecutiveDashboardPeriod,
  type ExecutiveDashboardPeriod,
} from '../executive-dashboard-period';

const ROLE_PRESETS = new Set<DashboardRolePreset>([
  'hospital_admin',
  'md_director',
  'accountant',
  'manager_operations',
]);
const DATE_BASES = new Set<string>(DASHBOARD_DATE_BASES);
const DAY_MS = 86_400_000;

export interface ResolveDashboardFilterContextInput {
  preset?: string | null;
  range?: string | null;
  date?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  today?: string;
  dateBasis?: string | null;
  branchId?: string | number | null;
  departmentId?: string | number | null;
  doctorId?: string | number | null;
  testSearch?: string | null;
  rolePreset?: string | null;
  comparisonMode?: DashboardComparisonMode;
}

export interface DashboardFilterContext {
  request: AdminDashboardRequest;
  period: Pick<ExecutiveDashboardPeriod, 'startDate' | 'endDate' | 'label'>;
  comparisonPeriod: { startDate: string; endDate: string; label: string } | null;
  timeZone: 'Asia/Dhaka';
}

function epochDay(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function fromEpochDay(value: number): string {
  return new Date(value * DAY_MS).toISOString().slice(0, 10);
}

function label(startDate: string, endDate: string): string {
  return startDate === endDate ? endDate : `${startDate} → ${endDate}`;
}

function positiveInteger(value: string | number | null | undefined): number | undefined | null {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function previousPeriod(period: ExecutiveDashboardPeriod): DashboardFilterContext['comparisonPeriod'] {
  const start = epochDay(period.startDate);
  const end = epochDay(period.endDate);
  const days = end - start + 1;
  const comparisonEnd = start - 1;
  const comparisonStart = comparisonEnd - days + 1;
  const startDate = fromEpochDay(comparisonStart);
  const endDate = fromEpochDay(comparisonEnd);
  return { startDate, endDate, label: label(startDate, endDate) };
}

function previousMonth(period: ExecutiveDashboardPeriod): DashboardFilterContext['comparisonPeriod'] {
  const [year, month] = period.startDate.split('-').map(Number);
  const previousMonthEnd = new Date(Date.UTC(year, month - 1, 0));
  const previousYear = previousMonthEnd.getUTCFullYear();
  const previousMonthNumber = previousMonthEnd.getUTCMonth() + 1;
  const startDate = `${previousYear}-${String(previousMonthNumber).padStart(2, '0')}-01`;
  const endDate = previousMonthEnd.toISOString().slice(0, 10);
  return { startDate, endDate, label: label(startDate, endDate) };
}

function resolveComparison(
  period: ExecutiveDashboardPeriod,
  mode: DashboardComparisonMode | undefined,
): DashboardFilterContext['comparisonPeriod'] {
  if (!mode || mode === 'none') return null;
  if (mode === 'previous_month') return previousMonth(period);
  if (mode === 'previous_day') {
    const end = epochDay(period.startDate) - 1;
    const date = fromEpochDay(end);
    return { startDate: date, endDate: date, label: date };
  }
  return previousPeriod(period);
}

export function resolveDashboardFilterContext(
  input: ResolveDashboardFilterContextInput,
): DashboardFilterContext | null {
  const period = resolveExecutiveDashboardPeriod(input);
  if (!period) return null;

  const branchId = positiveInteger(input.branchId);
  const departmentId = positiveInteger(input.departmentId);
  const doctorId = positiveInteger(input.doctorId);
  if (branchId === null || departmentId === null || doctorId === null) return null;

  const dateBasis = input.dateBasis?.trim();
  if (dateBasis && !DATE_BASES.has(dateBasis)) return null;

  const rolePreset = input.rolePreset?.trim();
  if (rolePreset && !ROLE_PRESETS.has(rolePreset as DashboardRolePreset)) return null;

  const request: AdminDashboardRequest = {
    preset: period.preset,
    startDate: period.startDate,
    endDate: period.endDate,
  };
  if (dateBasis) request.dateBasis = dateBasis as DashboardDateBasis;
  if (branchId !== undefined) request.branchId = branchId;
  if (departmentId !== undefined) request.departmentId = departmentId;
  if (doctorId !== undefined) request.doctorId = doctorId;
  const testSearch = input.testSearch?.trim();
  if (testSearch) request.testSearch = testSearch;
  if (rolePreset) request.rolePreset = rolePreset as DashboardRolePreset;

  return {
    request,
    period: {
      startDate: period.startDate,
      endDate: period.endDate,
      label: period.label,
    },
    comparisonPeriod: resolveComparison(period, input.comparisonMode),
    timeZone: 'Asia/Dhaka',
  };
}
