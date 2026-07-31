import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  FileWarning,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserX,
  Wallet,
} from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiQuery } from '../../hooks/useApiQuery';

type AttentionSource = 'attendance' | 'housekeeping' | 'helpdesk' | 'mrd' | 'discharge' | 'cash';

type AttentionItem = {
  id: string;
  source: AttentionSource;
  sourceId: number | string | null;
  title: string;
  department?: string | null;
  assignedTo?: string | number | null;
  priority?: string | null;
  status: string;
  dueAt?: string | null;
  isOverdue?: boolean;
  requiresProof?: boolean;
  proofMissing?: boolean;
  requiresVerification?: boolean;
  link?: string;
};

type OperationsMonitorResponse = {
  date: string;
  generatedAt: string;
  unavailableModules: string[];
  summary: {
    pending: number;
    inProgress: number;
    overdue: number;
    proofMissing: number;
    verificationPending: number;
    critical: number;
  };
  attendance: {
    scheduled: number;
    checkedIn: number;
    present: number;
    late: number;
    absent: number;
    noCheckIn: number;
    checkedInWithoutRoster: number;
  };
  modules: {
    housekeeping: { total: number; pending: number; inProgress: number; completed: number; verified: number; verificationPending: number; overdue: number };
    helpdesk: { open: number; inProgress: number; escalated: number; critical: number; overdue: number };
    mrd: { pending: number; inProgress: number; overdue: number };
    discharge: { inProgress: number; ready: number; pendingChecklistItems: number; overdue: number };
    cash: { expenses: number; pendingExpenses: number; proofMissing: number; pendingHandovers: number; pendingHandoverAmount: number };
  };
  attentionItems: AttentionItem[];
};

const SOURCE_LABELS: Record<AttentionSource, string> = {
  attendance: 'Attendance',
  housekeeping: 'Housekeeping',
  helpdesk: 'Helpdesk',
  mrd: 'MRD',
  discharge: 'Discharge',
  cash: 'Cash',
};

const SOURCE_ORDER: AttentionSource[] = ['attendance', 'cash', 'housekeeping', 'helpdesk', 'mrd', 'discharge'];

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16);
  return parsed.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-BD', {
    style: 'currency',
    currency: 'BDT',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function statusBadgeClass(status: string, isOverdue?: boolean): string {
  if (isOverdue) return 'badge badge-danger';
  if (status === 'verified' || status === 'ready' || status === 'completed') return 'badge badge-success';
  if (status === 'in_progress') return 'badge badge-warning';
  if (status === 'escalated' || status === 'critical') return 'badge badge-danger';
  return 'badge badge-secondary';
}

