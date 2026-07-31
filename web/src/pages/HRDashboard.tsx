import { useState, useMemo } from 'react';
import {
  Users, Calendar, Clock, DollarSign, Plus, Check, Ban,
  ChevronRight, BarChart2, Search, AlertCircle, Briefcase,
  UserCheck, UserX, AlertTriangle, Fingerprint, ArrowUpRight, CalendarDays,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Link } from 'react-router';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import Modal from '../components/shared/Modal';
import { useFmt } from '../hooks/useFmt';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Staff { id: number; name: string; position: string; }
interface LeaveCategory { id: number; leave_name: string; max_days_per_year: number; description: string | null; }
interface LeaveRequest {
  id: number; staff_id: number; staff_name: string; leave_name: string;
  start_date: string; end_date: string; total_days: number; reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
}
interface Shift { id: number; shift_name: string; start_time: string; end_time: string; grace_period: number; }
interface AttendanceRow {
  id: number; staff_name: string; date: string; check_in: string | null;
  check_out: string | null; status: string; shift_name: string | null;
}
interface SummaryRow {
  staff_id: number; staff_name: string; position: string;
  present_days: number; late_days: number; absent_days: number; leave_days: number; half_days: number;
}
interface SalaryHead { id: number; head_name: string; head_type: 'earning' | 'deduction'; is_taxable: number; }
interface SalaryStructureItem {
  id: number; salary_head_id: number; head_name: string; head_type: string;
  amount: number; calculation_type: string;
}
interface PayrollRun {
  id: number; run_month: string; status: string;
  total_employees: number; total_gross: number; total_deductions: number; total_net: number;
}
interface DashboardStats {
  totalStaff: number; presentToday: number; pendingLeaves: number;
  currentPayrollRun: PayrollRun | null;
}

interface LivePunch {
  id: number;
  staff_id: number;
  staff_name: string;
  punch_time: string;
  punch_type: 'in' | 'out';
  source: string;
  status: string;
}
interface LivePunchFeed {
  staff: LivePunch[];
  summary: { total: number; present: number; absent: number; late: number; on_leave: number };
}

// ─── API response shapes ────────────────────────────────────────────────────
interface ListResponse<T> { data: T[]; }
interface StaffResponse { staff: (Staff & { status?: string })[]; }
interface StructureResponse { data: SalaryStructureItem[]; summary: { totalEarning: number; totalDeduction: number; netPay: number }; }
interface MessageResponse { message?: string; }

// ─── Helper ──────────────────────────────────────────────────────────────────

const TABS = ['overview', 'attendance'] as const;
type Tab = typeof TABS[number];

function formatPunchTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// LIVE PUNCH FEED SIDEBAR
// ══════════════════════════════════════════════════════════════════════════════
function LivePunchFeed() {
  const { t } = useTranslation(['hr', 'common']);

  const liveQuery = useApiQuery<LivePunchFeed>(
    queryKeys.attendance.live(),
    '/api/hr/biometric/punches/live',
    { refetchInterval: 30_000 },
  );

  const punches = liveQuery.data?.staff ?? [];
  const summary = liveQuery.data?.summary;

  if (liveQuery.isLoading) {
    return (
      <div className="card p-5 space-y-4">
        <div className="skeleton h-5 w-32 rounded" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="skeleton w-8 h-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <div className="skeleton h-3.5 w-24 rounded" />
                <div className="skeleton h-3 w-16 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const sourceBadge: Record<string, string> = {
    biometric: 'badge-info',
    rfid: 'badge-warning',
    manual: 'badge-neutral',
    web: 'badge-success',
    mobile: 'badge-success',
    device: 'badge-info',
  };

  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <h3 className="section-title">{t('hr:livePunch.title')}</h3>
        </div>
        {summary && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-[var(--color-text-muted)]">{t('hr:livePunch.present')}:</span>
              <span className="font-bold text-emerald-600">{summary.present}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <UserX className="w-3.5 h-3.5 text-red-500" />
              <span className="text-[var(--color-text-muted)]">{t('hr:livePunch.absent')}:</span>
              <span className="font-bold text-red-500">{summary.absent}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-[var(--color-text-muted)]">{t('hr:livePunch.late')}:</span>
              <span className="font-bold text-amber-500">{summary.late}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-[var(--color-text-muted)]">{t('hr:livePunch.onLeave')}:</span>
              <span className="font-bold text-blue-500">{summary.on_leave}</span>
            </div>
          </div>
        )}
      </div>

      <div className="max-h-[420px] overflow-y-auto divide-y divide-[var(--color-border)]">
        {punches.length === 0 ? (
          <EmptyState
            icon={<Fingerprint className="w-6 h-6 text-[var(--color-text-muted)]" />}
            title={t('hr:livePunch.noPunches')}
            description={t('hr:livePunch.noPunchesDesc')}
          />
        ) : punches.map(punch => (
          <div key={punch.id} className="px-4 py-3 flex items-center gap-3 hover:bg-[var(--color-border-light)] transition-colors">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
              punch.punch_type === 'in'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-100 text-slate-600'
            }`}>
              {punch.staff_name?.charAt(0)?.toUpperCase() ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{punch.staff_name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-data text-xs text-[var(--color-text-muted)]">
                  {formatPunchTime(punch.punch_time)}
                </span>
                <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                  punch.punch_type === 'in'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-600'
                }`}>
                  {punch.punch_type === 'in' ? 'IN' : 'OUT'}
                </span>
              </div>
            </div>
            <span className={`badge text-[10px] ${sourceBadge[punch.source] ?? 'badge-neutral'}`}>
              {punch.source}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PENDING LEAVE REQUESTS
// ══════════════════════════════════════════════════════════════════════════════
function PendingLeaveRequests() {
  const { t } = useTranslation(['hr', 'common']);
  const { fmtDate } = useFmt();
  const queryClient = useQueryClient();
  const [rejectModalId, setRejectModalId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const requestsQuery = useApiQuery<ListResponse<LeaveRequest>>(
    queryKeys.hr.leaveRequests(),
    '/api/hr/leave/requests?status=pending',
  );
  const requests = requestsQuery.data?.data ?? [];

  const approveMutation = useApiMutation<unknown, { id: number; action: 'approve' | 'reject'; rejectionReason?: string }>(
    'patch',
    (vars) => `/api/hr/leave/requests/${vars.id}/approve`,
    {
      onSuccess: (_data, vars) => {
        toast.success(vars.action === 'approve' ? t('hr:toasts.leaveApproved') : t('hr:toasts.leaveRejected'));
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.leaveRequests() });
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.dashboard() });
      },
      onError: (err) => { toast.error(err.message || t('hr:toasts.failed')); },
    },
  );

  const handleApprove = (id: number) => {
    approveMutation.mutate({ id, action: 'approve' });
  };

  const openRejectModal = (id: number) => {
    setRejectModalId(id);
    setRejectionReason('');
  };

  const handleReject = () => {
    if (rejectModalId === null) return;
    approveMutation.mutate({ id: rejectModalId, action: 'reject', rejectionReason: rejectionReason || undefined });
    setRejectModalId(null);
    setRejectionReason('');
  };

  if (requestsQuery.isLoading) {
    return (
      <div className="card p-5 space-y-3">
        <div className="skeleton h-5 w-40 rounded" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-12 w-full rounded" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="card overflow-hidden">
        <div className="p-5 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between">
            <h3 className="section-title">{t('hr:overview.pendingLeaveRequests')}</h3>
            <span className="badge badge-warning">{requests.length}</span>
          </div>
        </div>
        {requests.length === 0 ? (
          <EmptyState
            icon={<Calendar className="w-6 h-6 text-[var(--color-text-muted)]" />}
            title={t('hr:overview.noPendingLeaves')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('hr:table.staff')}</th>
                  <th>{t('hr:table.type')}</th>
                  <th>{t('hr:modals.startDate')}</th>
                  <th>{t('hr:modals.endDate')}</th>
                  <th>{t('hr:table.reason')}</th>
                  <th className="text-right">{t('hr:table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(req => (
                  <tr key={req.id}>
                    <td className="font-medium">{req.staff_name}</td>
                    <td>{req.leave_name}</td>
                    <td className="font-data text-sm">{fmtDate(req.start_date)}</td>
                    <td className="font-data text-sm">{fmtDate(req.end_date)}</td>
                    <td className="text-sm text-[var(--color-text-muted)] max-w-[200px] truncate">{req.reason || '—'}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleApprove(req.id)}
                          disabled={approveMutation.isPending}
                          className="btn-ghost px-2.5 py-1.5 text-emerald-600 hover:bg-emerald-50 text-xs font-medium"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {t('hr:buttons.approve')}
                        </button>
                        <button
                          onClick={() => openRejectModal(req.id)}
                          disabled={approveMutation.isPending}
                          className="btn-ghost px-2.5 py-1.5 text-red-600 hover:bg-red-50 text-xs font-medium"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          {t('hr:buttons.reject')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reject Reason Modal */}
      {rejectModalId !== null && (
        <Modal title={t('hr:modals.rejectLeave')} onClose={() => setRejectModalId(null)}>
          <div className="space-y-4">
            <p className="text-sm text-[var(--color-text-muted)]">{t('hr:modals.rejectLeaveDesc')}</p>
            <div>
              <label className="label">{t('hr:modals.rejectionReason')}</label>
              <textarea
                className="input min-h-[80px] resize-y"
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                placeholder={t('hr:modals.rejectionReasonPlaceholder')}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setRejectModalId(null)} className="btn-secondary">{t('common:cancel')}</button>
              <button onClick={handleReject} disabled={approveMutation.isPending} className="btn-primary bg-red-600 hover:bg-red-700">
                {approveMutation.isPending ? t('common:saving') : t('hr:buttons.rejectLeave')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TODAY'S SHIFTS WIDGET
// ══════════════════════════════════════════════════════════════════════════════
function TodaysShifts() {
  const { t } = useTranslation(['hr', 'common']);
  const today = new Date().toISOString().slice(0, 10);

  const { data: rosterData, isLoading } = useApiQuery(
    ['hr', 'roster', 'today', today],
    `/api/hr/roster?from=${today}&to=${today}`,
  );

  const { data: shiftsData } = useApiQuery(
    queryKeys.hr.shifts(),
    '/api/hr/attendance/shifts',
  );

  const roster = (rosterData as any)?.data || rosterData || [];
  const shifts: Shift[] = (shiftsData as any)?.data || shiftsData || [];

  const shiftGroups = useMemo(() => {
    const groups: Record<number, { shift: Shift; staff: string[] }> = {};
    for (const r of roster) {
      if (!groups[r.shift_id]) {
        const shift = shifts.find(s => s.id === r.shift_id);
        groups[r.shift_id] = { shift: shift || { id: r.shift_id, shift_name: r.shift_name, start_time: '', end_time: '', grace_period: 0 }, staff: [] };
      }
      groups[r.shift_id].staff.push(r.staff_name);
    }
    return Object.values(groups);
  }, [roster, shifts]);

  const defaultColors: Record<string, string> = {
    morning: 'bg-blue-50 border-blue-200 text-blue-700',
    evening: 'bg-amber-50 border-amber-200 text-amber-700',
    night: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  };

  const getGroupClass = (name: string) => {
    const lower = name?.toLowerCase() || '';
    if (lower.includes('morning')) return defaultColors.morning;
    if (lower.includes('evening')) return defaultColors.evening;
    if (lower.includes('night')) return defaultColors.night;
    return 'bg-gray-50 border-gray-200 text-gray-700';
  };

  if (isLoading) {
    return (
      <div className="card p-5">
        <div className="skeleton h-5 w-32 rounded mb-3" />
        <div className="flex gap-3">
          {[1,2,3].map(i => <div key={i} className="skeleton h-20 w-48 rounded" />)}
        </div>
      </div>
    );
  }

  if (shiftGroups.length === 0) {
    return (
      <div className="card p-5">
        <h3 className="section-title mb-2">
          <CalendarDays className="w-4 h-4 inline mr-1.5" />
          {t('hr:todayShifts', { defaultValue: "Today's Shifts" })}
        </h3>
        <p className="text-sm text-[var(--color-text-muted)]">{t('hr:noShiftsToday', { defaultValue: 'No shifts assigned for today' })}</p>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <h3 className="section-title mb-3">
        <CalendarDays className="w-4 h-4 inline mr-1.5" />
        {t('hr:todayShifts', { defaultValue: "Today's Shifts" })}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {shiftGroups.map(group => (
          <div key={group.shift.id} className={`rounded-xl border p-3 ${getGroupClass(group.shift.shift_name)}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-sm">{group.shift.shift_name}</span>
              <span className="badge text-xs">{group.staff.length}</span>
            </div>
            <div className="text-xs opacity-80 mb-2">
              {group.shift.start_time?.slice(0,5)} – {group.shift.end_time?.slice(0,5)}
            </div>
            <div className="flex flex-wrap gap-1">
              {group.staff.map((name, i) => (
                <span key={i} className="text-xs bg-white/60 dark:bg-black/20 rounded px-1.5 py-0.5">
                  {name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ══════════════════════════════════════════════════════════════════════════════
function OverviewTab({ stats, loading }: { stats: DashboardStats | null; loading: boolean }) {
  const { t } = useTranslation(['hr', 'common']);
  const { fmtCurrency, fmtMonth } = useFmt();
  const runStatusColor: Record<string, string> = {
    draft: 'badge-warning', locked: 'badge-info', approved: 'badge-success',
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard
          title={t('hr:overview.presentToday')}
          value={stats?.presentToday ?? 0}
          loading={loading}
          icon={<UserCheck className="w-5 h-5" />}
          iconBg="bg-emerald-50 text-emerald-600"
          index={0}
        />
        <KPICard
          title={t('hr:overview.absent')}
          value={stats ? Math.max(0, (stats.totalStaff ?? 0) - (stats.presentToday ?? 0)) : 0}
          loading={loading}
          icon={<UserX className="w-5 h-5" />}
          iconBg="bg-red-50 text-red-600"
          index={1}
        />
        <KPICard
          title={t('hr:overview.lateArrivals')}
          value={stats?.pendingLeaves ?? 0}
          loading={loading}
          icon={<AlertTriangle className="w-5 h-5" />}
          iconBg="bg-amber-50 text-amber-600"
          index={2}
        />
      </div>

      {/* Payroll quick-link */}
      <Link
        to="hr/payroll-generation"
        className="card p-4 flex items-center justify-between hover:bg-[var(--color-bg-hover)] transition-colors"
      >
        <div>
          <p className="text-sm text-[var(--color-text-muted)]">Payroll</p>
          <p className="font-semibold">Generate, review, and approve monthly payroll</p>
        </div>
        <ChevronRight className="w-5 h-5 text-[var(--color-text-muted)]" />
      </Link>

      {/* Today's Shifts */}
      <TodaysShifts />

      {/* 2-column layout: main content + live feed sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        {/* Main content column */}
        <div className="space-y-6">
          {/* Pending Leave Requests */}
          <PendingLeaveRequests />

          {/* Current Payroll Run (if exists) */}
          {stats?.currentPayrollRun && (
            <div className="card p-5">
              <h3 className="section-title mb-4">{t('hr:overview.currentPayroll')} — {fmtMonth(stats.currentPayrollRun.run_month)}</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><p className="section-subtitle">{t('hr:overview.totalEmployees')}</p><p className="font-bold text-lg">{stats.currentPayrollRun.total_employees}</p></div>
                <div><p className="section-subtitle">{t('hr:overview.totalGross')}</p><p className="font-bold text-lg">{fmtCurrency(stats.currentPayrollRun.total_gross)}</p></div>
                <div><p className="section-subtitle">{t('hr:overview.totalDeduction')}</p><p className="font-bold text-lg text-red-600">{fmtCurrency(stats.currentPayrollRun.total_deductions)}</p></div>
                <div><p className="section-subtitle">{t('hr:overview.netPay')}</p><p className="font-bold text-lg text-emerald-600">{fmtCurrency(stats.currentPayrollRun.total_net)}</p></div>
              </div>
              <div className="mt-3">
                <span className={`badge ${runStatusColor[stats.currentPayrollRun.status] ?? 'badge-neutral'}`}>
                  {t(`hr:payroll.status.${stats.currentPayrollRun.status}`)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Live Punch Feed sidebar */}
        <aside>
          <LivePunchFeed />
        </aside>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ATTENDANCE TAB
// ══════════════════════════════════════════════════════════════════════════════
function AttendanceTab({ staffList }: { staffList: Staff[] }) {
  const { t } = useTranslation(['hr', 'common']);
  const { fmtDate } = useFmt();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [view, setView] = useState<'summary' | 'detail'>('summary');
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [shiftForm, setShiftForm] = useState({ shiftName: '', startTime: '09:00', endTime: '17:00', gracePeriod: 15 });
  const [checkForm, setCheckForm] = useState({ staffId: '', shiftId: '', action: 'in' as 'in' | 'out' });

  // ── Queries ──
  const shiftsQuery = useApiQuery<ListResponse<Shift>>(
    queryKeys.hr.shifts(),
    '/api/hr/attendance/shifts',
  );
  const shifts = shiftsQuery.data?.data ?? [];

  const summaryQuery = useApiQuery<ListResponse<SummaryRow>>(
    queryKeys.hr.attendanceSummary(month),
    `/api/hr/attendance/summary?month=${month}`,
  );
  const summary = summaryQuery.data?.data ?? [];

  const attendanceQuery = useApiQuery<ListResponse<AttendanceRow>>(
    queryKeys.hr.attendanceReport(`${month}-01`, `${month}-31`),
    `/api/hr/attendance/report?from=${month}-01&to=${month}-31&limit=100`,
    { enabled: view === 'detail' },
  );
  const attendance = attendanceQuery.data?.data ?? [];

  const invalidateAttendance = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.hr.shifts() });
    queryClient.invalidateQueries({ queryKey: queryKeys.hr.attendanceSummary(month) });
    queryClient.invalidateQueries({ queryKey: queryKeys.hr.attendanceReport(`${month}-01`, `${month}-31`) });
  };

  // ── Mutations ──
  const saveShiftMutation = useApiMutation<unknown, typeof shiftForm>(
    'post',
    '/api/hr/attendance/shifts',
    {
      onSuccess: () => {
        toast.success(t('hr:toasts.shiftCreated'));
        setShowShiftModal(false);
        invalidateAttendance();
      },
      onError: () => { toast.error(t('hr:toasts.failed')); },
    },
  );

  const checkInMutation = useApiMutation<MessageResponse, { staffId: number; shiftId?: number }>(
    'post',
    '/api/hr/attendance/check-in',
    {
      onSuccess: (data) => {
        toast.success(data?.message || 'Done');
        setShowCheckInModal(false);
        invalidateAttendance();
      },
      onError: (err) => { toast.error(err.message || 'Failed'); },
    },
  );

  const checkOutMutation = useApiMutation<MessageResponse, { staffId: number }>(
    'post',
    '/api/hr/attendance/check-out',
    {
      onSuccess: (data) => {
        toast.success(data?.message || 'Done');
        setShowCheckInModal(false);
        invalidateAttendance();
      },
      onError: (err) => { toast.error(err.message || 'Failed'); },
    },
  );

  const saveShift = (e: React.FormEvent) => {
    e.preventDefault();
    saveShiftMutation.mutate(shiftForm);
  };

  const handleCheckInOut = (e: React.FormEvent) => {
    e.preventDefault();
    if (checkForm.action === 'in') {
      checkInMutation.mutate({
        staffId: Number(checkForm.staffId),
        shiftId: checkForm.shiftId ? Number(checkForm.shiftId) : undefined,
      });
    } else {
      checkOutMutation.mutate({ staffId: Number(checkForm.staffId) });
    }
  };

  const checkPending = checkInMutation.isPending || checkOutMutation.isPending;

  const statusColor: Record<string, string> = {
    present: 'badge-success', late: 'badge-warning', absent: 'badge-danger',
    leave: 'badge-info', half_day: 'badge-neutral',
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Shifts */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title">{t('hr:attendance.shifts')}</h3>
          <div className="flex gap-2">
            <button onClick={() => setShowCheckInModal(true)} className="btn-secondary">
              <Clock className="w-4 h-4" />{t('hr:attendance.checkIn')} / {t('hr:attendance.checkOut')}
            </button>
            <button onClick={() => setShowShiftModal(true)} className="btn-primary">
              <Plus className="w-4 h-4" />{t('hr:attendance.addShift')}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {shifts.map(sh => (
            <div key={sh.id} className="border border-[var(--color-border)] rounded-xl px-4 py-3 text-sm">
              <p className="font-semibold">{sh.shift_name}</p>
              <p className="text-[var(--color-text-muted)] font-data">{sh.start_time} – {sh.end_time}</p>
              {sh.grace_period > 0 && <p className="text-xs text-amber-600">+{sh.grace_period}min {t('hr:attendance.gracePeriod').toLowerCase()}</p>}
            </div>
          ))}
          {shifts.length === 0 && <p className="text-[var(--color-text-muted)] text-sm">{t('hr:empty.noData')}</p>}
        </div>
      </div>

      {/* Attendance Report */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 p-5 border-b border-[var(--color-border)]">
          <h3 className="section-title flex-1">{t('hr:attendance.report')}</h3>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="input w-44 py-1.5" />
          <div className="flex gap-1 border border-[var(--color-border)] rounded-lg overflow-hidden">
            {(['summary', 'detail'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${view === v ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)]'}`}>
                {v === 'summary' ? t('hr:attendance.monthlySummary') : t('hr:attendance.report')}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          {view === 'summary' ? (
            <table className="table-base">
              <thead><tr>
                <th>{t('hr:table.staff')}</th>
                <th className="text-center">{t('hr:attendance.presentDays')}</th>
                <th className="text-center">{t('hr:attendance.lateDays')}</th>
                <th className="text-center">{t('hr:attendance.absentDays')}</th>
                <th className="text-center">{t('hr:attendance.leaveDays')}</th>
                <th className="text-center">{t('hr:attendance.halfDays')}</th>
              </tr></thead>
              <tbody>
                {summary.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">{t('hr:empty.noData')}</td></tr>
                ) : summary.map(row => (
                  <tr key={row.staff_id}>
                    <td><div className="font-medium">{row.staff_name}</div><div className="text-xs text-[var(--color-text-muted)]">{row.position}</div></td>
                    <td className="text-center font-bold text-emerald-600">{row.present_days}</td>
                    <td className="text-center text-amber-600">{row.late_days}</td>
                    <td className="text-center text-red-600">{row.absent_days}</td>
                    <td className="text-center text-blue-600">{row.leave_days}</td>
                    <td className="text-center text-slate-500">{row.half_days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="table-base">
              <thead><tr>
                <th>{t('hr:table.staff')}</th><th>{t('hr:attendance.date')}</th>
                <th>{t('hr:attendance.checkIn')}</th><th>{t('hr:attendance.checkOut')}</th>
                <th>{t('hr:attendance.shiftName')}</th><th>{t('hr:attendance.status')}</th>
              </tr></thead>
              <tbody>
                {attendance.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">{t('hr:empty.noData')}</td></tr>
                ) : attendance.map(row => (
                  <tr key={row.id}>
                    <td className="font-medium">{row.staff_name}</td>
                    <td className="font-data text-sm">{fmtDate(row.date)}</td>
                    <td className="font-data text-sm text-emerald-600">{row.check_in ?? '—'}</td>
                    <td className="font-data text-sm text-slate-500">{row.check_out ?? '—'}</td>
                    <td className="text-sm">{row.shift_name ?? '—'}</td>
                    <td><span className={`badge ${statusColor[row.status] ?? 'badge-neutral'}`}>{t(`hr:attendance.${row.status}`)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Shift Modal */}
      {showShiftModal && (
        <Modal title={t('hr:attendance.addShift')} onClose={() => setShowShiftModal(false)}>
          <form onSubmit={saveShift} className="space-y-4">
            <div><label className="label">{t('hr:attendance.shiftName')} *</label>
              <input className="input" required value={shiftForm.shiftName}
                onChange={e => setShiftForm(f => ({ ...f, shiftName: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">{t('hr:attendance.startTime')}</label>
                <input className="input" type="time" value={shiftForm.startTime}
                  onChange={e => setShiftForm(f => ({ ...f, startTime: e.target.value }))} /></div>
              <div><label className="label">{t('hr:attendance.endTime')}</label>
                <input className="input" type="time" value={shiftForm.endTime}
                  onChange={e => setShiftForm(f => ({ ...f, endTime: e.target.value }))} /></div>
            </div>
            <div><label className="label">{t('hr:attendance.gracePeriod')}</label>
              <input className="input" type="number" min={0} value={shiftForm.gracePeriod}
                onChange={e => setShiftForm(f => ({ ...f, gracePeriod: Number(e.target.value) }))} /></div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowShiftModal(false)} className="btn-secondary">{t('common:cancel')}</button>
              <button type="submit" disabled={saveShiftMutation.isPending} className="btn-primary">
                {saveShiftMutation.isPending ? t('common:saving') : t('common:save')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Check-in/out Modal */}
      {showCheckInModal && (
        <Modal title={`${t('hr:attendance.checkIn')} / ${t('hr:attendance.checkOut')}`} onClose={() => setShowCheckInModal(false)}>
          <form onSubmit={handleCheckInOut} className="space-y-4">
            <div className="flex gap-2 border border-[var(--color-border)] rounded-lg overflow-hidden">
              {(['in', 'out'] as const).map(a => (
                <button key={a} type="button" onClick={() => setCheckForm(f => ({ ...f, action: a }))}
                  className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${checkForm.action === a ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)]'}`}>
                  {a === 'in' ? t('hr:attendance.checkIn') : t('hr:attendance.checkOut')}
                </button>
              ))}
            </div>
            <div><label className="label">{t('hr:table.staff')} *</label>
              <select className="input" required value={checkForm.staffId}
                onChange={e => setCheckForm(f => ({ ...f, staffId: e.target.value }))}>
                <option value="">{t('hr:modals.selectStaff')}</option>
                {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            {checkForm.action === 'in' && (
              <div><label className="label">{t('hr:modals.selectShift')}</label>
                <select className="input" value={checkForm.shiftId}
                  onChange={e => setCheckForm(f => ({ ...f, shiftId: e.target.value }))}>
                  <option value="">— {t('hr:empty.noData')} —</option>
                  {shifts.map(sh => <option key={sh.id} value={sh.id}>{sh.shift_name} ({sh.start_time}–{sh.end_time})</option>)}
                </select></div>
            )}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowCheckInModal(false)} className="btn-secondary">{t('common:cancel')}</button>
              <button type="submit" disabled={checkPending} className={`${checkForm.action === 'in' ? 'btn-primary' : 'btn-secondary'}`}>
                {checkPending ? t('common:saving') : (checkForm.action === 'in' ? t('hr:attendance.checkIn') : t('hr:attendance.checkOut'))}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function HRDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['hr', 'sidebar']);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const statsQuery = useApiQuery<DashboardStats>(
    queryKeys.hr.dashboard(),
    '/api/hr/dashboard',
  );

  const staffQuery = useApiQuery<StaffResponse>(
    queryKeys.hr.staff(),
    '/api/staff',
  );
  const staffList = (staffQuery.data?.staff ?? []).filter(s => s.status !== 'inactive');

  const tabIcons: Record<Tab, React.ReactNode> = {
    overview:   <BarChart2 className="w-4 h-4" />,
    attendance: <Clock className="w-4 h-4" />,
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Briefcase className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('hr:title')}</h1>
              <p className="section-subtitle">{t('hr:subtitle')}</p>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 border border-[var(--color-border)] rounded-xl p-1 bg-[var(--color-bg-card)] w-fit">
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                activeTab === tab
                  ? 'bg-[var(--color-primary)] text-white shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border-light)]'
              }`}>
              {tabIcons[tab]}
              {t(`hr:tabs.${tab}`)}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'overview'   && <OverviewTab stats={statsQuery.data ?? null} loading={statsQuery.isLoading} />}
        {activeTab === 'attendance' && <AttendanceTab staffList={staffList} />}
      </div>
    </DashboardLayout>
  );
}
