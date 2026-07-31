import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  Fingerprint, Search, RefreshCw, Plus, X, Copy,
  Users, UserCheck, UserX, AlertTriangle, CalendarOff,
  Monitor, Wifi, WifiOff, ChevronLeft, ChevronRight,
  Filter, ArrowUpDown, Check, Shield,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { authHeader } from '../utils/auth';

// ─── Types ──────────────────────────────────────────────────────────────────

type TabKey = 'live' | 'log' | 'devices' | 'enrollments';

type PunchStatus = 'in' | 'out' | 'late' | 'break';
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

interface Enrollment {
  id: number;
  staff_id: number;
  enrollment_type: EnrollmentType;
  enrollment_code: string;
  device_name: string | null;
  enrolled_at: string;
  is_active: boolean;
}

interface StaffOption {
  id: number;
  name: string;
  position: string;
  department?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────


const STATUS_CONFIG: Record<PunchStatus, { label: string; badge: string }> = {
  in:    { label: 'In',    badge: 'badge-success' },
  out:   { label: 'Out',   badge: 'badge-neutral' },
  late:  { label: 'Late',  badge: 'badge-warning' },
  break: { label: 'Break', badge: 'bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full' },
};

const PUNCH_TYPE_LABELS: Record<PunchType, string> = {
  in: 'Clock In', out: 'Clock Out', break_start: 'Break Start', break_end: 'Break End',
};

const SOURCE_LABELS: Record<PunchSource, string> = {
  biometric: 'Biometric', rfid: 'RFID', manual: 'Manual', web: 'Web',
};

const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  fingerprint: 'Fingerprint', rfid: 'RFID', face: 'Face', card: 'Card', combo: 'Combo',
};

const ENROLLMENT_TYPE_LABELS: Record<EnrollmentType, string> = {
  fingerprint: 'Fingerprint', rfid: 'RFID', face: 'Face', card: 'Card', pin: 'PIN',
};


// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function fmtTime(iso: string | null): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso: string | null, t?: (key: string) => string): string {
  if (!iso) return t ? t('status.never') : 'Never';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
}