function priorityLabel(priority?: string | null): string {
  if (!priority) return 'Normal';
  return priority.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function priorityWeight(priority?: string | null): number {
  switch (priority) {
    case 'critical':
    case 'urgent':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'normal':
      return 1;
    default:
      return 0;
  }
}

function buildSourceCounts(items: AttentionItem[]): Record<AttentionSource, number> {
  return items.reduce<Record<AttentionSource, number>>((acc, item) => {
    acc[item.source] += 1;
    return acc;
  }, {
    attendance: 0,
    housekeeping: 0,
    helpdesk: 0,
    mrd: 0,
    discharge: 0,
    cash: 0,
  });
}

function buildFlags(item: AttentionItem): string[] {
  const flags: string[] = [];
  if (item.isOverdue) flags.push('Overdue');
  if (item.proofMissing || item.requiresProof) flags.push('Proof');
  if (item.requiresVerification) flags.push('Verify');
  if (item.status === 'no_check_in') flags.push('No check-in');
  return flags;
}

function buildRiskSummary(data?: OperationsMonitorResponse) {
  if (!data) {
    return {
      label: 'Loading operations snapshot',
      message: 'Collecting attendance, task, proof, and cash-handover signals.',
      className: 'border-slate-200 bg-slate-50 text-slate-700',
      icon: <Clock className="w-5 h-5" />,
    };
  }

  if (data.summary.critical > 0 || data.attendance.noCheckIn > 0 || data.modules.cash.pendingHandovers > 0) {
    return {
      label: 'Critical operations watch',
      message: `${data.summary.critical} critical signal(s), ${data.attendance.noCheckIn} no check-in, ${data.modules.cash.pendingHandovers} cash handover issue(s).`,
      className: 'border-red-200 bg-red-50/70 text-red-800',
      icon: <AlertTriangle className="w-5 h-5" />,
    };
  }

  if (data.summary.overdue > 0 || data.summary.proofMissing > 0 || data.summary.verificationPending > 0) {
    return {
      label: 'Supervisor review needed',
      message: `${data.summary.overdue} overdue, ${data.summary.proofMissing} proof gap(s), ${data.summary.verificationPending} verification pending.`,
      className: 'border-amber-200 bg-amber-50/70 text-amber-800',
      icon: <ShieldCheck className="w-5 h-5" />,
    };
  }

  return {
    label: 'Operations look stable',
    message: 'No critical staff duty, proof, verification, or handover issue is visible for this date.',
    className: 'border-emerald-200 bg-emerald-50/70 text-emerald-800',
    icon: <CheckCircle2 className="w-5 h-5" />,
  };
}

export default function OperationsMonitorPage({ role = 'hospital_admin' }: { role?: string }) {
  const [selectedDate, setSelectedDate] = useState(todayIsoDate());
  const [sourceFilter, setSourceFilter] = useState<'all' | AttentionSource>('all');

  const queryUrl = `/api/operations-monitor/today?date=${selectedDate}`;
  const { data, isLoading, isError, refetch } = useApiQuery<OperationsMonitorResponse>(
    ['operations-monitor', selectedDate],
    queryUrl,
    { refetchInterval: 30000 },
  );

  const allAttentionItems = useMemo(() => {
    const items = data?.attentionItems ?? [];
    return [...items].sort((a, b) => {
      const overdueDiff = Number(Boolean(b.isOverdue)) - Number(Boolean(a.isOverdue));
      if (overdueDiff) return overdueDiff;
      const priorityDiff = priorityWeight(b.priority) - priorityWeight(a.priority);
      if (priorityDiff) return priorityDiff;
      return SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source);
    });
  }, [data?.attentionItems]);

  const sourceCounts = useMemo(() => buildSourceCounts(allAttentionItems), [allAttentionItems]);

  const attentionItems = useMemo(() => {
    return sourceFilter === 'all' ? allAttentionItems : allAttentionItems.filter((item) => item.source === sourceFilter);
  }, [allAttentionItems, sourceFilter]);

  const riskSummary = useMemo(() => buildRiskSummary(data), [data]);

  const attendanceCoverage = data?.attendance.scheduled
    ? Math.round(((data.attendance.checkedIn ?? 0) / data.attendance.scheduled) * 100)
    : 0;

  const cards = [
    { label: 'Overdue', value: data?.summary.overdue ?? 0, icon: <AlertTriangle className="w-5 h-5" />, sub: 'Needs supervisor attention' },
    { label: 'Pending', value: data?.summary.pending ?? 0, icon: <Clock className="w-5 h-5" />, sub: 'Open duty items' },
    { label: 'No check-in', value: data?.attendance.noCheckIn ?? 0, icon: <UserX className="w-5 h-5" />, sub: `${data?.attendance.scheduled ?? 0} staff scheduled` },
    { label: 'Proof missing', value: data?.summary.proofMissing ?? 0, icon: <FileWarning className="w-5 h-5" />, sub: 'Receipt/proof gaps' },
    { label: 'Verify pending', value: data?.summary.verificationPending ?? 0, icon: <ShieldCheck className="w-5 h-5" />, sub: 'Supervisor/admin checks' },
    { label: 'Cash handover', value: data?.modules.cash.pendingHandovers ?? 0, icon: <Wallet className="w-5 h-5" />, sub: formatCurrency(data?.modules.cash.pendingHandoverAmount ?? 0) },
  ];

  return (
    <DashboardLayout role={role}>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5" data-testid="operations-monitor-page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Operations Duty Monitor</h1>
            <p className="section-subtitle mt-1">
              Track staff attendance, overdue duties, proof gaps, verification queues, and cash handovers from one control room.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              aria-label="Select operations monitor date"
              type="date"
              className="input w-40"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
            <button type="button" className="btn-secondary" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>
        </div>

        <div role="status" className={`card p-4 border ${riskSummary.className}`} data-testid="operations-risk-banner">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div className="flex items-start gap-3">
              <span className="mt-0.5">{riskSummary.icon}</span>
              <div>
                <h2 className="font-semibold">{riskSummary.label}</h2>
                <p className="text-sm mt-1">{riskSummary.message}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center text-xs sm:text-sm">
              <div>
                <strong className="block text-lg font-data">{attentionItems.length}</strong>
                <span>Visible issues</span>
              </div>
              <div>
                <strong className="block text-lg font-data">{attendanceCoverage}%</strong>
                <span>Coverage</span>
              </div>
              <div>
                <strong className="block text-lg font-data">{data?.summary.critical ?? 0}</strong>
                <span>Critical</span>
              </div>
            </div>
          </div>
        </div>

        {data?.unavailableModules?.length ? (
          <div role="alert" className="card p-4 border-amber-200 bg-amber-50/60 text-amber-800">
            Some modules could not be loaded: {data.unavailableModules.join(', ')}. The rest of the monitor is still shown.
          </div>
        ) : null}

        {isError ? (
          <div role="alert" className="card p-5 border-red-200 bg-red-50/70 text-red-700">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="w-5 h-5" /> Failed to load operations monitor.
            </div>
            <button className="btn-secondary mt-3" onClick={() => refetch()}>Try again</button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {cards.map((card) => (
                <div key={card.label} className="card p-4" data-testid={`operations-card-${card.label.toLowerCase().replace(/\s+/g, '-')}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[var(--color-text-muted)]">{card.icon}</div>
                    {isLoading ? <div className="skeleton h-6 w-12 rounded" /> : <p className="text-2xl font-bold font-data">{card.value}</p>}
                  </div>
                  <p className="text-sm font-semibold mt-3">{card.label}</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">{card.sub}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <UserCheck className="w-4 h-4 text-[var(--color-text-muted)]" />
                  <h2 className="font-semibold">Attendance</h2>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span>Scheduled</span><strong className="text-right">{data?.attendance.scheduled ?? 0}</strong>
                  <span>Checked in</span><strong className="text-right">{data?.attendance.checkedIn ?? 0}</strong>
                  <span>Late</span><strong className="text-right">{data?.attendance.late ?? 0}</strong>
                  <span>Absent / no check-in</span><strong className="text-right">{data?.attendance.absent ?? 0}</strong>
                  <span>Without roster</span><strong className="text-right">{data?.attendance.checkedInWithoutRoster ?? 0}</strong>
                </div>
              </div>

              <div className="card p-4">
                <h2 className="font-semibold mb-3">Department queues</h2>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span>Housekeeping overdue</span><strong>{data?.modules.housekeeping.overdue ?? 0}</strong></div>
                  <div className="flex justify-between"><span>Helpdesk overdue</span><strong>{data?.modules.helpdesk.overdue ?? 0}</strong></div>
                  <div className="flex justify-between"><span>MRD overdue</span><strong>{data?.modules.mrd.overdue ?? 0}</strong></div>
                  <div className="flex justify-between"><span>Discharge checklist gaps</span><strong>{data?.modules.discharge.pendingChecklistItems ?? 0}</strong></div>
                </div>
              </div>

              <div className="card p-4">
                <h2 className="font-semibold mb-3">Last update</h2>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span>Report date</span><strong>{data?.date ?? selectedDate}</strong></div>
                  <div className="flex justify-between"><span>Generated</span><strong>{formatTime(data?.generatedAt)}</strong></div>
                  <div className="flex justify-between"><span>In progress</span><strong>{data?.summary.inProgress ?? 0}</strong></div>
                  <div className="flex justify-between"><span>Critical</span><strong>{data?.summary.critical ?? 0}</strong></div>
                </div>
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="p-4 flex flex-wrap gap-3 items-center border-b border-[var(--color-border-light)]">
                <div>
                  <h2 className="font-semibold">Attention items</h2>
                  <p className="text-xs text-[var(--color-text-muted)]">Overdue work, missing proof, pending verification, and handover issues.</p>
                </div>
                <select
                  className="input w-52 ml-auto"
                  value={sourceFilter}
                  onChange={(event) => setSourceFilter(event.target.value as 'all' | AttentionSource)}
                  aria-label="Filter attention items by source"
                >
                  <option value="all">All sources ({allAttentionItems.length})</option>
                  {Object.entries(SOURCE_LABELS).map(([source, label]) => (
                    <option key={source} value={source}>{label} ({sourceCounts[source as AttentionSource]})</option>
                  ))}
                </select>
              </div>

              <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-[var(--color-border-light)] bg-[var(--color-surface-muted)]/40">
                {SOURCE_ORDER.map((source) => (
                  <button
                    key={source}
                    type="button"
                    className={sourceFilter === source ? 'badge badge-primary' : 'badge badge-secondary'}
                    onClick={() => setSourceFilter(source)}
                  >
                    {SOURCE_LABELS[source]}: {sourceCounts[source]}
                  </button>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="table-base text-sm">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Issue</th>
                      <th>Department</th>
                      <th>Assigned</th>
                      <th>Status</th>
                      <th>Flags</th>
                      <th>Priority</th>
                      <th>Due</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      [...Array(5)].map((_, index) => (
                        <tr key={index}>{[...Array(9)].map((__, cell) => <td key={cell}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>
                      ))
                    ) : attentionItems.length === 0 ? (
                      <tr>
                        <td colSpan={9}>
                          <div className="p-8 text-center text-[var(--color-text-muted)]">
                            <CheckCircle2 className="w-8 h-8 mx-auto mb-2" />
                            No attention items for this filter.
                          </div>
                        </td>
                      </tr>
                    ) : (
                      attentionItems.map((item) => {
                        const flags = buildFlags(item);
                        return (
                          <tr key={item.id}>
                            <td>{SOURCE_LABELS[item.source]}</td>
                            <td className="font-medium max-w-md">{item.title}</td>
                            <td>{item.department ?? '—'}</td>
                            <td>{item.assignedTo ?? '—'}</td>
                            <td><span className={statusBadgeClass(item.status, item.isOverdue)}>{item.isOverdue ? 'Overdue' : item.status.replace(/_/g, ' ')}</span></td>
                            <td>
                              {flags.length ? (
                                <div className="flex flex-wrap gap-1">
                                  {flags.map((flag) => <span key={flag} className="badge badge-secondary">{flag}</span>)}
                                </div>
                              ) : '—'}
                            </td>
                            <td>{priorityLabel(item.priority)}</td>
                            <td>{formatTime(item.dueAt)}</td>
                            <td>
                              {item.link ? (
                                <a className="btn-ghost text-xs inline-flex items-center gap-1" href={item.link}>
                                  Open <ArrowUpRight className="w-3 h-3" />
                                </a>
                              ) : '—'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
