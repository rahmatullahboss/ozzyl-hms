import { useMemo, useState } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, Users, BarChart2,
  Calendar, Download, RefreshCw, FlaskConical, Pill, CalendarDays,
  ArrowRight, Activity, Printer, FileText, Stethoscope, Info, AlertTriangle,
} from 'lucide-react';
import { Link } from 'react-router';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { getDateRangeGMT6, getTodayGMT6 } from '../lib/date-utils';
import { useAuth } from '../hooks/useAuth';

// --- Types ---

interface MonthlyRow {
  month: string;
  income: number;
  expense: number;
  profit: number;
}

interface SourceRow {
  source: string;
  amount: number;
  count: number;
  percentage: string;
}

interface SummaryData {
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
}

interface MonthlySummary {
  month: string;
  financial: { revenue: number; expenses: number; netProfit: number; profitMargin: number };
  operations: { newPatients: number; totalVisits: number; newAdmissions: number; discharges: number };
  topDiagnoses: { diagnosis: string; count: number }[];
}

type Range = 'today' | '30d' | '90d' | 'ytd' | 'custom';

// --- Module-level constants ---

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const SOURCE_COLORS: Record<string, string> = {
  billing:  'bg-[var(--color-primary)]',
  lab:      'bg-emerald-500',
  pharmacy: 'bg-amber-500',
  other:    'bg-purple-500',
};

const REPORT_LINKS = [
  { key: 'financial', icon: FileText, path: '__financial__', color: 'text-slate-700 bg-slate-100', requiredPermission: 'reports:read' },
  { key: 'reception', icon: Stethoscope, path: 'reception/reports', color: 'text-cyan-700 bg-cyan-50', requiredPermission: 'billing:read' },
  { key: 'lab', icon: FlaskConical, path: 'reports/lab', color: 'text-emerald-600 bg-emerald-50', requiredPermission: 'reports:read' },
  { key: 'pharmacy', icon: Pill, path: 'reports/pharmacy', color: 'text-amber-600 bg-amber-50', requiredPermission: 'reports:read' },
  { key: 'appointments', icon: CalendarDays, path: 'reports/appointments', color: 'text-blue-600 bg-blue-50', requiredPermission: 'reports:read' },
] as const;

const REPORT_CATALOG_SECTIONS = [
  {
    key: 'financeCash',
    items: [
      { key: 'financialStatements', icon: FileText, path: '__financial__', requiredPermission: 'reports:read' },
      { key: 'billingReports', icon: DollarSign, path: 'billing-reports', requiredPermission: 'billing:read' },
      { key: 'cashBankBook', icon: TrendingUp, path: 'cash-bank-book', requiredPermission: 'accounting:read' },
      { key: 'cashCollections', icon: TrendingDown, path: 'cash/collections', requiredPermission: 'billing:read' },
      { key: 'pdfCenter', icon: Printer, path: 'reception/reports/pdf', requiredPermission: 'billing:read', badge: 'PDF' },
    ],
  },
  {
    key: 'operations',
    items: [
      { key: 'receptionReports', icon: Stethoscope, path: 'reception/reports', requiredPermission: 'billing:read' },
      { key: 'appointmentReports', icon: CalendarDays, path: 'reports/appointments', requiredPermission: 'reports:read' },
      { key: 'ipdReports', icon: Users, path: 'ipd-reports', requiredPermission: 'reports:read' },
      { key: 'otReports', icon: Activity, path: 'ot/reports', requiredPermission: 'ot:read' },
    ],
  },
  {
    key: 'diagnosticsPharmacy',
    items: [
      { key: 'labReports', icon: FlaskConical, path: 'reports/lab', requiredPermission: 'reports:read' },
      { key: 'radiologyReports', icon: Activity, path: 'radiology', requiredPermission: 'reports:read' },
      { key: 'pharmacyReports', icon: Pill, path: 'reports/pharmacy', requiredPermission: 'reports:read' },
      { key: 'inventoryReports', icon: BarChart2, path: 'inventory/reports', requiredPermission: 'inventory:read' },
    ],
  },
  {
    key: 'qualityCompliance',
    items: [
      { key: 'auditExplorer', icon: AlertTriangle, path: 'system-audit', requiredPermission: 'audit:read' },
      { key: 'safetyOverrideAudit', icon: AlertTriangle, path: 'audit/safety-overrides', requiredPermission: 'audit:read' },
      { key: 'bedOccupancy', icon: Users, path: 'ipd-reports', requiredPermission: 'reports:read' },
      { key: 'doctorPerformance', icon: Stethoscope, path: '#doctor-performance', requiredPermission: 'reports:read', local: true },
    ],
  },
] as const;

// --- Helpers ---

function fmtFull(n: number) {
  return `৳${n.toLocaleString('en-BD')}`;
}