function maskCode(code: string): string {
  if (code.length <= 4) return '****';
  return code.slice(0, 2) + '*'.repeat(code.length - 4) + code.slice(-2);
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Reusable Modal ─────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h3 className="font-semibold text-[var(--color-text-primary)]">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LIVE BOARD TAB
// ═══════════════════════════════════════════════════════════════════════════

type SortField = 'name' | 'department' | 'status';

function LiveBoardTab() {
  const { t } = useTranslation('attendance');
  const [staff, setStaff] = useState<LiveStaff[]>([]);
  const [summary, setSummary] = useState<LiveSummary>({ total: 0, present: 0, absent: 0, late: 0, on_leave: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [showManual, setShowManual] = useState(false);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Manual punch form
  const [manualForm, setManualForm] = useState({
    staff_id: '',
    punch_type: 'in' as PunchType,
    time: '',
    remarks: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchLive = useCallback(async () => {
    try {
      const res = await axios.get(`/api/hr/biometric/punches/live`, { headers: authHeader() });
      const data = res.data;
      setStaff(data.staff ?? []);
      setSummary(data.summary ?? { total: 0, present: 0, absent: 0, late: 0, on_leave: 0 });
    } catch {
      // silently fail on auto-refresh; initial load shows toast
      if (loading) toast.error(t('toast.failedLoadLive'));
    } finally {
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    fetchLive();
    timerRef.current = setInterval(fetchLive, 30000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchLive]);

  const fetchStaffOptions = async () => {
    try {
      const res = await axios.get(`/api/staff`, { headers: authHeader() });
      setStaffOptions(res.data?.staff ?? res.data ?? []);
    } catch { /* ignore */ }
  };

  const openManual = () => {
    fetchStaffOptions();
    setManualForm({ staff_id: '', punch_type: 'in', time: '', remarks: '' });
    setShowManual(true);
  };

  const submitManualPunch = async () => {
    if (!manualForm.staff_id) { toast.error(t('toast.selectStaffMember')); return; }
    setSubmitting(true);
    try {
      await axios.post(`/api/hr/biometric/punch/manual`, {
        staff_id: Number(manualForm.staff_id),
        punch_type: manualForm.punch_type,
        time: manualForm.time || undefined,
        remarks: manualForm.remarks || undefined,
      }, { headers: authHeader() });
      toast.success(t('toast.manualPunchRecorded'));
      setShowManual(false);
      fetchLive();
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.message : t('toast.failed');
      toast.error(msg ?? t('toast.failedRecordPunch'));
    } finally {
      setSubmitting(false);
    }
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
      const order: Record<PunchStatus, number> = { in: 0, late: 1, break: 2, out: 3 };
      return order[a.status] - order[b.status];
    });

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
          <button onClick={fetchLive} className="btn-ghost p-2" title={t("live.refreshNow")}>
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
            const cfg = STATUS_CONFIG[s.status];
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
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{fmtTime(s.last_punch_time)}</p>
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
            <button className="btn-primary flex items-center gap-1.5" onClick={submitManualPunch} disabled={submitting}>
              {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
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
  const { t } = useTranslation('attendance');
  const [records, setRecords] = useState<PunchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayISO());
  const [staffFilter, setStaffFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 50;

  const fetchLog = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { date, page, limit };
      if (staffFilter) params.staff = staffFilter;
      const res = await axios.get(`/api/hr/biometric/punches`, { headers: authHeader(), params });
      const data = res.data;
      setRecords(data.punches ?? data.records ?? data ?? []);
      setTotalPages(data.totalPages ?? (Math.ceil((data.total ?? 0) / limit) || 1));
    } catch {
      toast.error(t('toast.failedLoadPunchLog'));
    } finally {
      setLoading(false);
    }
  }, [date, page, staffFilter]);

  useEffect(() => { fetchLog(); }, [fetchLog]);

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
        <button onClick={fetchLog} className="btn-ghost p-2 mt-5" title={t("punchLog.refresh")}>
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
                    {t("punchLog.noRecords", { date: fmtDate(date) })}
                  </td>
                </tr>
              ) : (
                records.map(r => (
                  <tr key={r.id} className="hover:bg-[var(--color-bg-secondary)] transition-colors">
                    <td className="p-3 text-sm font-medium">{r.staff_name}</td>
                    <td className="p-3 text-sm">{fmtDateTime(r.punch_time)}</td>
                    <td className="p-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        r.punch_type === 'in' ? 'bg-emerald-100 text-emerald-700' :
                        r.punch_type === 'out' ? 'bg-gray-100 text-gray-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {PUNCH_TYPE_LABELS[r.punch_type]}
                      </span>
                    </td>
                    <td className="p-3 text-sm text-[var(--color-text-muted)]">{SOURCE_LABELS[r.source] ?? r.source}</td>
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
  const { t } = useTranslation('attendance');
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRegister, setShowRegister] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);

  const [form, setForm] = useState({
    device_name: '',
    device_type: 'fingerprint' as DeviceType,
    serial_number: '',
    ip_address: '',
    location: '',
  });

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/hr/biometric/devices`, { headers: authHeader() });
      setDevices(res.data?.devices ?? res.data ?? []);
    } catch {
      toast.error(t('toast.failedLoadDevices'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  const openRegister = () => {
    setForm({ device_name: '', device_type: 'fingerprint', serial_number: '', ip_address: '', location: '' });
    setApiKey(null);
    setShowRegister(true);
  };

  const submitDevice = async () => {
    if (!form.device_name || !form.serial_number) {
      toast.error(t('toast.deviceNameRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await axios.post(`/api/hr/biometric/devices`, {
        device_name: form.device_name,
        device_type: form.device_type,
        serial_number: form.serial_number,
        ip_address: form.ip_address || null,
        location: form.location || null,
      }, { headers: authHeader() });
      toast.success(t('toast.deviceRegistered'));
      setApiKey(res.data?.api_key ?? res.data?.apiKey ?? null);
      fetchDevices();
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.message : t('toast.failed');
      toast.error(msg ?? t('toast.failedRegisterDevice'));
    } finally {
      setSubmitting(false);
    }
  };

  const copyKey = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      toast.success(t('toast.apiKeyCopied'));
    }
  };

  const toggleDevice = async (device: Device) => {
    setToggling(device.id);
    try {
      await axios.patch(`/api/hr/biometric/devices/${device.id}`, {
        is_active: !device.is_active,
      }, { headers: authHeader() });
      toast.success(t(device.is_active ? 'toast.deviceDeactivated' : 'toast.deviceActivated'));
      fetchDevices();
    } catch {
      toast.error(t('toast.failedUpdateDevice'));
    } finally {
      setToggling(null);
    }
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
                    <td className="p-3 text-sm">{DEVICE_TYPE_LABELS[d.device_type] ?? d.device_type}</td>
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
                    <td className="p-3 text-sm text-[var(--color-text-muted)]">{fmtDateTime(d.last_sync)}</td>
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
                <button className="btn-primary flex items-center gap-1.5" onClick={submitDevice} disabled={submitting}>
                  {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
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
  const { t } = useTranslation('attendance');
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<number | null>(null);
  const [staffSearch, setStaffSearch] = useState('');
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(false);
  const [showEnroll, setShowEnroll] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const [form, setForm] = useState({
    staff_id: '',
    device_id: '',
    enrollment_type: 'fingerprint' as EnrollmentType,
    enrollment_code: '',
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`/api/hr/staff`, { headers: authHeader() });
        setStaffOptions(res.data?.staff ?? res.data ?? []);
      } catch { /* ignore */ }
    })();
  }, []);

  const fetchEnrollments = useCallback(async (staffId: number) => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/hr/biometric/enrollments/${staffId}`, { headers: authHeader() });
      setEnrollments(res.data?.enrollments ?? res.data ?? []);
    } catch {
      toast.error(t('toast.failedLoadEnrollments'));
    } finally {
      setLoading(false);
    }
  }, []);

  const selectStaff = (id: number) => {
    setSelectedStaff(id);
    fetchEnrollments(id);
  };

  const openEnroll = async () => {
    try {
      const res = await axios.get(`/api/hr/biometric/devices`, { headers: authHeader() });
      setDevices(res.data?.devices ?? res.data ?? []);
    } catch { /* ignore */ }
    setForm({
      staff_id: selectedStaff ? String(selectedStaff) : '',
      device_id: '',
      enrollment_type: 'fingerprint',
      enrollment_code: '',
    });
    setShowEnroll(true);
  };

  const submitEnrollment = async () => {
    if (!form.staff_id || !form.enrollment_code) {
      toast.error(t('toast.staffEnrollmentRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await axios.post(`/api/hr/biometric/enroll`, {
        staff_id: Number(form.staff_id),
        device_id: form.device_id ? Number(form.device_id) : null,
        enrollment_type: form.enrollment_type,
        enrollment_code: form.enrollment_code,
      }, { headers: authHeader() });
      toast.success(t('toast.staffEnrolled'));
      setShowEnroll(false);
      if (selectedStaff) fetchEnrollments(selectedStaff);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.message : t('toast.failed');
      toast.error(msg ?? t('toast.failedEnrollStaff'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleEnrollment = async (enrollment: Enrollment) => {
    setTogglingId(enrollment.id);
    try {
      await axios.patch(`/api/hr/biometric/enrollments/${enrollment.id}`, {
        is_active: !enrollment.is_active,
      }, { headers: authHeader() });
      toast.success(t(enrollment.is_active ? 'toast.enrollmentDeactivated' : 'toast.enrollmentActivated'));
      if (selectedStaff) fetchEnrollments(selectedStaff);
    } catch {
      toast.error(t('toast.failedUpdateEnrollment'));
    } finally {
      setTogglingId(null);
    }
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
            <button className="btn-ghost text-sm" onClick={() => { setSelectedStaff(null); setEnrollments([]); }}>
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
                            {ENROLLMENT_TYPE_LABELS[en.enrollment_type] ?? en.enrollment_type}
                          </span>
                        </td>
                        <td className="p-3 text-sm font-mono text-[var(--color-text-muted)]">{maskCode(en.enrollment_code)}</td>
                        <td className="p-3 text-sm text-[var(--color-text-muted)]">{en.device_name ?? t("enrollments.anyDevice")}</td>
                        <td className="p-3 text-sm text-[var(--color-text-muted)]">{fmtDate(en.enrolled_at)}</td>
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
                <option key={d.id} value={d.id}>{d.device_name} ({DEVICE_TYPE_LABELS[d.device_type]})</option>
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
            <button className="btn-primary flex items-center gap-1.5" onClick={submitEnrollment} disabled={submitting}>
              {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
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
