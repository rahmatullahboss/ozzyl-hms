import { useState } from 'react';
import {
  Users, BedDouble, ClipboardPlus, ClipboardCheck,
  ArrowRightLeft, DollarSign, Download, Calendar,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { getTodayGMT6, formatDisplayDate } from '../lib/date-utils';

// ─── Types ──────────────────────────────────────────────────────────────────

interface AdmittedPatient {
  id: number;
  patient_name: string;
  mrn?: string;
  ward_name?: string;
  bed_number?: string;
  doctor_name?: string;
  admission_date: string;
  diagnosis?: string;
  status?: string;
}

interface WardOccupancy {
  ward_name: string;
  total_beds: number;
  occupied: number;
  available: number;
  occupancy_pct: number;
}

interface AdmissionRow {
  id: number;
  patient_name: string;
  admission_date: string;
  admission_type?: string;
  ward_name?: string;
  doctor_name?: string;
  diagnosis?: string;
}

interface DischargeRow {
  id: number;
  patient_name: string;
  admission_date: string;
  discharge_date: string;
  stay_days?: number;
  ward_name?: string;
  doctor_name?: string;
  discharge_type?: string;
}

interface TransferRow {
  id: number;
  patient_name: string;
  transfer_date: string;
  from_ward?: string;
  from_bed?: string;
  to_ward?: string;
  to_bed?: string;
  reason?: string;
}

interface RevenueData {
  total_revenue: number;
  by_type?: { type: string; amount: number; count: number }[];
  by_ward?: { ward_name: string; amount: number }[];
}

interface SummaryResponse<T> {
  data: T[];
  summary?: Record<string, number>;
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

type TabKey = 'current' | 'occupancy' | 'admissions' | 'discharges' | 'transfers' | 'revenue';

const TABS: { key: TabKey; icon: typeof Users; labelKey: string }[] = [
  { key: 'current', icon: Users, labelKey: 'ipdReports.tabs.current' },
  { key: 'occupancy', icon: BedDouble, labelKey: 'ipdReports.tabs.occupancy' },
  { key: 'admissions', icon: ClipboardPlus, labelKey: 'ipdReports.tabs.admissions' },
  { key: 'discharges', icon: ClipboardCheck, labelKey: 'ipdReports.tabs.discharges' },
  { key: 'transfers', icon: ArrowRightLeft, labelKey: 'ipdReports.tabs.transfers' },
  { key: 'revenue', icon: DollarSign, labelKey: 'ipdReports.tabs.revenue' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function downloadCsv(filename: string, rows: any[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return formatDisplayDate(d);
}

function SkeletonRows({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-gray-100">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-3 py-3">
              <div className="h-4 bg-gray-200 rounded animate-pulse w-3/4" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="text-center py-12 text-gray-400">{message}</td>
    </tr>
  );
}

function DateRangeFilter({
  from, to, onChangeFrom, onChangeTo,
}: {
  from: string; to: string;
  onChangeFrom: (v: string) => void; onChangeTo: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5">
        <Calendar className="w-4 h-4 text-gray-400" />
        <input
          type="date"
          aria-label="Report from date"
          value={from}
          onChange={e => onChangeFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
        />
      </div>
      <span className="text-gray-400 text-sm">to</span>
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          aria-label="Report to date"
          value={to}
          onChange={e => onChangeTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
        />
      </div>
    </div>
  );
}

function TableWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto bg-white rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        {children}
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-200">{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 text-gray-700 ${className}`}>{children}</td>;
}

// ─── Report Sections ────────────────────────────────────────────────────────

function CurrentAdmittedReport({ t }: { t: (k: string) => string }) {
  const { data, isLoading } = useApiQuery<{ admissions: AdmittedPatient[] }>(
    queryKeys.admissions.list({ status: 'admitted' }),
    '/api/admissions?status=admitted',
  );
  const rows = data?.admissions ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{rows.length} {t('ipdReports.currentPatients')}</p>
        <button
          onClick={() => downloadCsv('current-admissions.csv', rows)}
          className="flex items-center gap-1.5 text-sm text-[var(--color-primary)] hover:underline"
        >
          <Download className="w-4 h-4" /> CSV
        </button>
      </div>
      <TableWrapper>
        <thead>
          <tr>
            <Th>{t('ipdReports.col.patient')}</Th>
            <Th>MRN</Th>
            <Th>{t('ipdReports.col.ward')}</Th>
            <Th>{t('ipdReports.col.bed')}</Th>
            <Th>{t('ipdReports.col.doctor')}</Th>
            <Th>{t('ipdReports.col.admissionDate')}</Th>
            <Th>{t('ipdReports.col.duration')}</Th>
            <Th>{t('ipdReports.col.diagnosis')}</Th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <SkeletonRows cols={8} />
          ) : rows.length === 0 ? (
            <EmptyRow colSpan={8} message={t('ipdReports.noData')} />
          ) : (
            rows.map(r => {
              const days = r.admission_date
                ? Math.floor((Date.now() - new Date(r.admission_date).getTime()) / 86_400_000)
                : 0;
              return (
                <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <Td>{r.patient_name}</Td>
                  <Td>{r.mrn ?? '—'}</Td>
                  <Td>{r.ward_name ?? '—'}</Td>
                  <Td>{r.bed_number ?? '—'}</Td>
                  <Td>{r.doctor_name ?? '—'}</Td>
                  <Td>{fmtDate(r.admission_date)}</Td>
                  <Td>{days}d</Td>
                  <Td className="max-w-[200px] truncate">{r.diagnosis ?? '—'}</Td>
                </tr>
              );
            })
          )}
        </tbody>
      </TableWrapper>
    </div>
  );
}

function BedOccupancyReport({ t }: { t: (k: string) => string }) {
  const { data, isLoading } = useApiQuery<{ wards: WardOccupancy[] }>(
    queryKeys.ipdReports.wardPatients(),
    '/api/ipd-reports/ward-patients',
  );
  const rows = data?.wards ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{t('ipdReports.occupancyDesc')}</p>
        <button
          onClick={() => downloadCsv('bed-occupancy.csv', rows)}
          className="flex items-center gap-1.5 text-sm text-[var(--color-primary)] hover:underline"
        >
          <Download className="w-4 h-4" /> CSV
        </button>
      </div>
      <TableWrapper>
        <thead>
          <tr>
            <Th>{t('ipdReports.col.ward')}</Th>
            <Th>{t('ipdReports.col.totalBeds')}</Th>
            <Th>{t('ipdReports.col.occupied')}</Th>
            <Th>{t('ipdReports.col.available')}</Th>
            <Th>{t('ipdReports.col.occupancyPct')}</Th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <SkeletonRows cols={5} />
          ) : rows.length === 0 ? (
            <EmptyRow colSpan={5} message={t('ipdReports.noData')} />
          ) : (
            rows.map(r => (
              <tr key={r.ward_name} className="border-b border-gray-100 hover:bg-gray-50">
                <Td>{r.ward_name}</Td>
                <Td>{r.total_beds}</Td>
                <Td>{r.occupied}</Td>
                <Td>{r.available}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-200 rounded-full max-w-[80px]">
                      <div
                        className="h-2 bg-[var(--color-primary)] rounded-full"
                        style={{ width: `${Math.min(r.occupancy_pct, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium">{r.occupancy_pct}%</span>
                  </div>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </TableWrapper>
    </div>
  );
}

function AdmissionReport({ t }: { t: (k: string) => string }) {
  const today = getTodayGMT6();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const { data, isLoading } = useApiQuery<SummaryResponse<AdmissionRow>>(
    queryKeys.ipdReports.admissions(from, to),
    `/api/ipd-reports/admissions?from=${from}&to=${to}`,
  );
  const rows = data?.data ?? [];
  const summary = data?.summary;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <DateRangeFilter from={from} to={to} onChangeFrom={setFrom} onChangeTo={setTo} />
        <button
          onClick={() => downloadCsv('admission-report.csv', rows)}
          className="flex items-center gap-1.5 text-sm text-[var(--color-primary)] hover:underline"
        >
          <Download className="w-4 h-4" /> CSV
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KPICard title={t('ipdReports.kpi.total')} value={summary?.total ?? rows.length} icon={<ClipboardPlus className="w-5 h-5" />} />
        <KPICard title={t('ipdReports.kpi.emergency')} value={summary?.emergency ?? 0} icon={<ClipboardPlus className="w-5 h-5" />} />
        <KPICard title={t('ipdReports.kpi.planned')} value={summary?.planned ?? 0} icon={<ClipboardPlus className="w-5 h-5" />} />
      </div>

      <TableWrapper>
        <thead>
          <tr>
            <Th>{t('ipdReports.col.patient')}</Th>
            <Th>{t('ipdReports.col.admissionDate')}</Th>
            <Th>{t('ipdReports.col.type')}</Th>
            <Th>{t('ipdReports.col.ward')}</Th>
            <Th>{t('ipdReports.col.doctor')}</Th>
            <Th>{t('ipdReports.col.diagnosis')}</Th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <SkeletonRows cols={6} />
          ) : rows.length === 0 ? (
            <EmptyRow colSpan={6} message={t('ipdReports.noData')} />
          ) : (
            rows.map(r => (
              <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                <Td>{r.patient_name}</Td>
                <Td>{fmtDate(r.admission_date)}</Td>
                <Td><span className="capitalize">{r.admission_type ?? '—'}</span></Td>
                <Td>{r.ward_name ?? '—'}</Td>
                <Td>{r.doctor_name ?? '—'}</Td>
                <Td className="max-w-[200px] truncate">{r.diagnosis ?? '—'}</Td>
              </tr>
            ))
          )}
        </tbody>
      </TableWrapper>
    </div>
  );
}

function DischargeReport({ t }: { t: (k: string) => string }) {
  const today = getTodayGMT6();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const { data, isLoading } = useApiQuery<SummaryResponse<DischargeRow>>(
    queryKeys.ipdReports.discharges(from, to),
    `/api/ipd-reports/discharges?from=${from}&to=${to}`,
  );
  const rows = data?.data ?? [];
  const summary = data?.summary;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <DateRangeFilter from={from} to={to} onChangeFrom={setFrom} onChangeTo={setTo} />
        <button
          onClick={() => downloadCsv('discharge-report.csv', rows)}
          className="flex items-center gap-1.5 text-sm text-[var(--color-primary)] hover:underline"
        >
          <Download className="w-4 h-4" /> CSV
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <KPICard title={t('ipdReports.kpi.totalDischarges')} value={summary?.total ?? rows.length} icon={<ClipboardCheck className="w-5 h-5" />} />
        <KPICard title={t('ipdReports.kpi.avgStay')} value={`${summary?.avg_stay ?? 0}d`} icon={<ClipboardCheck className="w-5 h-5" />} />
      </div>

      <TableWrapper>
        <thead>
          <tr>
            <Th>{t('ipdReports.col.patient')}</Th>
            <Th>{t('ipdReports.col.admissionDate')}</Th>
            <Th>{t('ipdReports.col.dischargeDate')}</Th>
            <Th>{t('ipdReports.col.stayDays')}</Th>
            <Th>{t('ipdReports.col.ward')}</Th>
            <Th>{t('ipdReports.col.doctor')}</Th>
            <Th>{t('ipdReports.col.dischargeType')}</Th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <SkeletonRows cols={7} />
          ) : rows.length === 0 ? (
            <EmptyRow colSpan={7} message={t('ipdReports.noData')} />
          ) : (
            rows.map(r => (
              <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                <Td>{r.patient_name}</Td>
                <Td>{fmtDate(r.admission_date)}</Td>
                <Td>{fmtDate(r.discharge_date)}</Td>
                <Td>{r.stay_days ?? '—'}</Td>
                <Td>{r.ward_name ?? '—'}</Td>
                <Td>{r.doctor_name ?? '—'}</Td>
                <Td><span className="capitalize">{r.discharge_type ?? '—'}</span></Td>
              </tr>
            ))
          )}
        </tbody>
      </TableWrapper>
    </div>
  );
}

function TransferReport({ t }: { t: (k: string) => string }) {
  const today = getTodayGMT6();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const { data, isLoading } = useApiQuery<SummaryResponse<TransferRow>>(
    queryKeys.ipdReports.transfers(from, to),
    `/api/ipd-reports/transfers?from=${from}&to=${to}`,
  );
  const rows = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <DateRangeFilter from={from} to={to} onChangeFrom={setFrom} onChangeTo={setTo} />
        <button
          onClick={() => downloadCsv('bed-transfers.csv', rows)}
          className="flex items-center gap-1.5 text-sm text-[var(--color-primary)] hover:underline"
        >
          <Download className="w-4 h-4" /> CSV
        </button>
      </div>

      <TableWrapper>
        <thead>
          <tr>
            <Th>{t('ipdReports.col.patient')}</Th>
            <Th>{t('ipdReports.col.transferDate')}</Th>
            <Th>{t('ipdReports.col.fromWard')}</Th>
            <Th>{t('ipdReports.col.fromBed')}</Th>
            <Th>{t('ipdReports.col.toWard')}</Th>
            <Th>{t('ipdReports.col.toBed')}</Th>
            <Th>{t('ipdReports.col.reason')}</Th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <SkeletonRows cols={7} />
          ) : rows.length === 0 ? (
            <EmptyRow colSpan={7} message={t('ipdReports.noData')} />
          ) : (
            rows.map(r => (
              <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                <Td>{r.patient_name}</Td>
                <Td>{fmtDate(r.transfer_date)}</Td>
                <Td>{r.from_ward ?? '—'}</Td>
                <Td>{r.from_bed ?? '—'}</Td>
                <Td>{r.to_ward ?? '—'}</Td>
                <Td>{r.to_bed ?? '—'}</Td>
                <Td className="max-w-[200px] truncate">{r.reason ?? '—'}</Td>
              </tr>
            ))
          )}
        </tbody>
      </TableWrapper>
    </div>
  );
}

function RevenueReport({ t }: { t: (k: string) => string }) {
  const today = getTodayGMT6();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const { data, isLoading } = useApiQuery<RevenueData>(
    queryKeys.ipdReports.revenue(from, to),
    `/api/ipd-reports/revenue?from=${from}&to=${to}`,
  );

  const byType = data?.by_type ?? [];
  const byWard = data?.by_ward ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <DateRangeFilter from={from} to={to} onChangeFrom={setFrom} onChangeTo={setTo} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <KPICard
          title={t('ipdReports.kpi.totalRevenue')}
          value={`৳${(data?.total_revenue ?? 0).toLocaleString('en-BD')}`}
          icon={<DollarSign className="w-5 h-5" />}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2].map(i => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="h-5 w-32 bg-gray-200 rounded animate-pulse mb-4" />
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="h-4 bg-gray-100 rounded animate-pulse mb-2 w-full" />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {byType.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('ipdReports.revenueByType')}</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>{t('ipdReports.col.type')}</Th>
                    <Th>{t('ipdReports.col.amount')}</Th>
                    <Th>{t('ipdReports.col.count')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {byType.map(r => (
                    <tr key={r.type} className="border-b border-gray-100">
                      <Td><span className="capitalize">{r.type}</span></Td>
                      <Td>৳{r.amount.toLocaleString('en-BD')}</Td>
                      <Td>{r.count}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {byWard.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('ipdReports.revenueByWard')}</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>{t('ipdReports.col.ward')}</Th>
                    <Th>{t('ipdReports.col.amount')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {byWard.map(r => (
                    <tr key={r.ward_name} className="border-b border-gray-100">
                      <Td>{r.ward_name}</Td>
                      <Td>৳{r.amount.toLocaleString('en-BD')}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {byType.length === 0 && byWard.length === 0 && (
            <p className="text-sm text-gray-400 col-span-full text-center py-8">{t('ipdReports.noData')}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function IPDReports({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['common']);
  const [activeTab, setActiveTab] = useState<TabKey>('current');

  return (
    <DashboardLayout role={role}>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('ipdReports.title')}</h1>
          <p className="text-sm text-gray-500">{t('ipdReports.subtitle')}</p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-px">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  isActive
                    ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>

        {/* Report content */}
        {activeTab === 'current' && <CurrentAdmittedReport t={t} />}
        {activeTab === 'occupancy' && <BedOccupancyReport t={t} />}
        {activeTab === 'admissions' && <AdmissionReport t={t} />}
        {activeTab === 'discharges' && <DischargeReport t={t} />}
        {activeTab === 'transfers' && <TransferReport t={t} />}
        {activeTab === 'revenue' && <RevenueReport t={t} />}
      </div>
    </DashboardLayout>
  );
}
