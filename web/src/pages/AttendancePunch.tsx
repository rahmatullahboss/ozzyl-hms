import { useState, useEffect, useRef, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  Fingerprint, Search, RefreshCw, Plus, Copy,
  Users, UserCheck, UserX, AlertTriangle, CalendarOff,
  Monitor, Wifi, WifiOff, ChevronLeft, ChevronRight,
  Filter, ArrowUpDown, Check, Shield,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { api } from '../lib/apiClient';
import Modal from '../components/shared/Modal';

// ─── Types ──────────────────────────────────────────────────────────────────

type TabKey = 'live' | 'log' | 'devices' | 'enrollments';

type PunchStatus = 'in' | 'out' | 'late' | 'break' | 'absent' | 'leave' | 'off_day' | 'incomplete';
type PunchType = 'in' | 'out' | 'break_start' | 'break_end';
type PunchSource = 'biometric' | 'rfid' | 'manual' | 'web';
type DeviceType = 'fingerprint' | 'rfid' | 'face' | 'card' | 'combo';
type EnrollmentType = 'fingerprint' | 'rfid' | 'face' | 'card' | 'pin';

interface LiveStaff {
  id: number;
  name: string;
  position: string;
  department: string;
  status: PunchStatus;
  last_punch_time: string | null;
  avatar_url?: string | null;
}

interface LiveSummary {
  total: number;
  present: number;
  absent: number;
  late: number;
  on_leave: number;
}

interface LiveResponse {
  staff?: LiveStaff[];
  summary?: LiveSummary;
}

interface PunchRecord {
  id: number;
  staff_id: number;
  staff_name: string;
  punch_time: string;
  punch_type: PunchType;
  source: PunchSource;
  device_name: string | null;
  is_valid: boolean;
}

interface PunchLogResponse {
  punches?: PunchRecord[];
  records?: PunchRecord[];
  total?: number;
  totalPages?: number;
}

interface Device {
  id: number;
  device_name: string;
  device_type: DeviceType;
  serial_number: string;
  ip_address: string | null;
  location: string | null;
  is_active: boolean;
  last_sync: string | null;
}

interface DevicesResponse {
  devices?: Device[];
}

interface Enrollment {
  id: number;
  staff_id: number;
  enrollment_type: EnrollmentType;
  enrollment_code: string;
  device_name: string | null;
  enrolled_at: string;
  is_active: boolean;
}

interface EnrollmentsResponse {
  enrollments?: Enrollment[];
}

interface StaffOption {
  id: number;
  name: string;
  position: string;
  department?: string;
}

interface StaffOptionsResponse {
  staff?: StaffOption[];
}

interface RegisterDeviceResponse {
  api_key?: string;
  apiKey?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────


const STATUS_CONFIG = (t: any): Record<PunchStatus, { label: string; badge: string }> => ({
  in:         { label: t('status.in'), badge: 'badge-success' },
  out:        { label: t('status.out'), badge: 'badge-neutral' },
  late:       { label: t('status.late'), badge: 'badge-warning' },
  break:      { label: t('status.break'), badge: 'bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full' },
  absent:     { label: t('status.absent', { defaultValue: 'Absent' }), badge: 'badge-danger' },
  leave:      { label: t('status.leave', { defaultValue: 'On leave' }), badge: 'badge-neutral' },
  off_day:    { label: t('status.offDay', { defaultValue: 'Off day' }), badge: 'badge-neutral' },
  incomplete: { label: t('status.incomplete', { defaultValue: 'Incomplete' }), badge: 'badge-warning' },
});

const PUNCH_TYPE_LABELS = (t: any): Record<PunchType, string> => ({
  in: t('live.clockIn'),
  out: t('live.clockOut'),
  break_start: t('live.breakStart'),
  break_end: t('live.breakEnd'),
});

const SOURCE_LABELS = (t: any): Record<string, string> => ({
  biometric: t('punchLog.sourceDevice', { defaultValue: 'Device' }),
  rfid: 'RFID',
  manual: t('live.manualPunch'),
  web: 'Web',
});

const DEVICE_TYPE_LABELS = (t: any): Record<string, string> => ({
  fingerprint: t('devices.deviceTypes.fingerprint'),
  rfid: t('devices.deviceTypes.rfid'),
  face: t('devices.deviceTypes.face'),
  card: t('devices.deviceTypes.card'),
  combo: t('devices.deviceTypes.combo'),
});

const ENROLLMENT_TYPE_LABELS = (t: any): Record<string, string> => ({
  fingerprint: t('enrollments.enrollmentTypes.fingerprint'),
  rfid: t('enrollments.enrollmentTypes.rfid'),
  face: t('enrollments.enrollmentTypes.face'),
  card: t('enrollments.enrollmentTypes.card'),
  pin: t('enrollments.enrollmentTypes.pin'),
});


// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function fmtTime(iso: string | null, lang: string): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  const locale = lang === 'bn' ? 'bn-BD' : 'en-GB';
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmtDate(iso: string, lang: string): string {
  const locale = lang === 'bn' ? 'bn-BD' : 'en-GB';
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso: string | null, t: any, lang: string): string {
  if (!iso) return t('status.never');
  const d = new Date(iso);
  const locale = lang === 'bn' ? 'bn-BD' : 'en-GB';
  return `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: true })}`;
}

function maskCode(code: string): string {
  if (code.length <= 4) return '****';
  return code.slice(0, 2) + '*'.repeat(code.length - 4) + code.slice(-2);
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// LIVE BOARD TAB
// ═══════════════════════════════════════════════════════════════════════════

type SortField = 'name' | 'department' | 'status';

function LiveBoardTab() {
  const { t, i18n } = useTranslation('attendance');
  const statusConfig = useMemo(() => STATUS_CONFIG(t), [t]);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [showManual, setShowManual] = useState(false);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);

  // Manual punch form
  const [manualForm, setManualForm] = useState({
    staff_id: '',
    punch_type: 'in' as PunchType,
    time: '',
    remarks: '',
  });

  // ── Fetch live data with 30s polling ──────────────────────────────────
  const { data: liveData, isLoading: loading } = useApiQuery<LiveResponse>(
    queryKeys.attendance.live(),
    '/api/hr/biometric/punches/live',
    { refetchInterval: 30000 },
  );

  const staff: LiveStaff[] = liveData?.staff ?? [];
  const summary: LiveSummary = liveData?.summary ?? { total: 0, present: 0, absent: 0, late: 0, on_leave: 0 };

  // ── Manual punch mutation ─────────────────────────────────────────────
  const manualPunchMutation = useApiMutation<unknown, {
    staffId: number;
    punchType: PunchType;
    punchTime: string;
    reason: string;
    sourceEventKey: string;
  }>(
    'post',
    '/api/hr/biometric/punch/manual',
    {
      onSuccess: () => {
        toast.success(t('toast.manualPunchRecorded'));
        setShowManual(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.attendance.all });
      },
      onError: (err) => {
        toast.error(err?.message ?? t('toast.failedRecordPunch'));
      },
    },
  );

  const fetchStaffOptions = async () => {
    try {
      const res = await api.get<StaffOptionsResponse & StaffOption[]>('/api/staff');
      setStaffOptions((res as StaffOptionsResponse)?.staff ?? (res as StaffOption[]) ?? []);
    } catch { /* ignore */ }
  };

  const openManual = () => {
    fetchStaffOptions();
    setManualForm({ staff_id: '', punch_type: 'in', time: '', remarks: '' });
    setShowManual(true);
  };

  const submitManualPunch = () => {
    if (!manualForm.staff_id) { toast.error(t('toast.selectStaffMember')); return; }
    const reason = manualForm.remarks.trim();
    if (!reason) { toast.error(t('toast.allFieldsRequired')); return; }
    const punchTime = manualForm.time
      ? new Date(manualForm.time).toISOString()
      : new Date().toISOString();
    manualPunchMutation.mutate({
      staffId: Number(manualForm.staff_id),
      punchType: manualForm.punch_type,
      punchTime,
      reason,
      sourceEventKey: `manual:${crypto.randomUUID()}`,
    });
  };

  // Derived data
  const departments = Array.from(new Set(staff.map(s => s.department).filter(Boolean))).sort();

  const filtered = staff
    .filter(s => {
      if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !s.department.toLowerCase().includes(search.toLowerCase())) return false;
      if (deptFilter && s.department !== deptFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'department') return a.department.localeCompare(b.department);
      const order: Record<PunchStatus, number> = {
        in: 0,
        late: 1,
        break: 2,
        incomplete: 3,
        absent: 4,
        leave: 5,
        off_day: 6,
        out: 7,
      };
      return order[a.status] - order[b.status];
    });

  const refreshLive = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.attendance.live() });
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <KPICard title={t("live.totalStaff")} value={summary.total} loading={loading}
          icon={<Users className="w-5 h-5" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
        <KPICard title={t("live.presentNow")} value={summary.present} loading={loading}
          icon={<UserCheck className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={1} />
        <KPICard title={t("live.absent")} value={summary.absent} loading={loading}
          icon={<UserX className="w-5 h-5" />} iconBg="bg-red-50 text-red-600" index={2} />
        <KPICard title={t("live.late")} value={summary.late} loading={loading}
          icon={<AlertTriangle className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" index={3} />
        <KPICard title={t("live.onLeave")} value={summary.on_leave} loading={loading}
          icon={<CalendarOff className="w-5 h-5" />} iconBg="bg-purple-50 text-purple-600" index={4} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
          <input className="input pl-9 w-full" placeholder={t("live.searchPlaceholder")}
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-[var(--color-text-muted)]" />
          <select className="input py-1.5 text-sm" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="">{t("live.allDepartments")}</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-4 h-4 text-[var(--color-text-muted)]" />
          <select className="input py-1.5 text-sm" value={sortBy} onChange={e => setSortBy(e.target.value as SortField)}>
            <option value="name">{t("live.sort.name")}</option>
            <option value="department">{t("live.sort.department")}</option>
            <option value="status">{t("live.sort.status")}</option>
          </select>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button onClick={refreshLive} className="btn-ghost p-2" title={t("live.refreshNow")}>
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={openManual} className="btn-primary flex items-center gap-1.5 text-sm">
            <Plus className="w-4 h-4" /> {t("live.manualPunch")}
          </button>
        </div>
      </div>

      {/* Auto-refresh indicator */}
      <p className="text-xs text-[var(--color-text-muted)]">
        {t("live.autoRefreshInfo", { count: filtered.length })}
      </p>

      {/* Staff Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-slate-700" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-200 dark:bg-slate-700 rounded w-24" />
                  <div className="h-2.5 bg-gray-200 dark:bg-slate-700 rounded w-16" />
                </div>
                <div className="h-5 bg-gray-200 dark:bg-slate-700 rounded w-10" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Users className="w-10 h-10 mx-auto text-[var(--color-text-muted)] mb-3" />
          <p className="text-[var(--color-text-muted)]">{t("live.noStaffFound")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(s => {
            const cfg = statusConfig[s.status];
            return (
              <div key={s.id} className="card p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white font-bold text-sm shrink-0">
                  {getInitials(s.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{s.position}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{s.department}</p>
                </div>
                <div className="text-right shrink-0">
                  <span className={cfg.badge}>{t(`status.${s.status}`)}</span>
                  <p className="text-xs text-[var(--color-text-secondary)] font-data mt-0.5">
                    {fmtTime(s.last_punch_time, i18n.language)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Manual Punch Modal */}
      {showManual && (
        <Modal title={t("live.manualPunchTitle")} onClose={() => setShowManual(false)}>
          <div>
            <label className="label">{t("live.staffMember")}</label>
            <select className="input w-full" value={manualForm.staff_id}
              onChange={e => setManualForm(f => ({ ...f, staff_id: e.target.value }))}>
              <option value="">{t("live.selectStaff")}</option>
              {staffOptions.map(s => (
                <option key={s.id} value={s.id}>{s.name} - {s.position}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t("live.punchType")}</label>
            <select className="input w-full" value={manualForm.punch_type}
              onChange={e => setManualForm(f => ({ ...f, punch_type: e.target.value as PunchType }))}>
              <option value="in">{t("live.clockIn")}</option>
              <option value="out">{t("live.clockOut")}</option>
              <option value="break_start">{t("live.breakStart")}</option>
              <option value="break_end">{t("live.breakEnd")}</option>
            </select>
          </div>
          <div>
            <label className="label">{t("live.timeLabel")}</label>
            <input type="datetime-local" className="input w-full" value={manualForm.time}
              onChange={e => setManualForm(f => ({ ...f, time: e.target.value }))} />
          </div>
          <div>
            <label className="label">{t("live.remarks")}</label>
            <textarea className="input w-full" rows={2} placeholder={t("live.remarksPlaceholder")}
              value={manualForm.remarks} onChange={e => setManualForm(f => ({ ...f, remarks: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={() => setShowManual(false)}>{t("live.cancel")}</button>
            <button className="btn-primary flex items-center gap-1.5" onClick={submitManualPunch} disabled={manualPunchMutation.isPending}>
              {manualPunchMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {t("live.recordPunch")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PUNCH LOG TAB
// ═══════════════════════════════════════════════════════════════════════════

function PunchLogTab() {
  const { t, i18n } = useTranslation('attendance');
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const [staffFilter, setStaffFilter] = useState('');
  const [page, setPage] = useState(1);
  const limit = 50;

  // Build query string
  const queryParams = new URLSearchParams({ date, page: String(page), limit: String(limit) });
  if (staffFilter) queryParams.set('staff', staffFilter);

  const { data: logData, isLoading: loading } = useApiQuery<PunchLogResponse & PunchRecord[]>(
    queryKeys.attendance.punchLog(date, page, staffFilter),
    `/api/hr/biometric/punches?${queryParams.toString()}`,
  );

  const records: PunchRecord[] = (logData as PunchLogResponse)?.punches ?? (logData as PunchLogResponse)?.records ?? (logData as PunchRecord[]) ?? [];
  const totalPages = (logData as PunchLogResponse)?.totalPages ?? (Math.ceil(((logData as PunchLogResponse)?.total ?? 0) / limit) || 1);

  const refreshLog = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.attendance.punchLog(date, page, staffFilter) });
  };

  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label className="label text-xs">{t("punchLog.date")}</label>
          <input type="date" className="input" value={date}
            onChange={e => { setDate(e.target.value); setPage(1); }} />
        </div>
        <div>
          <label className="label text-xs">{t("punchLog.staffName")}</label>
          <input className="input" placeholder={t("punchLog.staffFilterPlaceholder")}
            value={staffFilter} onChange={e => { setStaffFilter(e.target.value); setPage(1); }} />
        </div>
        <button onClick={refreshLog} className="btn-ghost p-2 mt-5" title={t("punchLog.refresh")}>
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base w-full">
            <thead>
              <tr>
                <th className="text-left p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("punchLog.staffName")}</th>
                <th className="text-left p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("punchLog.punchTime")}</th>
                <th className="text-left p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("punchLog.type")}</th>
                <th className="text-left p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("punchLog.source")}</th>
                <th className="text-left p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("punchLog.device")}</th>
                <th className="text-center p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("punchLog.valid")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="p-3"><div className="h-4 bg-gray-200 dark:bg-slate-700 rounded animate-pulse w-20" /></td>
                    ))}
                  </tr>
                ))
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-[var(--color-text-muted)]">
                    {t("punchLog.noRecords", { date: fmtDate(date, i18n.language) })}
                  </td>
                </tr>
              ) : (
                records.map(r => (
                  <tr key={r.id} className="hover:bg-[var(--color-bg-secondary)] transition-colors">
                    <td className="p-3 text-sm font-medium">{r.staff_name}</td>
                    <td className="p-3 text-sm">{fmtDateTime(r.punch_time, t, i18n.language)}</td>
                    <td className="p-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        r.punch_type === 'in' ? 'bg-emerald-100 text-emerald-700' :
                        r.punch_type === 'out' ? 'bg-gray-100 text-gray-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {PUNCH_TYPE_LABELS(t)[r.punch_type]}
                      </span>
                    </td>
                    <td className="p-3 text-sm text-[var(--color-text-muted)]">{SOURCE_LABELS(t)[r.source] ?? r.source}</td>
                    <td className="p-3 text-sm text-[var(--color-text-muted)]">{r.device_name ?? '-'}</td>
                    <td className="p-3 text-center">
                      {r.is_valid ? (
                        <span className="badge-success">{t("status.valid")}</span>
                      ) : (
                        <span className="badge-warning">{t("status.invalid")}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-[var(--color-text-muted)]">{t("punchLog.pageInfo", { current: page, total: totalPages })}</p>
          <div className="flex items-center gap-2">
            <button className="btn-ghost p-2" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button className="btn-ghost p-2" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DEVICES TAB
// ═══════════════════════════════════════════════════════════════════════════

function DevicesTab() {
  const { t, i18n } = useTranslation('attendance');
  const queryClient = useQueryClient();
  const [showRegister, setShowRegister] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);

  const [form, setForm] = useState({
    device_name: '',
    device_type: 'fingerprint' as DeviceType,
    serial_number: '',
    ip_address: '',
    location: '',
  });

  // ── Fetch devices ─────────────────────────────────────────────────────
  const { data: devicesData, isLoading: loading } = useApiQuery<DevicesResponse & Device[]>(
    queryKeys.attendance.devices(),
    '/api/hr/biometric/devices',
  );

  const devices: Device[] = (devicesData as DevicesResponse)?.devices ?? (devicesData as Device[]) ?? [];

  // ── Register device mutation ──────────────────────────────────────────
  const registerMutation = useApiMutation<RegisterDeviceResponse, { device_name: string; device_type: DeviceType; serial_number: string; ip_address: string | null; location: string | null }>(
    'post',
    '/api/hr/biometric/devices',
    {
      onSuccess: (data) => {
        toast.success(t('toast.deviceRegistered'));
        setApiKey(data?.api_key ?? data?.apiKey ?? null);
        queryClient.invalidateQueries({ queryKey: queryKeys.attendance.all });
      },
      onError: (err) => {
        toast.error(err?.message ?? t('toast.failedRegisterDevice'));
      },
    },
  );

  // ── Toggle device mutation ────────────────────────────────────────────
  const toggleMutation = useApiMutation<unknown, { id: number; is_active: boolean }>(
    'patch',
    (vars) => `/api/hr/biometric/devices/${vars.id}`,
    {
      onSuccess: (_data, vars) => {
        toast.success(t(vars.is_active ? 'toast.deviceActivated' : 'toast.deviceDeactivated'));
        queryClient.invalidateQueries({ queryKey: queryKeys.attendance.all });
        setToggling(null);
      },
      onError: () => {
        toast.error(t('toast.failedUpdateDevice'));
        setToggling(null);
      },
    },
  );

  const openRegister = () => {
    setForm({ device_name: '', device_type: 'fingerprint', serial_number: '', ip_address: '', location: '' });
    setApiKey(null);
    setShowRegister(true);
  };

  const submitDevice = () => {
    if (!form.device_name || !form.serial_number) {
      toast.error(t('toast.deviceNameRequired'));
      return;
    }
    registerMutation.mutate({
      device_name: form.device_name,
      device_type: form.device_type,
      serial_number: form.serial_number,
      ip_address: form.ip_address || null,
      location: form.location || null,
    });
  };

  const copyKey = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      toast.success(t('toast.apiKeyCopied'));
    }
  };

  const toggleDevice = (device: Device) => {
    setToggling(device.id);
    toggleMutation.mutate({ id: device.id, is_active: !device.is_active });
  };

  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-text-muted)]">{t("devices.deviceCount", { count: devices.length })}</p>
        <button onClick={openRegister} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus className="w-4 h-4" /> {t("devices.registerDevice")}
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base w-full">
            <thead>
              <tr>
                <th className="text-left p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("devices.deviceName")}</th>
                <th className="text-left p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("devices.type")}</th>
                <th className="text-left p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("devices.serial")}</th>
                <th className="text-left p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("devices.ipAddress")}</th>
                <th className="text-left p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("devices.location")}</th>
                <th className="text-center p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("devices.status")}</th>
                <th className="text-left p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("devices.lastSync")}</th>
                <th className="text-center p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("devices.action")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="p-3"><div className="h-4 bg-gray-200 dark:bg-slate-700 rounded animate-pulse w-20" /></td>
                    ))}
                  </tr>
                ))
              ) : devices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-[var(--color-text-muted)]">
                    <Monitor className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    {t("devices.noDevices")}
                  </td>
                </tr>
              ) : (
                devices.map(d => (
                  <tr key={d.id} className="hover:bg-[var(--color-bg-secondary)] transition-colors">
                    <td className="p-3 text-sm font-medium">{d.device_name}</td>
                    <td className="p-3 text-sm">{DEVICE_TYPE_LABELS(t)[d.device_type] ?? d.device_type}</td>
                    <td className="p-3 text-sm font-mono text-[var(--color-text-muted)]">{d.serial_number}</td>
                    <td className="p-3 text-sm font-mono text-[var(--color-text-muted)]">{d.ip_address ?? '-'}</td>
                    <td className="p-3 text-sm text-[var(--color-text-muted)]">{d.location ?? '-'}</td>
                    <td className="p-3 text-center">
                      {d.is_active ? (
                        <span className="badge-success inline-flex items-center gap-1"><Wifi className="w-3 h-3" /> {t("status.active")}</span>
                      ) : (
                        <span className="badge-neutral inline-flex items-center gap-1"><WifiOff className="w-3 h-3" /> {t("status.inactive")}</span>
                      )}
                    </td>
                    <td className="p-3 text-sm text-[var(--color-text-muted)]">{fmtDateTime(d.last_sync, t, i18n.language)}</td>
                    <td className="p-3 text-center">
                      <button
                        className={`text-xs font-medium px-3 py-1 rounded-lg transition-colors ${
                          d.is_active
                            ? 'bg-red-50 text-red-600 hover:bg-red-100'
                            : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                        }`}
                        disabled={toggling === d.id}
                        onClick={() => toggleDevice(d)}
                      >
                        {toggling === d.id ? '...' : d.is_active ? t("devices.deactivate") : t("devices.activate")}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Register Device Modal */}
      {showRegister && (
        <Modal title={t("devices.registerDeviceTitle")} onClose={() => setShowRegister(false)}>
          {apiKey ? (
            <>
              <div className="flex items-center gap-2 text-emerald-600">
                <Check className="w-5 h-5" />
                <p className="font-semibold">{t("devices.deviceRegisteredSuccess")}</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mt-3">
                <p className="text-sm font-semibold text-amber-800 mb-1">{t("devices.apiKeyWarning")}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white px-3 py-2 rounded border text-sm font-mono break-all">{apiKey}</code>
                  <button onClick={copyKey} className="btn-ghost p-2" title={t("devices.copy")}>
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button className="btn-primary" onClick={() => setShowRegister(false)}>{t("devices.done")}</button>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="label">{t("devices.deviceName")}</label>
                <input className="input w-full" placeholder={t("devices.deviceNamePlaceholder")}
                  value={form.device_name} onChange={e => setForm(f => ({ ...f, device_name: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t("devices.type")}</label>
                <select className="input w-full" value={form.device_type}
                  onChange={e => setForm(f => ({ ...f, device_type: e.target.value as DeviceType }))}>
                  <option value="fingerprint">{t("devices.deviceTypes.fingerprint")}</option>
                  <option value="rfid">{t("devices.deviceTypes.rfid")}</option>
                  <option value="face">{t("devices.deviceTypes.face")}</option>
                  <option value="card">{t("devices.deviceTypes.card")}</option>
                  <option value="combo">{t("devices.deviceTypes.combo")}</option>
                </select>
              </div>
              <div>
                <label className="label">{t("devices.serialNumber")}</label>
                <input className="input w-full" placeholder={t("devices.serialPlaceholder")}
                  value={form.serial_number} onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t("devices.ipOptional")}</label>
                <input className="input w-full" placeholder={t("devices.ipPlaceholder")}
                  value={form.ip_address} onChange={e => setForm(f => ({ ...f, ip_address: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t("devices.locationOptional")}</label>
                <input className="input w-full" placeholder={t("devices.locationPlaceholder")}
                  value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn-secondary" onClick={() => setShowRegister(false)}>{t("enrollments.cancel")}</button>
                <button className="btn-primary flex items-center gap-1.5" onClick={submitDevice} disabled={registerMutation.isPending}>
                  {registerMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                  {t("devices.register")}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ENROLLMENTS TAB
// ═══════════════════════════════════════════════════════════════════════════

function EnrollmentsTab() {
  const { t, i18n } = useTranslation('attendance');
  const queryClient = useQueryClient();
  const [selectedStaff, setSelectedStaff] = useState<number | null>(null);
  const [staffSearch, setStaffSearch] = useState('');
  const [showEnroll, setShowEnroll] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const [form, setForm] = useState({
    staff_id: '',
    device_id: '',
    enrollment_type: 'fingerprint' as EnrollmentType,
    enrollment_code: '',
  });

  // ── Fetch staff options ───────────────────────────────────────────────
  const { data: staffData } = useApiQuery<StaffOptionsResponse & StaffOption[]>(
    queryKeys.attendance.staffOptions(),
    '/api/staff',
  );

  const staffOptions: StaffOption[] = (staffData as StaffOptionsResponse)?.staff ?? (staffData as StaffOption[]) ?? [];

  // ── Fetch enrollments for selected staff ──────────────────────────────
  const { data: enrollmentsData, isLoading: loading } = useApiQuery<EnrollmentsResponse & Enrollment[]>(
    queryKeys.attendance.enrollments(selectedStaff ?? 0),
    `/api/hr/biometric/enrollments/${selectedStaff}`,
    { enabled: selectedStaff !== null },
  );

  const enrollments: Enrollment[] = (enrollmentsData as EnrollmentsResponse)?.enrollments ?? (enrollmentsData as Enrollment[]) ?? [];

  // ── Enroll mutation ───────────────────────────────────────────────────
  const enrollMutation = useApiMutation<unknown, { staff_id: number; device_id: number | null; enrollment_type: EnrollmentType; enrollment_code: string }>(
    'post',
    '/api/hr/biometric/enroll',
    {
      onSuccess: () => {
        toast.success(t('toast.staffEnrolled'));
        setShowEnroll(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.attendance.all });
      },
      onError: (err) => {
        toast.error(err?.message ?? t('toast.failedEnrollStaff'));
      },
    },
  );

  // ── Toggle enrollment mutation ────────────────────────────────────────
  const toggleEnrollmentMutation = useApiMutation<unknown, { id: number; is_active: boolean }>(
    'patch',
    (vars) => `/api/hr/biometric/enrollments/${vars.id}`,
    {
      onSuccess: (_data, vars) => {
        toast.success(t(vars.is_active ? 'toast.enrollmentActivated' : 'toast.enrollmentDeactivated'));
        queryClient.invalidateQueries({ queryKey: queryKeys.attendance.all });
        setTogglingId(null);
      },
      onError: () => {
        toast.error(t('toast.failedUpdateEnrollment'));
        setTogglingId(null);
      },
    },
  );

  const selectStaff = (id: number) => {
    setSelectedStaff(id);
  };

  const openEnroll = async () => {
    try {
      const res = await api.get<DevicesResponse & Device[]>('/api/hr/biometric/devices');
      setDevices((res as DevicesResponse)?.devices ?? (res as Device[]) ?? []);
    } catch { /* ignore */ }
    setForm({
      staff_id: selectedStaff ? String(selectedStaff) : '',
      device_id: '',
      enrollment_type: 'fingerprint',
      enrollment_code: '',
    });
    setShowEnroll(true);
  };

  const submitEnrollment = () => {
    if (!form.staff_id || !form.enrollment_code) {
      toast.error(t('toast.staffEnrollmentRequired'));
      return;
    }
    enrollMutation.mutate({
      staff_id: Number(form.staff_id),
      device_id: form.device_id ? Number(form.device_id) : null,
      enrollment_type: form.enrollment_type,
      enrollment_code: form.enrollment_code,
    });
  };

  const toggleEnrollment = (enrollment: Enrollment) => {
    setTogglingId(enrollment.id);
    toggleEnrollmentMutation.mutate({ id: enrollment.id, is_active: !enrollment.is_active });
  };

  const filteredStaff = staffSearch
    ? staffOptions.filter(s => s.name.toLowerCase().includes(staffSearch.toLowerCase()))
    : staffOptions;

  const selectedStaffName = staffOptions.find(s => s.id === selectedStaff)?.name;

  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* Staff Selection */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="label">{t("enrollments.searchStaff")}</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
              <input className="input pl-9 w-full" placeholder={t("enrollments.staffSearchPlaceholder")}
                value={staffSearch} onChange={e => setStaffSearch(e.target.value)} />
            </div>
          </div>
          <button onClick={openEnroll} className="btn-primary flex items-center gap-1.5 text-sm">
            <Plus className="w-4 h-4" /> {t("enrollments.enrollStaff")}
          </button>
        </div>

        {/* Staff quick-select chips */}
        {staffSearch && filteredStaff.length > 0 && !selectedStaff && (
          <div className="mt-3 flex flex-wrap gap-2 max-h-40 overflow-y-auto">
            {filteredStaff.slice(0, 20).map(s => (
              <button key={s.id} onClick={() => { selectStaff(s.id); setStaffSearch(''); }}
                className="text-sm px-3 py-1.5 rounded-lg bg-[var(--color-bg-secondary)] hover:bg-[var(--color-primary)] hover:text-white transition-colors border border-[var(--color-border)]">
                {s.name}
                <span className="text-xs opacity-60 ml-1">({s.department})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Enrollments display */}
      {selectedStaff ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white font-bold text-xs">
                {selectedStaffName ? getInitials(selectedStaffName) : '??'}
              </div>
              <div>
                <p className="text-sm font-semibold">{selectedStaffName}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{t("enrollments.enrollmentCount", { count: enrollments.length })}</p>
              </div>
            </div>
            <button className="btn-ghost text-sm" onClick={() => { setSelectedStaff(null); }}>
              {t("enrollments.clear")}
            </button>
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base w-full">
                <thead>
                  <tr>
                    <th className="text-left p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("punchLog.type")}</th>
                    <th className="text-left p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("enrollments.code")}</th>
                    <th className="text-left p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("devices.device")}</th>
                    <th className="text-left p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("enrollments.enrolledDate")}</th>
                    <th className="text-center p-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t("enrollments.active")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {loading ? (
                    Array.from({ length: 2 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 5 }).map((__, j) => (
                          <td key={j} className="p-3"><div className="h-4 bg-gray-200 dark:bg-slate-700 rounded animate-pulse w-20" /></td>
                        ))}
                      </tr>
                    ))
                  ) : enrollments.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-[var(--color-text-muted)]">
                        <Fingerprint className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        {t("enrollments.noEnrollments")}
                      </td>
                    </tr>
                  ) : (
                    enrollments.map(en => (
                      <tr key={en.id} className="hover:bg-[var(--color-bg-secondary)] transition-colors">
                        <td className="p-3">
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                            {(ENROLLMENT_TYPE_LABELS(t) as any)[en.enrollment_type] ?? en.enrollment_type}
                          </span>
                        </td>
                        <td className="p-3 text-sm font-mono text-[var(--color-text-muted)]">{maskCode(en.enrollment_code)}</td>
                        <td className="p-3 text-sm text-[var(--color-text-muted)]">{en.device_name ?? t("enrollments.anyDevice")}</td>
                        <td className="p-3 text-sm text-[var(--color-text-muted)]">{fmtDate(en.enrolled_at, i18n.language)}</td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => toggleEnrollment(en)}
                            disabled={togglingId === en.id}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                              en.is_active ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-slate-600'
                            }`}
                          >
                            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                              en.is_active ? 'translate-x-4.5' : 'translate-x-0.5'
                            }`} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="card p-12 text-center">
          <Fingerprint className="w-10 h-10 mx-auto text-[var(--color-text-muted)] mb-3 opacity-40" />
          <p className="text-[var(--color-text-muted)]">{t("enrollments.searchPrompt")}</p>
        </div>
      )}

      {/* Enroll Staff Modal */}
      {showEnroll && (
        <Modal title={t("enrollments.enrollStaffTitle")} onClose={() => setShowEnroll(false)}>
          <div>
            <label className="label">{t("enrollments.staffMember")}</label>
            <select className="input w-full" value={form.staff_id}
              onChange={e => setForm(f => ({ ...f, staff_id: e.target.value }))}>
              <option value="">{t("live.selectStaff")}</option>
              {staffOptions.map(s => (
                <option key={s.id} value={s.id}>{s.name} - {s.position}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t("enrollments.device")}</label>
            <select className="input w-full" value={form.device_id}
              onChange={e => setForm(f => ({ ...f, device_id: e.target.value }))}>
              <option value="">{t("enrollments.anyDevice")}</option>
              {devices.filter(d => d.is_active).map(d => (
                <option key={d.id} value={d.id}>{d.device_name} ({(DEVICE_TYPE_LABELS(t) as any)[d.device_type]})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{t("enrollments.enrollmentType")}</label>
            <select className="input w-full" value={form.enrollment_type}
              onChange={e => setForm(f => ({ ...f, enrollment_type: e.target.value as EnrollmentType }))}>
              <option value="fingerprint">{t("enrollments.enrollmentTypes.fingerprint")}</option>
              <option value="rfid">{t("enrollments.enrollmentTypes.rfid")}</option>
              <option value="face">{t("enrollments.enrollmentTypes.face")}</option>
              <option value="card">{t("enrollments.enrollmentTypes.card")}</option>
              <option value="pin">{t("enrollments.enrollmentTypes.pin")}</option>
            </select>
          </div>
          <div>
            <label className="label">{t("enrollments.enrollmentCode")}</label>
            <input className="input w-full" placeholder={t("enrollments.codePlaceholder")}
              value={form.enrollment_code} onChange={e => setForm(f => ({ ...f, enrollment_code: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={() => setShowEnroll(false)}>{t("enrollments.cancel")}</button>
            <button className="btn-primary flex items-center gap-1.5" onClick={submitEnrollment} disabled={enrollMutation.isPending}>
              {enrollMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
              {t("enrollments.enroll")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function AttendancePunch({ role }: { role?: string }) {
  const { t } = useTranslation('attendance');
  const [tab, setTab] = useState<TabKey>('live');

  const tabDefs = useMemo(
    () => [
      { key: 'live' as TabKey, label: t('tabs.live') },
      { key: 'log' as TabKey, label: t('tabs.log') },
      { key: 'devices' as TabKey, label: t('tabs.devices') },
      { key: 'enrollments' as TabKey, label: t('tabs.enrollments') },
    ],
    [t],
  );

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Fingerprint className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('title')}</h1>
              <p className="section-subtitle">{t('subtitle')}</p>
            </div>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 bg-[var(--color-bg-secondary)] p-1 rounded-xl w-fit">
          {tabDefs.map(tabItem => (
            <button key={tabItem.key} onClick={() => setTab(tabItem.key)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                tab === tabItem.key
                  ? 'bg-white dark:bg-slate-700 text-[var(--color-primary)] shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}>
              {tabItem.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {tab === 'live' && <LiveBoardTab />}
        {tab === 'log' && <PunchLogTab />}
        {tab === 'devices' && <DevicesTab />}
        {tab === 'enrollments' && <EnrollmentsTab />}
      </div>
    </DashboardLayout>
  );
}