function fmtShort(n: number) {
  if (n >= 100_000) return `৳${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000)   return `৳${(n / 1_000).toFixed(1)}K`;
  return `৳${n.toLocaleString()}`;
}

function getTenantRoute(path: string): string {
  if (path.startsWith('#') || path.startsWith('../') || path.startsWith('/')) return path;
  return `../${path}`;
}

function getDateRange(r: Range): { startDate: string; endDate: string } {
  if (r === 'today') {
    const today = getTodayGMT6();
    return { startDate: today, endDate: today };
  }
  if (r === 'custom') {
    const today = getTodayGMT6();
    return { startDate: today, endDate: today };
  }
  return getDateRangeGMT6(r);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function openPrintWindow(title: string, body: string): void {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) return;
  printWindow.document.write(`<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
        h1, h2 { margin: 0 0 10px; }
        .muted { color: #64748b; margin-bottom: 16px; }
        .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
        .card { border: 1px solid #cbd5e1; border-radius: 12px; padding: 12px; background: #f8fafc; }
        .label { font-size: 12px; color: #64748b; }
        .value { font-size: 20px; font-weight: 700; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #cbd5e1; padding: 8px 10px; font-size: 13px; text-align: left; }
        th { background: #e2e8f0; }
        .right { text-align: right; }
        .print-btn { margin-bottom: 16px; padding: 10px 14px; border: none; background: #0f766e; color: white; border-radius: 10px; cursor: pointer; }
        @media print { .print-btn { display: none; } body { margin: 10mm; } }
      </style>
    </head>
    <body>
      <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
      ${body}
    </body>
  </html>`);
  printWindow.document.close();
}

function buildDoctorPerformanceCsv(doctors: DoctorPerf['doctors']): string {
  return [
    ['Doctor', 'Specialty', 'Visits', 'Visit Revenue', 'Tests', 'Test Revenue', 'Test Commission', 'Hospital Revenue'],
    ...doctors.map((doctor) => [
      doctor.name,
      doctor.specialty,
      String(doctor.visitCount),
      String(doctor.revenue),
      String(doctor.testCount),
      String(doctor.testRevenue),
      String(doctor.labTestCommissions ?? 0),
      String(doctor.hospitalRevenue ?? 0),
    ]),
  ].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

function buildDoctorPerformanceHtml(
  doctors: DoctorPerf['doctors'],
  startDate: string,
  endDate: string,
): string {
  const totalRevenue = doctors.reduce((sum, doctor) => sum + doctor.revenue, 0);
  const totalTests = doctors.reduce((sum, doctor) => sum + (doctor.testCount ?? 0), 0);
  const totalTestRevenue = doctors.reduce((sum, doctor) => sum + (doctor.testRevenue ?? 0), 0);
  const totalTestCommission = doctors.reduce((sum, doctor) => sum + (doctor.labTestCommissions ?? 0), 0);
  const totalHospital = doctors.reduce((sum, doctor) => sum + (doctor.hospitalRevenue ?? 0), 0);
  const totalVisits = doctors.reduce((sum, doctor) => sum + doctor.visitCount, 0);

  return `
    <h1>Doctor Performance Report</h1>
    <div class="muted">Date range: ${startDate} to ${endDate}</div>
    <div class="summary">
      <div class="card"><div class="label">Doctors</div><div class="value">${doctors.length}</div></div>
      <div class="card"><div class="label">Total Visits</div><div class="value">${totalVisits}</div></div>
      <div class="card"><div class="label">Visit Revenue</div><div class="value">${fmtFull(totalRevenue)}</div></div>
      <div class="card"><div class="label">Tests</div><div class="value">${totalTests}</div></div>
      <div class="card"><div class="label">Test Revenue</div><div class="value">${fmtFull(totalTestRevenue)}</div></div>
      <div class="card"><div class="label">Test Commission</div><div class="value">${fmtFull(totalTestCommission)}</div></div>
      <div class="card"><div class="label">Hospital Revenue</div><div class="value">${fmtFull(totalHospital)}</div></div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Doctor</th>
          <th>Specialty</th>
          <th class="right">Visits</th>
          <th class="right">Visit Rev</th>
          <th class="right">Tests</th>
          <th class="right">Test Rev</th>
          <th class="right">Test Comm</th>
          <th class="right">Hospital Rev</th>
        </tr>
      </thead>
      <tbody>
        ${doctors.map((doctor) => `
          <tr>
            <td>${escapeHtml(doctor.name)}</td>
            <td>${escapeHtml(doctor.specialty)}</td>
            <td class="right">${doctor.visitCount}</td>
            <td class="right">${fmtFull(doctor.revenue)}</td>
            <td class="right">${doctor.testCount ?? 0}</td>
            <td class="right">${fmtFull(doctor.testRevenue ?? 0)}</td>
            <td class="right">${fmtFull(doctor.labTestCommissions ?? 0)}</td>
            <td class="right">${fmtFull(doctor.hospitalRevenue ?? 0)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function printDoctorReport(doctors: DoctorPerf['doctors'], startDate: string, endDate: string, title?: string): void {
  if (!doctors.length) return;
  openPrintWindow(
    title ?? `Doctor report ${startDate} to ${endDate}`,
    buildDoctorPerformanceHtml(doctors, startDate, endDate),
  );
}

// --- Mini Bar Chart (CSS-only) ---

function BarChart({ data }: { data: MonthlyRow[] }) {
  const { t } = useTranslation('reports');
  const maxVal = Math.max(...data.map(d => Math.max(d.income, d.expense)), 1);

  return (
    <div className="pt-4">
      <div className="flex items-end gap-1.5 h-40">
        {data.map(row => {
          const label    = row.month.slice(5);
          const monthIdx = parseInt(label) - 1;
          const incH     = (row.income  / maxVal) * 100;
          const expH     = (row.expense / maxVal) * 100;
          return (
            <div key={row.month} className="flex-1 flex flex-col items-center gap-0.5 group relative">
              <div className="hidden group-hover:flex absolute bottom-full mb-2 z-10 flex-col bg-[var(--color-bg-card)] border border-[var(--color-border)] shadow-lg rounded-lg px-3 py-2 text-xs whitespace-nowrap left-1/2 -translate-x-1/2 pointer-events-none">
                <p className="font-semibold text-[var(--color-text-primary)] mb-1">
                  {MONTH_NAMES[monthIdx]} {row.month.slice(0, 4)}
                </p>
                <p className="text-[var(--color-success)]">{t('legend.income')}: {fmtFull(row.income)}</p>
                <p className="text-red-500">{t('legend.expenses')}: {fmtFull(row.expense)}</p>
                <p className="font-medium">
                  {row.profit >= 0 ? '🟢' : '🔴'} {t('legend.profit')}: {fmtFull(row.profit)}
                </p>
              </div>
              <div className="w-full flex items-end gap-px h-36">
                <div
                  className="flex-1 bg-[var(--color-primary)] rounded-t-sm transition-all duration-500 opacity-80 hover:opacity-100"
                  style={{ height: `${incH}%`, minHeight: row.income > 0 ? 2 : 0 }}
                />
                <div
                  className="flex-1 bg-red-400 rounded-t-sm transition-all duration-500 opacity-60 hover:opacity-100"
                  style={{ height: `${expH}%`, minHeight: row.expense > 0 ? 2 : 0 }}
                />
              </div>
              <span className="text-[10px] text-[var(--color-text-muted)]">{MONTH_NAMES[monthIdx]}</span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 mt-3 text-xs text-[var(--color-text-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm bg-[var(--color-primary)]" /> {t('legend.revenue')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm bg-red-400" /> {t('legend.expenses')}
        </span>
      </div>
    </div>
  );
}

// --- Horizontal breakdown bar ---

function SourceBar({ label, amount, pct, color }: { label: string; amount: number; pct: string; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-[var(--color-text-primary)] font-medium capitalize">{label}</span>
        <span className="text-[var(--color-text-muted)]">{fmtShort(amount)}</span>
      </div>
      <div className="h-2 bg-[var(--color-border)] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-[var(--color-text-muted)] text-right">{pct}%</p>
    </div>
  );
}

// --- Component ---

export default function ReportsDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const [range, setRange] = useState<Range>('ytd');
  const { t } = useTranslation(['reports', 'common']);
  const queryClient = useQueryClient();
  const initialRange = getDateRange('ytd');
  const [customStartDate, setCustomStartDate] = useState(initialRange.startDate);
  const [customEndDate, setCustomEndDate] = useState(initialRange.endDate);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('all');

  const hasPermission = (permission?: string) => {
    if (!permission) return true;
    if (role === 'hospital_admin' || permissions.includes('*')) return true;
    return permissions.includes(permission);
  };

  const resolvedDates = useMemo(() => {
    if (range === 'custom') {
      return { startDate: customStartDate, endDate: customEndDate };
    }
    return getDateRange(range);
  }, [customEndDate, customStartDate, range]);
  const { startDate, endDate } = resolvedDates;
  const year = endDate.slice(0, 4);
  const currentMonth = endDate.slice(0, 7);
  const financialReportsPath = role === 'md'
    ? 'md/reports'
    : role === 'director'
      ? 'director/reports'
      : role === 'accountant'
        ? 'accountant/reports'
        : 'profit-loss';

  const { data: monthlyRes, isLoading: loadingMonthly } = useApiQuery<{ monthly: MonthlyRow[]; summary: SummaryData }>(
    queryKeys.reports.monthly(year),
    `/api/reports/monthly?year=${year}`
  );
  const { data: plRes, isLoading: loadingPl } = useApiQuery<{ income?: { total?: number }; expenses?: { total?: number }; netProfit?: number }>(
    queryKeys.reports.pl(startDate, endDate),
    `/api/reports/pl?startDate=${startDate}&endDate=${endDate}`
  );
  const { data: sourceRes, isLoading: loadingSources } = useApiQuery<{ breakdown: SourceRow[] }>(
    queryKeys.reports.incomeBySource(startDate, endDate),
    `/api/reports/income-by-source?startDate=${startDate}&endDate=${endDate}`
  );
  const { data: monthlySummary, isLoading: loadingSummary } = useApiQuery<MonthlySummary>(
    queryKeys.reports.monthlySummary(currentMonth),
    `/api/reports/monthly-summary?month=${currentMonth}`
  );
  const { data: doctorPerformanceRes, isLoading: loadingDoctorPerformance } = useApiQuery<DoctorPerf>(
    queryKeys.reports.doctorPerformance(startDate, endDate),
    `/api/reports/doctor-performance?startDate=${startDate}&endDate=${endDate}`
  );

  const monthly = monthlyRes?.monthly ?? [];
  const summary: SummaryData = plRes
    ? {
        totalIncome: plRes.income?.total ?? monthlyRes?.summary?.totalIncome ?? 0,
        totalExpense: plRes.expenses?.total ?? monthlyRes?.summary?.totalExpense ?? 0,
        netProfit: plRes.netProfit ?? monthlyRes?.summary?.netProfit ?? 0,
      }
    : (monthlyRes?.summary ?? { totalIncome: 0, totalExpense: 0, netProfit: 0 });

  const sources = sourceRes?.breakdown ?? [];
  const doctorPerformance = doctorPerformanceRes?.doctors ?? [];
  const loading = loadingMonthly || loadingSources || loadingPl;
  const selectedDoctors = useMemo(
    () => selectedDoctorId === 'all'
      ? doctorPerformance
      : doctorPerformance.filter((doctor) => String(doctor.id) === selectedDoctorId),
    [doctorPerformance, selectedDoctorId],
  );

  const profitMargin = summary.totalIncome > 0
    ? ((summary.netProfit / summary.totalIncome) * 100).toFixed(1)
    : '0';

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
  };

  const visibleReportLinks = REPORT_LINKS.filter((link) => hasPermission(link.requiredPermission));

  return (
    <DashboardLayout role={role}>
      <div className="space-y-6">

        {/* Header */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('title')}</h1>
            <p className="section-subtitle mt-1">{t('subtitle', { defaultValue: 'Financial overview and performance metrics' })}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden text-sm">
              {(['today', '30d', '90d', 'ytd', 'custom'] as Range[]).map(r => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-3 py-1.5 transition-colors ${
                    range === r
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-border-light)]'
                  }`}
                >
                  {t(`ranges.${r}`, { defaultValue: r === 'today' ? 'Today' : r === 'custom' ? 'Custom' : r })}
                </button>
              ))}
            </div>
            <button onClick={refreshAll} className="btn-ghost" aria-label="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                if (!monthly.length) return;
                const rows = monthly.map(r =>
                  `<tr><td>${r.month}</td><td class="right">${fmtFull(r.income)}</td><td class="right">${fmtFull(r.expense)}</td><td class="right">${fmtFull(r.profit)}</td></tr>`
                ).join('');
                openPrintWindow(
                  `HMS Report - ${range}`,
                  `
                    <h1>HMS Financial Report</h1>
                    <p class="muted">Period: ${range === 'today' ? 'Today' : range.toUpperCase()}</p>
                    <div class="summary">
                      <div class="card"><div class="label">Total Income</div><div class="value">${fmtFull(summary.totalIncome)}</div></div>
                      <div class="card"><div class="label">Total Expense</div><div class="value">${fmtFull(summary.totalExpense)}</div></div>
                      <div class="card"><div class="label">Net Profit</div><div class="value">${fmtFull(summary.netProfit)}</div></div>
                      <div class="card"><div class="label">Margin</div><div class="value">${profitMargin}%</div></div>
                    </div>
                    <table>
                      <thead><tr><th>Month</th><th>Income</th><th>Expense</th><th>Profit</th></tr></thead>
                      <tbody>${rows}</tbody>
                    </table>
                  `,
                );
              }}
              className="btn-secondary"
              disabled={loading || !monthly.length}
            >
              <Printer className="w-4 h-4" /> {t('exportPdf', { defaultValue: 'Print / PDF' })}
            </button>
            <button
              onClick={() => {
                if (!monthly.length) return;
                const csv = '\uFEFF' + [
                  'Month,Income,Expense,Profit',
                  ...monthly.map(r => `${r.month},${r.income},${r.expense},${r.profit}`),
                ].join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement('a');
                a.href = url; a.download = `hms-report-${range}.csv`; a.click();
                URL.revokeObjectURL(url);
              }}
              className="btn-secondary"
              disabled={loading || !monthly.length}
            >
              <Download className="w-4 h-4" /> {t('exportCsv', { defaultValue: 'Export CSV' })}
            </button>
          </div>
        </div>

        <div className="card p-5">
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              {visibleReportLinks.map((link) => {
                const href = link.path === '__financial__' ? financialReportsPath : link.path;
                return (
                  <Link
                    key={link.key}
                    to={getTenantRoute(href)}
                    className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 transition-colors hover:bg-[var(--color-bg-secondary)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className={`rounded-lg p-2 ${link.color}`}>
                        <link.icon className="h-5 w-5" />
                      </div>
                      <ArrowRight className="h-4 w-4 text-[var(--color-text-muted)]" />
                    </div>
                    <div className="mt-3 text-sm font-semibold text-[var(--color-text-primary)]">
                      {t(`links.${link.key}.label`, { defaultValue: link.key })}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
                      {t(`links.${link.key}.desc`, { defaultValue: '' })}
                    </div>
                  </Link>
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="label">{t('filters.startDate', { defaultValue: 'Start date' })}</label>
                <input
                  type="date"
                  className="input"
                  value={customStartDate}
                  onChange={(event) => {
                    setCustomStartDate(event.target.value);
                    setRange('custom');
                  }}
                />
                </div>
                <div>
                  <label className="label">{t('filters.endDate', { defaultValue: 'End date' })}</label>
                <input
                  type="date"
                  className="input"
                  value={customEndDate}
                  onChange={(event) => {
                    setCustomEndDate(event.target.value);
                    setRange('custom');
                  }}
                />
                </div>
                <div>
                  <label className="label">{t('filters.doctorGenerator', { defaultValue: 'Doctor-wise generator' })}</label>
                <select className="input" value={selectedDoctorId} onChange={(event) => setSelectedDoctorId(event.target.value)}>
                  <option value="all">{t('filters.allDoctors', { defaultValue: 'All doctors' })}</option>
                  {doctorPerformance.map((doctor) => (
                    <option key={doctor.id} value={String(doctor.id)}>
                      {doctor.name} {doctor.specialty ? `• ${doctor.specialty}` : ''}
                    </option>
                ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 xl:justify-end">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={loading || loadingDoctorPerformance || !doctorPerformance.length}
                  onClick={() => {
                    printDoctorReport(
                      selectedDoctors,
                      startDate,
                      endDate,
                      selectedDoctorId === 'all' ? `Doctor report ${startDate} to ${endDate}` : `${selectedDoctors[0].name} report`,
                    );
                  }}
                >
                  <Printer className="w-4 h-4" />
                  {selectedDoctorId === 'all'
                    ? t('doctorReports.printAll', { defaultValue: 'Print All Doctors' })
                    : t('doctorReports.printOne', { defaultValue: 'Print Doctor' })}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={loading || loadingDoctorPerformance || !doctorPerformance.length}
                  onClick={() => {
                    if (!selectedDoctors.length) return;
                    downloadCsv(
                      `doctor-performance-${selectedDoctorId === 'all' ? 'all' : selectedDoctorId}-${startDate}-to-${endDate}.csv`,
                      buildDoctorPerformanceCsv(selectedDoctors),
                    );
                  }}
                >
                  <Download className="w-4 h-4" />
                  {selectedDoctorId === 'all'
                    ? t('doctorReports.exportAll', { defaultValue: 'Export All Doctors' })
                    : t('doctorReports.exportOne', { defaultValue: 'Export Doctor' })}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="section-title">{t('catalog.title', { defaultValue: 'Report Library' })}</h2>
              <p className="section-subtitle mt-1">
                {t('catalog.subtitle', { defaultValue: 'Role-aware report groups for finance, operations, diagnostics, inventory, quality, and audit.' })}
              </p>
            </div>
            <span className="badge badge-primary self-start">
              {t('catalog.auditReady', { defaultValue: 'Export / Print ready' })}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
            {REPORT_CATALOG_SECTIONS.map((section) => {
              const items = section.items.filter((item) => hasPermission(item.requiredPermission));
              if (!items.length) return null;
              return (
                <div key={section.key} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4">
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {t(`catalog.sections.${section.key}`, { defaultValue: section.key })}
                  </h3>
                  <div className="mt-3 space-y-2">
                    {items.map((item) => {
                      const Icon = item.icon;
                      const href = item.path === '__financial__' ? financialReportsPath : item.path;
                      const content = (
                        <div className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 transition-colors hover:bg-[var(--color-bg-secondary)]">
                          <div className="rounded-lg bg-[var(--color-primary-soft)] p-2 text-[var(--color-primary)]">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-[var(--color-text-primary)]">
                                {t(`catalog.items.${item.key}.label`, { defaultValue: item.key })}
                              </span>
                              {'badge' in item && item.badge ? <span className="badge badge-success text-[10px]">{item.badge}</span> : null}
                            </div>
                            <p className="mt-0.5 text-xs leading-5 text-[var(--color-text-muted)]">
                              {t(`catalog.items.${item.key}.desc`, { defaultValue: '' })}
                            </p>
                          </div>
                          <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                        </div>
                      );
                      return 'local' in item && item.local ? (
                        <a key={item.key} href={href} className="block">{content}</a>
                      ) : (
                        <Link key={item.key} to={getTenantRoute(href)} className="block">{content}</Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title={t('totalRevenue', { defaultValue: 'Total Revenue' })}
            value={loading ? '' : fmtFull(summary.totalIncome)}
            icon={<DollarSign className="w-5 h-5" />}
            trend={summary.netProfit >= 0
              ? { value: parseFloat(profitMargin), isPositive: true, label: t('common:margin') }
              : undefined}
            loading={loading}
          />
          <KPICard
            title={t('totalExpenses', { defaultValue: 'Total Expenses' })}
            value={loading ? '' : fmtFull(summary.totalExpense)}
            icon={<TrendingDown className="w-5 h-5" />}
            loading={loading}
          />
          <KPICard
            title={t('netProfit', { defaultValue: 'Net Profit' })}
            value={loading ? '' : fmtFull(summary.netProfit)}
            icon={<TrendingUp className="w-5 h-5" />}
            trend={summary.netProfit >= 0
              ? { value: parseFloat(profitMargin), isPositive: true, label: t('common:status.profitable', { defaultValue: 'profitable' }) }
              : { value: 0, isPositive: false, label: t('common:status.loss', { defaultValue: 'at a loss' }) }}
            loading={loading}
          />
          <KPICard
            title={t('revenueSources', { defaultValue: 'Revenue Sources' })}
            value={loading ? '' : String(sources.length)}
            icon={<Users className="w-5 h-5" />}
            loading={loading}
          />
        </div>

        {/* Monthly Summary Cards */}
        {monthlySummary && (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title flex items-center gap-2">
                <Activity className="w-5 h-5 text-[var(--color-primary)]" />
                {t('thisMonthOverview', { month: monthlySummary.month })}
              </h2>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
              <div className="text-center">
                <p className="text-xs text-[var(--color-text-muted)]">{t('legend.revenue')}</p>
                <p className="text-lg font-bold text-[var(--color-success)]">{fmtShort(monthlySummary.financial.revenue)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-[var(--color-text-muted)]">{t('legend.expenses', { defaultValue: 'Expenses' })}</p>
                <p className="text-lg font-bold text-red-500">{fmtShort(monthlySummary.financial.expenses)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-[var(--color-text-muted)]">{t('netProfit')}</p>
                <p className="text-lg font-bold text-[var(--color-primary)]">{fmtShort(monthlySummary.financial.netProfit)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-[var(--color-text-muted)]">{t('newPatients')}</p>
                <p className="text-lg font-bold">{monthlySummary.operations.newPatients}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-[var(--color-text-muted)]">{t('totalVisits')}</p>
                <p className="text-lg font-bold">{monthlySummary.operations.totalVisits}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-[var(--color-text-muted)]">{t('admissions')}</p>
                <p className="text-lg font-bold">{monthlySummary.operations.newAdmissions}</p>
              </div>
            </div>
            {monthlySummary.topDiagnoses.length > 0 && (
              <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-text-muted)] mb-2">{t('topDiagnoses')}</p>
                <div className="flex flex-wrap gap-2">
                  {monthlySummary.topDiagnoses.slice(0, 5).map((d, i) => (
                    <span key={i} className="badge badge-primary text-xs">
                      {d.diagnosis} ({d.count})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {loadingSummary && (
          <div className="card p-5">
            <div className="skeleton h-20 w-full rounded-lg" />
          </div>
        )}

        {/* Report Navigation Hub */}
        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 card p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="section-title">{t('monthlyRevenueVsExpenses', { defaultValue: 'Monthly Revenue vs Expenses' })}</h2>
              <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                <Calendar className="w-3.5 h-3.5" /> {new Date().getFullYear()}
              </div>
            </div>
            {loading ? (
              <div className="skeleton h-48 w-full rounded-lg mt-4" />
            ) : monthly.length > 0 ? (
              <BarChart data={monthly} />
            ) : (
              <EmptyState icon={<BarChart2 className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('empty.noData')} description={t('empty.noMonthlyData')} />
            )}
          </div>

          <div className="card p-5">
            <h2 className="section-title mb-4">{t('revenueBySource', { defaultValue: 'Revenue by Source' })}</h2>
            {loading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="skeleton h-10 w-full rounded-lg" />
                ))}
              </div>
            ) : sources.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">
                {t('empty.noSourceData')}
              </div>
            ) : (
              <div className="space-y-4">
                {sources.map(s => (
                  <SourceBar
                    key={s.source}
                    label={s.source}
                    amount={s.amount}
                    pct={s.percentage}
                    color={SOURCE_COLORS[s.source] ?? 'bg-slate-400'}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Monthly breakdown table */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
            <h2 className="section-title">{t('monthlyBreakdown', { defaultValue: 'Monthly Breakdown' })}</h2>
            <BarChart2 className="w-4 h-4 text-[var(--color-text-muted)]" />
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('table.month')}</th>
                  <th className="text-right">{t('table.revenue')}</th>
                  <th className="text-right">{t('table.expenses')}</th>
                  <th className="text-right">{t('table.netProfit')}</th>
                  <th className="text-right">{t('table.margin')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(5)].map((__, j) => (
                        <td key={j}><div className="skeleton h-4 w-full rounded" /></td>
                      ))}
                    </tr>
                  ))
                ) : monthly.filter(r => r.income > 0 || r.expense > 0).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-sm text-[var(--color-text-muted)]">
                      {t('empty.noMonthlyData')}
                    </td>
                  </tr>
                ) : (
                  monthly.filter(r => r.income > 0 || r.expense > 0).map(row => {
                    const [yr, mo] = row.month.split('-');
                    const margin = row.income > 0
                      ? ((row.profit / row.income) * 100).toFixed(1)
                      : '–';
                    return (
                      <tr key={row.month}>
                        <td className="font-medium">{MONTH_NAMES[parseInt(mo) - 1]} {yr}</td>
                        <td className="text-right font-data">{fmtFull(row.income)}</td>
                        <td className="text-right font-data text-red-500">{fmtFull(row.expense)}</td>
                        <td className={`text-right font-data font-semibold ${
                          row.profit >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'
                        }`}>
                          {fmtFull(row.profit)}
                        </td>
                        <td className="text-right">
                          <span className={`badge ${row.profit >= 0 ? 'badge-success' : 'badge-danger'}`}>
                            {margin}%
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {!loading && monthly.filter(r => r.income > 0 || r.expense > 0).length > 0 && (
                <tfoot className="bg-[var(--color-bg-primary)]">
                  <tr>
                    <td className="font-semibold text-[var(--color-text-primary)] px-4 py-3">{t('table.total')}</td>
                    <td className="text-right font-data font-bold px-4 py-3">{fmtFull(summary.totalIncome)}</td>
                    <td className="text-right font-data font-bold text-red-500 px-4 py-3">{fmtFull(summary.totalExpense)}</td>
                    <td className={`text-right font-data font-bold px-4 py-3 ${
                      summary.netProfit >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'
                    }`}>
                      {fmtFull(summary.netProfit)}
                    </td>
                    <td className="text-right px-4 py-3">
                      <span className={`badge ${summary.netProfit >= 0 ? 'badge-success' : 'badge-danger'}`}>
                        {profitMargin}%
                      </span>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Advanced Reports Row */}
        <AdvancedReports
          startDate={startDate}
          endDate={endDate}
          selectedDoctorId={selectedDoctorId}
        />

      </div>
    </DashboardLayout>
  );
}

// --- Advanced Reports Sub-Component ---

interface BedOccupancy {
  totalBeds: number; occupiedBeds: number; availableBeds: number; occupancyRate: number;
  byWard: { ward: string; total: number; occupied: number; available: number; rate: number }[];
}

interface DeptRevenue {
  totalRevenue: number;
  byDepartment: { department: string; revenue: number; billCount: number; patientCount: number; percentage: number }[];
}

interface DoctorPerf {
  doctors: {
    id: number;
    name: string;
    specialty: string;
    visitCount: number;
    uniquePatients: number;
    revenue: number;
    consultationFees: number;
    labTestCommissions: number;
    referralCommissions: number;
    totalCommissions: number;
    referralLabRevenue: number;
    testCount: number;
    testRevenue: number;
    hospitalRevenue: number;
    netHospitalIncome: number;
    avgRevenuePerVisit: number;
  }[];
  summary?: {
    totalDoctors?: number;
    totalVisits?: number;
    totalRevenue?: number;
    totalTestCount?: number;
    totalTestRevenue?: number;
    totalHospitalRevenue?: number;
  };
}

function AdvancedReports({
  startDate,
  endDate,
  selectedDoctorId,
}: {
  startDate: string;
  endDate: string;
  selectedDoctorId: string;
}) {
  const { t } = useTranslation(['reports', 'common']);

  const { data: beds, isLoading: loadingBeds } = useApiQuery<BedOccupancy>(
    queryKeys.reports.bedOccupancy(),
    '/api/reports/bed-occupancy'
  );
  const { data: deptRev, isLoading: loadingDept } = useApiQuery<DeptRevenue>(
    queryKeys.reports.departmentRevenue(startDate, endDate),
    `/api/reports/department-revenue?startDate=${startDate}&endDate=${endDate}`
  );
  const { data: docPerf, isLoading: loadingDoc } = useApiQuery<DoctorPerf>(
    queryKeys.reports.doctorPerformance(startDate, endDate),
    `/api/reports/doctor-performance?startDate=${startDate}&endDate=${endDate}`
  );

  const loadingAdv = loadingBeds || loadingDept || loadingDoc;
  const visibleDoctors = selectedDoctorId === 'all'
    ? (docPerf?.doctors ?? [])
    : (docPerf?.doctors ?? []).filter((doctor) => String(doctor.id) === selectedDoctorId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

      {/* Bed Occupancy */}
      <div className="card p-5">
        <h2 className="section-title mb-4 flex items-center gap-2">
          {t('advanced.bedOccupancy')}
        </h2>
        {loadingAdv ? (
          <div className="skeleton h-32 w-full rounded-lg" />
        ) : beds ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-secondary)]">{t('advanced.overallOccupancy')}</span>
              <span className="text-xl font-bold text-[var(--color-primary)]">{beds.occupancyRate}%</span>
            </div>
            <div className="h-3 bg-[var(--color-border)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-700"
                style={{ width: `${beds.occupancyRate}%` }}
              />
            </div>
            <div className="grid grid-cols-3 text-center text-xs">
              <div><p className="text-[var(--color-text-muted)]">{t('advanced.table.total')}</p><p className="font-bold">{beds.totalBeds}</p></div>
              <div><p className="text-[var(--color-text-muted)]">{t('advanced.table.occupied')}</p><p className="font-bold text-amber-500">{beds.occupiedBeds}</p></div>
              <div><p className="text-[var(--color-text-muted)]">{t('advanced.table.available')}</p><p className="font-bold text-[var(--color-success)]">{beds.availableBeds}</p></div>
            </div>
            {beds.byWard.length > 0 && (
              <div className="pt-2 border-t border-[var(--color-border)] space-y-2">
                {beds.byWard.slice(0, 5).map(w => (
                  <div key={w.ward} className="flex items-center justify-between text-xs">
                    <span className="text-[var(--color-text-secondary)] capitalize">{w.ward}</span>
                    <span className="font-medium">{w.occupied}/{w.total} ({w.rate}%)</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-8">{t('empty.noBedData')}</p>
        )}
      </div>

      {/* Department Revenue */}
      <div className="card p-5">
        <h2 className="section-title mb-4">{t('advanced.deptRevenue')}</h2>
        {loadingAdv ? (
          <div className="skeleton h-32 w-full rounded-lg" />
        ) : deptRev && deptRev.byDepartment.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-[var(--color-text-muted)]">{t('common:total')}: <span className="font-bold text-[var(--color-text-primary)]">{fmtShort(deptRev.totalRevenue)}</span></p>
            {deptRev.byDepartment.slice(0, 6).map(d => (
              <div key={d.department} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--color-text-primary)] font-medium">{d.department}</span>
                  <span className="text-[var(--color-text-muted)]">{fmtShort(d.revenue)} ({d.percentage}%)</span>
                </div>
                <div className="h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${d.percentage}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-8">{t('empty.noDeptData')}</p>
        )}
      </div>

      {/* Doctor Performance */}
      <div id="doctor-performance" className="card p-5 lg:col-span-2">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="section-title">{t('advanced.drPerformance')}</h2>
            <p className="section-subtitle mt-1">
              {t('advanced.drPerformanceSubtitle', { defaultValue: 'Visits, visit revenue, tests, test revenue, test commission, and hospital revenue per doctor.' })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={loadingAdv || !visibleDoctors.length}
              onClick={() => printDoctorReport(
                visibleDoctors,
                startDate,
                endDate,
                selectedDoctorId === 'all'
                  ? `Doctor report ${startDate} to ${endDate}`
                  : `${visibleDoctors[0].name} report`,
              )}
            >
              <Printer className="h-4 w-4" />
              {selectedDoctorId === 'all'
                ? t('doctorReports.printAll', { defaultValue: 'Print All Doctors' })
                : t('doctorReports.printOne', { defaultValue: 'Print Doctor' })}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={loadingAdv || !visibleDoctors.length}
              onClick={() => {
                downloadCsv(
                  `doctor-performance-${selectedDoctorId === 'all' ? 'all' : selectedDoctorId}-${startDate}-to-${endDate}.csv`,
                  buildDoctorPerformanceCsv(visibleDoctors),
                );
              }}
            >
              <Download className="h-4 w-4" />
              {selectedDoctorId === 'all'
                ? t('doctorReports.exportAll', { defaultValue: 'Export All Doctors' })
                : t('doctorReports.exportOne', { defaultValue: 'Export Doctor' })}
            </button>
          </div>
        </div>

        {/* 4 KPI cards */}
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
            <p className="text-xs font-medium text-[var(--color-text-muted)]">{t('advanced.kpi.totalVisits')}</p>
            <p className="mt-1 font-data text-2xl font-bold text-[var(--color-text-primary)]">
              {Number(docPerf?.summary?.totalVisits ?? 0).toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
            <p className="text-xs font-medium text-[var(--color-text-muted)]">{t('advanced.kpi.totalVisitRevenue')}</p>
            <p className="mt-1 font-data text-2xl font-bold text-blue-700">
              {fmtFull(docPerf?.summary?.totalRevenue ?? 0)}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
            <p className="text-xs font-medium text-[var(--color-text-muted)]">{t('advanced.kpi.totalTestRevenue')}</p>
            <p className="mt-1 font-data text-2xl font-bold text-purple-700">
              {fmtFull(docPerf?.summary?.totalTestRevenue ?? 0)}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
            <p className="text-xs font-medium text-[var(--color-text-muted)]">{t('advanced.kpi.totalHospitalRevenue')}</p>
            <p className="mt-1 font-data text-2xl font-bold text-emerald-700">
              {fmtFull(docPerf?.summary?.totalHospitalRevenue ?? 0)}
            </p>
          </div>
        </div>

        {loadingAdv ? (
          <div className="skeleton h-32 w-full rounded-lg" />
        ) : visibleDoctors.length > 0 ? (
          <div className="overflow-x-auto">
                <table className="table-base text-sm">
                  <thead>
                    <tr>
                      <th>{t('advanced.table.doctor')}</th>
                      <th className="text-right">{t('advanced.table.visits')}</th>
                      <th className="text-right">{t('advanced.table.visitRevenue')}</th>
                      <th className="text-right">{t('advanced.table.testCount')}</th>
                      <th className="text-right">{t('advanced.table.testRevenue')}</th>
                      <th className="text-right">
                        <span className="inline-flex items-center gap-1 justify-end">
                          {t('advanced.table.testCommission')}
                          <span
                            title={t('advanced.table.feesCommissionTooltip', { defaultValue: 'Sum of all commissions paid to this doctor in the period.' })}
                            aria-label={t('advanced.table.feesCommissionTooltip', { defaultValue: 'Sum of all commissions paid to this doctor in the period.' })}
                            className="cursor-help text-[var(--color-text-muted)]"
                          >
                            <Info className="h-3.5 w-3.5" aria-hidden />
                          </span>
                        </span>
                      </th>
                      <th className="text-right">
                        <span className="inline-flex items-center gap-1 justify-end">
                          {t('advanced.table.hospitalRevenue')}
                          <span
                            title={t('advanced.table.hospitalRevenueTooltip', { defaultValue: 'Visit revenue + test revenue + referred-lab bill revenue − total commissions. The headline net per-doctor hospital revenue.' })}
                            aria-label={t('advanced.table.hospitalRevenueTooltip', { defaultValue: 'Visit revenue + test revenue + referred-lab bill revenue − total commissions. The headline net per-doctor hospital revenue.' })}
                            className="cursor-help text-[var(--color-text-muted)]"
                          >
                            <Info className="h-3.5 w-3.5" aria-hidden />
                          </span>
                        </span>
                      </th>
                      <th className="text-right">{t('common:actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDoctors.map(d => {
                      const testCommission = d.labTestCommissions ?? 0;
                      const hospitalRevenue = d.hospitalRevenue ?? d.netHospitalIncome;
                      const hasNegative = hospitalRevenue < 0;
                      return (
                        <tr key={d.id} data-testid="doctor-performance-row">
                          <td className="font-medium">{d.name}</td>
                          <td className="text-right font-data">{d.visitCount.toLocaleString()}</td>
                          <td className="text-right font-data font-semibold">{fmtFull(d.revenue)}</td>
                          <td className="text-right font-data">{(d.testCount ?? 0).toLocaleString()}</td>
                          <td className="text-right font-data text-purple-700">{fmtFull(d.testRevenue ?? 0)}</td>
                          <td className="text-right font-data text-amber-600">{fmtFull(testCommission)}</td>
                          <td className={`text-right font-data font-bold ${hasNegative ? 'text-[var(--color-error)]' : 'text-emerald-700'}`}>
                            <span className="inline-flex items-center gap-1 justify-end">
                              {hasNegative && (
                                <span
                                  title={t('advanced.table.netNegativeNote', { defaultValue: 'Net is negative — commissions exceed combined revenue for this period.' })}
                                  aria-label={t('advanced.table.netNegativeNote', { defaultValue: 'Net is negative — commissions exceed combined revenue for this period.' })}
                                  className="inline-flex"
                                >
                                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                                </span>
                              )}
                              {fmtFull(hospitalRevenue)}
                            </span>
                          </td>
                          <td className="text-right">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-secondary)]"
                              onClick={() => printDoctorReport([d], startDate, endDate, `${d.name} report`)}
                            >
                              <Printer className="h-3.5 w-3.5" />
                              {t('doctorReports.printOne', { defaultValue: 'Print Doctor' })}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
            {visibleDoctors.some(d => (d.hospitalRevenue ?? d.netHospitalIncome) < 0) && (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {t('advanced.table.netNegativeNote', { defaultValue: 'Net is negative — commissions (incl. lab/referral) exceed visit revenue for this doctor in the selected period.' })}
                </span>
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-8">{t('empty.noDocData')}</p>
        )}
      </div>

    </div>
  );
}
