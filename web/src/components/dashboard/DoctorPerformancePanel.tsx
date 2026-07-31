import { Fragment, useState } from 'react';
import {
  ArrowDownUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Stethoscope,
} from 'lucide-react';
import type {
  DoctorPerformanceResponse,
  DoctorPerformanceRow,
  DoctorSort,
} from '../../types/executiveDashboard';
import DoctorPerformanceRowDetails from './DoctorPerformanceRowDetails';

interface Props {
  data?: DoctorPerformanceResponse;
  loading: boolean;
  error: boolean;
  sortBy: DoctorSort;
  onDoctorOpen: (doctor: DoctorPerformanceRow) => void;
  onPageChange: (page: number) => void;
  onSortChange: (sortBy: DoctorSort) => void;
}

const count = (value: number) => new Intl.NumberFormat('en-BD', {
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const money = (value: number) => `৳${new Intl.NumberFormat('en-BD', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value || 0))}`;

function totalCollection(doctor: DoctorPerformanceRow): number {
  return Number(doctor.visitCollection || 0) + Number(doctor.testCollection || 0);
}

function activityLabel(value?: string | null): string {
  if (!value) return 'No activity';
  return value
    .split('_')
    .filter(Boolean)
    .map((part, index) => index === 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part)
    .join(' ');
}

function activityDate(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-BD', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

interface SortHeaderProps {
  label: string;
  value: DoctorSort;
  active: boolean;
  onChange: (value: DoctorSort) => void;
}

function SortHeader({ label, value, active, onChange }: SortHeaderProps) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 items-center justify-end gap-1 whitespace-nowrap rounded-md px-1 ${active ? 'font-bold text-[var(--color-primary)]' : 'font-semibold text-[var(--color-text-secondary)]'}`}
      aria-label={`Sort by ${label.toLowerCase()}`}
      onClick={() => onChange(value)}
    >
      {label}
      <ArrowDownUp className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

function DoctorButton({ doctor, onOpen }: { doctor: DoctorPerformanceRow; onOpen: (doctor: DoctorPerformanceRow) => void }) {
  return (
    <button
      type="button"
      className="min-h-11 text-left font-semibold text-[var(--color-primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      aria-label={`Open ${doctor.doctorName} details`}
      onClick={() => onOpen(doctor)}
    >
      {doctor.doctorName}
    </button>
  );
}

export default function DoctorPerformancePanel({
  data,
  loading,
  error,
  sortBy,
  onDoctorOpen,
  onPageChange,
  onSortChange,
}: Props) {
  const rows = data?.rows ?? [];
  const page = data?.page ?? 1;
  const [expandedDoctors, setExpandedDoctors] = useState<Set<string>>(new Set());

  const doctorKey = (doctor: DoctorPerformanceRow) => String(doctor.doctorId ?? 'unassigned');
  const isExpanded = (doctor: DoctorPerformanceRow) => expandedDoctors.has(doctorKey(doctor));
  const toggleExpanded = (doctor: DoctorPerformanceRow) => {
    const key = doctorKey(doctor);
    setExpandedDoctors((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section className="card min-w-0 overflow-hidden" data-testid="doctor-performance-panel">
      <div className="flex flex-col gap-2 border-b border-[var(--color-border)] p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Doctor performance</p>
          <h2 className="section-title mt-1">Doctor-wise activity and compensation</h2>
          <p className="section-subtitle mt-1">
            {data?.period?.label ?? 'Selected reporting period'} · Collection, payable, paid, outstanding, and latest activity remain visible; secondary calculations expand on demand.
          </p>
        </div>
        <Stethoscope className="h-5 w-5 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
      </div>

      {loading ? (
        <div className="space-y-3 p-4" aria-label="Loading doctor performance">
          <div className="skeleton h-24 rounded-xl" />
          <div className="skeleton h-24 rounded-xl" />
          <div className="skeleton h-24 rounded-xl" />
        </div>
      ) : error ? (
        <div role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Unable to load doctor performance.</div>
      ) : rows.length === 0 ? (
        <p className="p-5 text-sm text-[var(--color-text-muted)]">No doctor activity was found for this period.</p>
      ) : (
        <>
          <div className="hidden min-w-0 lg:block">
            <table data-testid="doctor-performance-desktop-table" className="w-full table-fixed text-sm">
              <thead className="bg-[var(--color-bg-secondary)] text-left">
                <tr>
                  <th className="w-[18%] px-4 py-2 font-semibold text-[var(--color-text-secondary)]">Doctor</th>
                  <th aria-sort={sortBy === 'visits' ? 'descending' : 'none'} className="w-[8%] px-2 py-2 text-right">
                    <SortHeader label="Visits" value="visits" active={sortBy === 'visits'} onChange={onSortChange} />
                  </th>
                  <th aria-sort={sortBy === 'tests' ? 'descending' : 'none'} className="w-[8%] px-2 py-2 text-right">
                    <SortHeader label="Referred" value="tests" active={sortBy === 'tests'} onChange={onSortChange} />
                  </th>
                  <th className="w-[8%] px-2 py-2 text-right font-semibold text-[var(--color-text-secondary)]">Performed</th>
                  <th className="w-[12%] px-2 py-2 text-right font-semibold text-[var(--color-text-secondary)]">Collection</th>
                  <th aria-sort={sortBy === 'payableCommission' || sortBy === 'totalCommission' ? 'descending' : 'none'} className="w-[11%] px-2 py-2 text-right">
                    <SortHeader label="Payable" value="payableCommission" active={sortBy === 'payableCommission' || sortBy === 'totalCommission'} onChange={onSortChange} />
                  </th>
                  <th className="w-[10%] px-2 py-2 text-right font-semibold text-[var(--color-text-secondary)]">Paid</th>
                  <th aria-sort={sortBy === 'outstandingCommission' ? 'descending' : 'none'} className="w-[11%] px-2 py-2 text-right">
                    <SortHeader label="Outstanding" value="outstandingCommission" active={sortBy === 'outstandingCommission'} onChange={onSortChange} />
                  </th>
                  <th className="w-[14%] px-3 py-2 font-semibold text-[var(--color-text-secondary)]">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {rows.map((doctor) => {
                  const expanded = isExpanded(doctor);
                  const detailsId = `doctor-row-details-${doctorKey(doctor)}`;
                  return (
                    <Fragment key={doctorKey(doctor)}>
                      <tr className="hover:bg-[var(--color-bg-secondary)]/70">
                        <td className="px-4 py-2 align-top">
                          <DoctorButton doctor={doctor} onOpen={onDoctorOpen} />
                          <button
                            type="button"
                            className="mt-1 flex min-h-11 items-center gap-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
                            aria-expanded={expanded}
                            aria-controls={detailsId}
                            aria-label={`${expanded ? 'Hide' : 'Show'} more metrics for ${doctor.doctorName}`}
                            onClick={() => toggleExpanded(doctor)}
                          >
                            {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                            {expanded ? 'Less' : 'More'}
                          </button>
                        </td>
                        <td className="px-2 py-3 text-right font-data">{count(doctor.visits)}</td>
                        <td className="px-2 py-3 text-right font-data">{count(doctor.referredTests)}</td>
                        <td className="px-2 py-3 text-right font-data">{count(doctor.performedTests)}</td>
                        <td className="px-2 py-3 text-right font-data font-semibold">{money(totalCollection(doctor))}</td>
                        <td className="px-2 py-3 text-right font-data font-bold">{money(doctor.payableCommission)}</td>
                        <td className="px-2 py-3 text-right font-data">{money(doctor.paidCommission)}</td>
                        <td className={`px-2 py-3 text-right font-data ${doctor.outstandingCommission > 0 ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}`}>{money(doctor.outstandingCommission)}</td>
                        <td className="px-3 py-3 align-top">
                          <span className="block text-xs font-semibold text-[var(--color-text-primary)]">{activityLabel(doctor.lastActivityType)}</span>
                          {activityDate(doctor.lastActivityAt) ? <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{activityDate(doctor.lastActivityAt)}</span> : null}
                        </td>
                      </tr>
                      {expanded ? (
                        <tr id={detailsId}>
                          <td colSpan={9} className="bg-[var(--color-bg-secondary)]/40 px-4 py-3">
                            <DoctorPerformanceRowDetails doctor={doctor} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div data-testid="doctor-performance-mobile-list" className="space-y-3 p-3 lg:hidden">
            {rows.map((doctor) => {
              const expanded = isExpanded(doctor);
              const detailsId = `doctor-mobile-details-${doctorKey(doctor)}`;
              return (
                <article key={doctorKey(doctor)} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <DoctorButton doctor={doctor} onOpen={onDoctorOpen} />
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {activityLabel(doctor.lastActivityType)}{activityDate(doctor.lastActivityAt) ? ` · ${activityDate(doctor.lastActivityAt)}` : ''}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${doctor.outstandingCommission > 0 ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'}`}>
                      {doctor.outstandingCommission > 0 ? 'Outstanding' : 'Settled'}
                    </span>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-2">
                    <div><dt className="text-xs text-[var(--color-text-muted)]">Visits</dt><dd className="font-data font-semibold">{count(doctor.visits)}</dd></div>
                    <div><dt className="text-xs text-[var(--color-text-muted)]">Referred</dt><dd className="font-data font-semibold">{count(doctor.referredTests)}</dd></div>
                    <div><dt className="text-xs text-[var(--color-text-muted)]">Performed</dt><dd className="font-data font-semibold">{count(doctor.performedTests)}</dd></div>
                    <div><dt className="text-xs text-[var(--color-text-muted)]">Collection</dt><dd className="font-data font-semibold">{money(totalCollection(doctor))}</dd></div>
                    <div><dt className="text-xs text-[var(--color-text-muted)]">Payable</dt><dd className="font-data font-bold">{money(doctor.payableCommission)}</dd></div>
                    <div><dt className="text-xs text-[var(--color-text-muted)]">Paid / Outstanding</dt><dd className="font-data font-semibold">{money(doctor.paidCommission)} / {money(doctor.outstandingCommission)}</dd></div>
                  </dl>

                  <button
                    type="button"
                    className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]"
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    aria-label={`${expanded ? 'Hide' : 'Show'} more metrics for ${doctor.doctorName}`}
                    onClick={() => toggleExpanded(doctor)}
                  >
                    {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                    {expanded ? 'Hide secondary metrics' : 'Show secondary metrics'}
                  </button>
                  {expanded ? (
                    <div id={detailsId} className="mt-3">
                      <DoctorPerformanceRowDetails doctor={doctor} />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)]">
            <span>Page {page} · {data?.totalRows.toLocaleString() ?? 0} doctors</span>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary min-h-11 min-w-11 text-xs" aria-label="Previous doctor page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" className="btn-secondary min-h-11 min-w-11 text-xs" aria-label="Next doctor page" disabled={!data?.hasNextPage} onClick={() => onPageChange(page + 1)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
