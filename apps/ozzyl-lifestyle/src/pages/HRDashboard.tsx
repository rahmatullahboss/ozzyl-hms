import { useState, useEffect, useCallback } from 'react';
import {
  Users, Calendar, Clock, DollarSign, Plus, X, Check, Ban,
  ChevronRight, BarChart2, Search, AlertCircle, Briefcase,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { authHeader } from '../utils/auth';
import { useTranslation } from 'react-i18next';

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

// ─── Helper ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', minimumFractionDigits: 0 }).format(n);

const TABS = ['overview', 'leave', 'attendance', 'payroll'] as const;
type Tab = typeof TABS[number];

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

// ══════════════════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ══════════════════════════════════════════════════════════════════════════════
function OverviewTab({ stats, loading }: { stats: DashboardStats | null; loading: boolean }) {
  const { t } = useTranslation('hr');
  const runStatusColor: Record<string, string> = {
    draft: 'badge-warning', locked: 'badge-info', approved: 'badge-success',
  };
  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title={t('totalStaff')} value={stats?.totalStaff ?? 0} loading={loading}
          icon={<Users className="w-5 h-5" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
        <KPICard title={t('presentToday')} value={stats?.presentToday ?? 0} loading={loading}
          icon={<Check className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={1} />
        <KPICard title={t('pendingLeaves')} value={stats?.pendingLeaves ?? 0} loading={loading}
          icon={<Calendar className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" index={2} />
        <KPICard title={t('currentPayroll')} value={stats?.currentPayrollRun?.status ?? t('notGenerated')} loading={loading}
          icon={<DollarSign className="w-5 h-5" />} iconBg="bg-purple-50 text-purple-600" index={3} />
      </div>
      {stats?.currentPayrollRun && (
        <div className="card p-5">
          <h3 className="section-title mb-4">{t('currentPayroll')} — {stats.currentPayrollRun.run_month}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><p className="section-subtitle">{t('totalEmployees')}</p><p className="font-bold text-lg">{stats.currentPayrollRun.total_employees}</p></div>
            <div><p className="section-subtitle">{t('totalGross')}</p><p className="font-bold text-lg">{fmt(stats.currentPayrollRun.total_gross)}</p></div>
            <div><p className="section-subtitle">{t('totalDeduction')}</p><p className="font-bold text-lg text-red-600">{fmt(stats.currentPayrollRun.total_deductions)}</p></div>
            <div><p className="section-subtitle">{t('netPay')}</p><p className="font-bold text-lg text-emerald-600">{fmt(stats.currentPayrollRun.total_net)}</p></div>
          </div>
          <div className="mt-3">
            <span className={`badge ${runStatusColor[stats.currentPayrollRun.status] ?? 'badge-neutral'}`}>
              {t(stats.currentPayrollRun.status === 'approved' ? 'approvedRun' : stats.currentPayrollRun.status as Tab)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LEAVE TAB
// ══════════════════════════════════════════════════════════════════════════════
function LeaveTab({ staffList }: { staffList: Staff[] }) {
  const { t } = useTranslation('hr');
  const [categories, setCategories] = useState<LeaveCategory[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [filter, setFilter] = useState('');
  const [showCatModal, setShowCatModal] = useState(false);
  const [showReqModal, setShowReqModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [catForm, setCatForm] = useState({ leaveName: '', maxDaysPerYear: 0, description: '' });
  const [reqForm, setReqForm] = useState({
    staffId: '', leaveCategoryId: '', startDate: '', endDate: '', reason: '',
  });

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([
      axios.get('/api/hr/leave/categories', { headers: authHeader() }),
      axios.get('/api/hr/leave/requests', { headers: authHeader() }),
    ]);
    setCategories(c.data.data || []);
    setRequests(r.data.data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveCategory = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/hr/leave/categories', catForm, { headers: authHeader() });
      toast.success(t('hr.category_created')); setShowCatModal(false);
      setCatForm({ leaveName: '', maxDaysPerYear: 0, description: '' }); load();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed');
    } finally { setSaving(false); }
  };

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/hr/leave/request', {
        staffId: Number(reqForm.staffId),
        leaveCategoryId: Number(reqForm.leaveCategoryId),
        startDate: reqForm.startDate, endDate: reqForm.endDate,
        reason: reqForm.reason || undefined,
      }, { headers: authHeader() });
      toast.success(t('hr.leave_request_submitted')); setShowReqModal(false); load();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed');
    } finally { setSaving(false); }
  };

  const handleApprove = async (id: number, status: 'approved' | 'rejected') => {
    try {
      await axios.put(`/api/hr/leave/requests/${id}/approve`, { status }, { headers: authHeader() });
      toast.success(t(status === 'approved' ? 'hr.leaveApproved' : 'hr.leaveRejected')); load();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed');
    }
  };

  const filtered = requests.filter(r => !filter || r.status === filter);
  const statusBadge: Record<string, string> = {
    pending: 'badge-warning', approved: 'badge-success', rejected: 'badge-danger', cancelled: 'badge-neutral',
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Categories */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title">{t('leaveCategories')}</h3>
          <button onClick={() => setShowCatModal(true)} className="btn-primary"><Plus className="w-4 h-4" />{t('addCategory')}</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {categories.map(cat => (
            <div key={cat.id} className="border border-[var(--color-border)] rounded-xl p-3 text-sm">
              <p className="font-semibold text-[var(--color-text-primary)]">{cat.leave_name}</p>
              <p className="text-[var(--color-text-muted)]">{cat.max_days_per_year} days/year</p>
            </div>
          ))}
          {categories.length === 0 && <p className="text-[var(--color-text-muted)] text-sm col-span-4">{t('noData')}</p>}
        </div>
      </div>

      {/* Requests */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h3 className="section-title">{t('leaveRequests')}</h3>
          <div className="flex gap-3">
            <select value={filter} onChange={e => setFilter(e.target.value)} className="input w-40 py-1.5">
              <option value="">{t('allRequests')}</option>
              <option value="pending">{t('pending')}</option>
              <option value="approved">{t('approved')}</option>
              <option value="rejected">{t('rejected')}</option>
            </select>
            <button onClick={() => setShowReqModal(true)} className="btn-primary"><Plus className="w-4 h-4" />{t('submitLeave')}</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr>
              <th>{t('staffMember')}</th><th>{t('leaveType')}</th>
              <th>{t('startDate')}</th><th>{t('endDate')}</th>
              <th>{t('totalDays')}</th><th>{t('status')}</th><th></th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-[var(--color-text-muted)]">{t('noData')}</td></tr>
              ) : filtered.map(req => (
                <tr key={req.id}>
                  <td className="font-medium">{req.staff_name}</td>
                  <td>{req.leave_name}</td>
                  <td className="font-data text-sm">{req.start_date}</td>
                  <td className="font-data text-sm">{req.end_date}</td>
                  <td className="text-center font-bold">{req.total_days}</td>
                  <td><span className={`badge ${statusBadge[req.status]}`}>{t(req.status)}</span></td>
                  <td>
                    {req.status === 'pending' && (
                      <div className="flex gap-1">
                        <button onClick={() => handleApprove(req.id, 'approved')}
                          className="btn-ghost p-1.5 text-emerald-600 hover:bg-emerald-50">
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleApprove(req.id, 'rejected')}
                          className="btn-ghost p-1.5 text-red-600 hover:bg-red-50">
                          <Ban className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Category Modal */}
      {showCatModal && (
        <Modal title={t('addCategory')} onClose={() => setShowCatModal(false)}>
          <form onSubmit={saveCategory} className="space-y-4">
            <div><label className="label">{t('leaveName')} *</label>
              <input className="input" required value={catForm.leaveName}
                onChange={e => setCatForm(f => ({ ...f, leaveName: e.target.value }))} /></div>
            <div><label className="label">{t('maxDaysPerYear')}</label>
              <input className="input" type="number" min={0} value={catForm.maxDaysPerYear}
                onChange={e => setCatForm(f => ({ ...f, maxDaysPerYear: Number(e.target.value) }))} /></div>
            <div><label className="label">{t('description')}</label>
              <input className="input" value={catForm.description}
                onChange={e => setCatForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowCatModal(false)} className="btn-secondary">{t('cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('loading') : t('saveChanges')}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Leave Request Modal */}
      {showReqModal && (
        <Modal title={t('submitLeave')} onClose={() => setShowReqModal(false)}>
          <form onSubmit={submitRequest} className="space-y-4">
            <div><label className="label">{t('staffMember')} *</label>
              <select className="input" required value={reqForm.staffId}
                onChange={e => setReqForm(f => ({ ...f, staffId: e.target.value }))}>
                <option value="">{t('selectStaff')}</option>
                {staffList.map(s => <option key={s.id} value={s.id}>{s.name} — {s.position}</option>)}
              </select></div>
            <div><label className="label">{t('leaveType')} *</label>
              <select className="input" required value={reqForm.leaveCategoryId}
                onChange={e => setReqForm(f => ({ ...f, leaveCategoryId: e.target.value }))}>
                <option value="">{t('selectLeaveType')}</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.leave_name}</option>)}
              </select></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">{t('startDate')} *</label>
                <input className="input" type="date" required value={reqForm.startDate}
                  onChange={e => setReqForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div><label className="label">{t('endDate')} *</label>
                <input className="input" type="date" required value={reqForm.endDate}
                  onChange={e => setReqForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            </div>
            <div><label className="label">{t('reason')}</label>
              <input className="input" value={reqForm.reason}
                onChange={e => setReqForm(f => ({ ...f, reason: e.target.value }))} /></div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowReqModal(false)} className="btn-secondary">{t('cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('loading') : t('submitLeave')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ATTENDANCE TAB
// ══════════════════════════════════════════════════════════════════════════════
function AttendanceTab({ staffList }: { staffList: Staff[] }) {
  const { t } = useTranslation('hr');
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [view, setView] = useState<'summary' | 'detail'>('summary');
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shiftForm, setShiftForm] = useState({ shiftName: '', startTime: '09:00', endTime: '17:00', gracePeriod: 15 });
  const [checkForm, setCheckForm] = useState({ staffId: '', shiftId: '', action: 'in' as 'in' | 'out' });

  const load = useCallback(async () => {
    const [sh, sm] = await Promise.all([
      axios.get('/api/hr/attendance/shifts', { headers: authHeader() }),
      axios.get(`/api/hr/attendance/summary?month=${month}`, { headers: authHeader() }),
    ]);
    setShifts(sh.data.data || []);
    setSummary(sm.data.data || []);
    if (view === 'detail') {
      const att = await axios.get(`/api/hr/attendance/report?from=${month}-01&to=${month}-31&limit=100`, { headers: authHeader() });
      setAttendance(att.data.data || []);
    }
  }, [month, view]);

  useEffect(() => { load(); }, [load]);

  const saveShift = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/hr/attendance/shifts', shiftForm, { headers: authHeader() });
      toast.success(t('hr.shift_created')); setShowShiftModal(false); load();
    } catch { toast.error(t('hr.failed')); } finally { setSaving(false); }
  };

  const handleCheckInOut = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const url = checkForm.action === 'in' ? '/api/hr/attendance/check-in' : '/api/hr/attendance/check-out';
      const payload = checkForm.action === 'in'
        ? { staffId: Number(checkForm.staffId), shiftId: checkForm.shiftId ? Number(checkForm.shiftId) : undefined }
        : { staffId: Number(checkForm.staffId) };
      const res = await axios.post(url, payload, { headers: authHeader() });
      toast.success(res.data.message || 'Done');
      setShowCheckInModal(false); load();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed');
    } finally { setSaving(false); }
  };

  const statusColor: Record<string, string> = {
    present: 'badge-success', late: 'badge-warning', absent: 'badge-danger',
    leave: 'badge-info', half_day: 'badge-neutral',
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Shifts */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title">{t('shifts')}</h3>
          <div className="flex gap-2">
            <button onClick={() => setShowCheckInModal(true)} className="btn-secondary">
              <Clock className="w-4 h-4" />{t('checkIn')} / {t('checkOut')}
            </button>
            <button onClick={() => setShowShiftModal(true)} className="btn-primary">
              <Plus className="w-4 h-4" />{t('addShift')}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {shifts.map(sh => (
            <div key={sh.id} className="border border-[var(--color-border)] rounded-xl px-4 py-3 text-sm">
              <p className="font-semibold">{sh.shift_name}</p>
              <p className="text-[var(--color-text-muted)] font-data">{sh.start_time} – {sh.end_time}</p>
              {sh.grace_period > 0 && <p className="text-xs text-amber-600">+{sh.grace_period}min grace</p>}
            </div>
          ))}
          {shifts.length === 0 && <p className="text-[var(--color-text-muted)] text-sm">{t('noData')}</p>}
        </div>
      </div>

      {/* Attendance Report */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 p-5 border-b border-[var(--color-border)]">
          <h3 className="section-title flex-1">{t('attendanceReport')}</h3>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="input w-44 py-1.5" />
          <div className="flex gap-1 border border-[var(--color-border)] rounded-lg overflow-hidden">
            {(['summary', 'detail'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${view === v ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)]'}`}>
                {v === 'summary' ? t('monthlySummary') : t('attendanceReport')}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          {view === 'summary' ? (
            <table className="table-base">
              <thead><tr>
                <th>{t('staffMember')}</th>
                <th className="text-center">{t('presentDays')}</th>
                <th className="text-center">{t('lateDays')}</th>
                <th className="text-center">{t('absentDays')}</th>
                <th className="text-center">{t('leaveDays')}</th>
                <th className="text-center">{t('halfDays')}</th>
              </tr></thead>
              <tbody>
                {summary.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">{t('noData')}</td></tr>
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
                <th>{t('staffMember')}</th><th>{t('date')}</th>
                <th>{t('checkIn')}</th><th>{t('checkOut')}</th>
                <th>{t('shiftName')}</th><th>{t('status')}</th>
              </tr></thead>
              <tbody>
                {attendance.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">{t('noData')}</td></tr>
                ) : attendance.map(row => (
                  <tr key={row.id}>
                    <td className="font-medium">{row.staff_name}</td>
                    <td className="font-data text-sm">{row.date}</td>
                    <td className="font-data text-sm text-emerald-600">{row.check_in ?? '—'}</td>
                    <td className="font-data text-sm text-slate-500">{row.check_out ?? '—'}</td>
                    <td className="text-sm">{row.shift_name ?? '—'}</td>
                    <td><span className={`badge ${statusColor[row.status] ?? 'badge-neutral'}`}>{row.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Shift Modal */}
      {showShiftModal && (
        <Modal title={t('addShift')} onClose={() => setShowShiftModal(false)}>
          <form onSubmit={saveShift} className="space-y-4">
            <div><label className="label">{t('shiftName')} *</label>
              <input className="input" required value={shiftForm.shiftName}
                onChange={e => setShiftForm(f => ({ ...f, shiftName: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">{t('startTime')}</label>
                <input className="input" type="time" value={shiftForm.startTime}
                  onChange={e => setShiftForm(f => ({ ...f, startTime: e.target.value }))} /></div>
              <div><label className="label">{t('endTime')}</label>
                <input className="input" type="time" value={shiftForm.endTime}
                  onChange={e => setShiftForm(f => ({ ...f, endTime: e.target.value }))} /></div>
            </div>
            <div><label className="label">{t('gracePeriod')}</label>
              <input className="input" type="number" min={0} value={shiftForm.gracePeriod}
                onChange={e => setShiftForm(f => ({ ...f, gracePeriod: Number(e.target.value) }))} /></div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowShiftModal(false)} className="btn-secondary">{t('cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('loading') : t('saveChanges')}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Check-in/out Modal */}
      {showCheckInModal && (
        <Modal title={`${t('checkIn')} / ${t('checkOut')}`} onClose={() => setShowCheckInModal(false)}>
          <form onSubmit={handleCheckInOut} className="space-y-4">
            <div className="flex gap-2 border border-[var(--color-border)] rounded-lg overflow-hidden">
              {(['in', 'out'] as const).map(a => (
                <button key={a} type="button" onClick={() => setCheckForm(f => ({ ...f, action: a }))}
                  className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${checkForm.action === a ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)]'}`}>
                  {a === 'in' ? t('checkIn') : t('checkOut')}
                </button>
              ))}
            </div>
            <div><label className="label">{t('staffMember')} *</label>
              <select className="input" required value={checkForm.staffId}
                onChange={e => setCheckForm(f => ({ ...f, staffId: e.target.value }))}>
                <option value="">{t('selectStaff')}</option>
                {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            {checkForm.action === 'in' && (
              <div><label className="label">{t('selectShift')}</label>
                <select className="input" value={checkForm.shiftId}
                  onChange={e => setCheckForm(f => ({ ...f, shiftId: e.target.value }))}>
                  <option value="">— No shift —</option>
                  {shifts.map(sh => <option key={sh.id} value={sh.id}>{sh.shift_name} ({sh.start_time}–{sh.end_time})</option>)}
                </select></div>
            )}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowCheckInModal(false)} className="btn-secondary">{t('cancel')}</button>
              <button type="submit" disabled={saving} className={`${checkForm.action === 'in' ? 'btn-primary' : 'btn-secondary'}`}>
                {saving ? t('loading') : (checkForm.action === 'in' ? t('checkIn') : t('checkOut'))}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PAYROLL TAB
// ══════════════════════════════════════════════════════════════════════════════
function PayrollTab({ staffList }: { staffList: Staff[] }) {
  const { t } = useTranslation('hr');
  const [heads, setHeads] = useState<SalaryHead[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [structure, setStructure] = useState<SalaryStructureItem[]>([]);
  const [structSummary, setStructSummary] = useState({ totalEarning: 0, totalDeduction: 0, netPay: 0 });
  const [showHeadModal, setShowHeadModal] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [headForm, setHeadForm] = useState({ headName: '', headType: 'earning' as 'earning' | 'deduction', isTaxable: true });
  const [runMonth, setRunMonth] = useState(new Date().toISOString().slice(0, 7));

  const load = useCallback(async () => {
    const [h, r] = await Promise.all([
      axios.get('/api/hr/payroll/salary-heads', { headers: authHeader() }),
      axios.get('/api/hr/payroll/runs?limit=10', { headers: authHeader() }),
    ]);
    setHeads(h.data.data || []);
    setRuns(r.data.data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadStructure = async (staffId: string) => {
    setSelectedStaff(staffId);
    if (!staffId) { setStructure([]); return; }
    const res = await axios.get(`/api/hr/payroll/structure/${staffId}`, { headers: authHeader() });
    setStructure(res.data.data || []);
    setStructSummary(res.data.summary || { totalEarning: 0, totalDeduction: 0, netPay: 0 });
  };

  const saveHead = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await axios.post('/api/hr/payroll/salary-heads', headForm, { headers: authHeader() });
      toast.success(t('hr.salary_head_created')); setShowHeadModal(false); load();
    } catch { toast.error(t('hr.failed')); } finally { setSaving(false); }
  };

  const createRun = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const res = await axios.post('/api/hr/payroll/runs', { runMonth }, { headers: authHeader() });
      toast.success(res.data.message || 'Payroll generated'); setShowRunModal(false); load();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed');
    } finally { setSaving(false); }
  };

  const transition = async (id: number, action: 'lock' | 'approve') => {
    try {
      await axios.post(`/api/hr/payroll/runs/${id}/${action}`, {}, { headers: authHeader() });
      toast.success(t(action === 'lock' ? 'hr.payrollLocked' : 'hr.payrollApproved')); load();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed' : 'Failed');
    }
  };

  const runStatusBadge: Record<string, string> = {
    draft: 'badge-warning', locked: 'badge-info', approved: 'badge-success', cancelled: 'badge-danger',
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Salary Heads */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title">{t('salaryHeads')}</h3>
          <button onClick={() => setShowHeadModal(true)} className="btn-primary"><Plus className="w-4 h-4" />{t('addSalaryHead')}</button>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {['earning', 'deduction'].map(type => (
            <div key={type} className="border border-[var(--color-border)] rounded-xl p-4">
              <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${type === 'earning' ? 'text-emerald-600' : 'text-red-600'}`}>
                {t(type as 'earning' | 'deduction')}
              </p>
              <div className="space-y-1">
                {heads.filter(h => h.head_type === type).map(h => (
                  <div key={h.id} className="flex items-center justify-between text-sm py-1">
                    <span>{h.head_name}</span>
                    {h.is_taxable === 1 && <span className="badge badge-neutral text-xs">taxable</span>}
                  </div>
                ))}
                {heads.filter(h => h.head_type === type).length === 0 && (
                  <p className="text-[var(--color-text-muted)] text-sm">{t('noData')}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Salary Structure */}
      <div className="card p-5">
        <h3 className="section-title mb-4">{t('salaryStructure')}</h3>
        <div className="mb-4">
          <select className="input max-w-xs" value={selectedStaff} onChange={e => loadStructure(e.target.value)}>
            <option value="">{t('selectStaffForStructure')}</option>
            {staffList.map(s => <option key={s.id} value={s.id}>{s.name} — {s.position}</option>)}
          </select>
        </div>
        {selectedStaff && (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>{t('headName')}</th><th>{t('headType')}</th><th className="text-right">{t('amount')}</th></tr></thead>
                <tbody>
                  {structure.length === 0 ? (
                    <tr><td colSpan={3} className="text-center py-4 text-[var(--color-text-muted)]">{t('noData')}</td></tr>
                  ) : structure.map(item => (
                    <tr key={item.id}>
                      <td className="font-medium">{item.head_name}</td>
                      <td><span className={`badge ${item.head_type === 'earning' ? 'badge-success' : 'badge-danger'}`}>{t(item.head_type as 'earning' | 'deduction')}</span></td>
                      <td className="text-right font-data">{fmt(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {structure.length > 0 && (
              <div className="grid grid-cols-3 gap-3 pt-2 border-t border-[var(--color-border)]">
                <div className="text-center"><p className="text-xs text-[var(--color-text-muted)]">{t('totalEarning')}</p><p className="font-bold text-emerald-600">{fmt(structSummary.totalEarning)}</p></div>
                <div className="text-center"><p className="text-xs text-[var(--color-text-muted)]">{t('totalDeduction')}</p><p className="font-bold text-red-600">{fmt(structSummary.totalDeduction)}</p></div>
                <div className="text-center"><p className="text-xs text-[var(--color-text-muted)]">{t('netPay')}</p><p className="font-bold text-[var(--color-primary)]">{fmt(structSummary.netPay)}</p></div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Payroll Runs */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h3 className="section-title">{t('payrollRuns')}</h3>
          <button onClick={() => setShowRunModal(true)} className="btn-primary"><Plus className="w-4 h-4" />{t('createPayroll')}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr>
              <th>{t('runMonth')}</th><th>{t('totalEmployees')}</th>
              <th className="text-right">{t('totalGross')}</th>
              <th className="text-right">{t('totalNet')}</th>
              <th>{t('runStatus')}</th><th></th>
            </tr></thead>
            <tbody>
              {runs.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">{t('noData')}</td></tr>
              ) : runs.map(run => (
                <tr key={run.id}>
                  <td className="font-data font-medium">{run.run_month}</td>
                  <td className="text-center">{run.total_employees}</td>
                  <td className="text-right font-data">{fmt(run.total_gross)}</td>
                  <td className="text-right font-data font-bold text-emerald-600">{fmt(run.total_net)}</td>
                  <td><span className={`badge ${runStatusBadge[run.status] ?? 'badge-neutral'}`}>{run.status}</span></td>
                  <td>
                    <div className="flex gap-1">
                      {run.status === 'draft' && (
                        <button onClick={() => transition(run.id, 'lock')} className="btn-ghost text-xs px-2 py-1.5">
                          {t('lockRun')}
                        </button>
                      )}
                      {run.status === 'locked' && (
                        <button onClick={() => transition(run.id, 'approve')} className="btn-ghost text-xs px-2 py-1.5 text-emerald-600">
                          {t('approveRun')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Head Modal */}
      {showHeadModal && (
        <Modal title={t('addSalaryHead')} onClose={() => setShowHeadModal(false)}>
          <form onSubmit={saveHead} className="space-y-4">
            <div><label className="label">{t('headName')} *</label>
              <input className="input" required value={headForm.headName}
                onChange={e => setHeadForm(f => ({ ...f, headName: e.target.value }))} /></div>
            <div><label className="label">{t('headType')}</label>
              <select className="input" value={headForm.headType}
                onChange={e => setHeadForm(f => ({ ...f, headType: e.target.value as 'earning' | 'deduction' }))}>
                <option value="earning">{t('earning')}</option>
                <option value="deduction">{t('deduction')}</option>
              </select></div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={headForm.isTaxable}
                onChange={e => setHeadForm(f => ({ ...f, isTaxable: e.target.checked }))} />
              <span className="text-sm">{t('taxable')}</span>
            </label>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowHeadModal(false)} className="btn-secondary">{t('cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('loading') : t('saveChanges')}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Payroll Run Modal */}
      {showRunModal && (
        <Modal title={t('createPayroll')} onClose={() => setShowRunModal(false)}>
          <form onSubmit={createRun} className="space-y-4">
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg flex gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>This will generate payslips for all active staff based on their salary structure.</span>
            </div>
            <div><label className="label">{t('runMonth')} *</label>
              <input className="input" type="month" required value={runMonth}
                onChange={e => setRunMonth(e.target.value)} /></div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowRunModal(false)} className="btn-secondary">{t('cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('loading') : t('createPayroll')}</button>
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
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [st, staff] = await Promise.all([
          axios.get('/api/hr/payroll/dashboard', { headers: authHeader() }),
          axios.get('/api/staff', { headers: authHeader() }),
        ]);
        setStats(st.data);
        setStaffList((staff.data.staff || []).filter((s: Staff & { status?: string }) => s.status !== 'inactive'));
      } catch { /* silent */ } finally { setLoading(false); }
    };
    load();
  }, []);

  const tabIcons: Record<Tab, React.ReactNode> = {
    overview:   <BarChart2 className="w-4 h-4" />,
    leave:      <Calendar className="w-4 h-4" />,
    attendance: <Clock className="w-4 h-4" />,
    payroll:    <DollarSign className="w-4 h-4" />,
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
              <h1 className="page-title">{t('hrPayroll', { ns: 'hr' })}</h1>
              <p className="section-subtitle">Leave · Attendance · Payroll</p>
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
              {t(tab, { ns: 'hr' })}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'overview'   && <OverviewTab stats={stats} loading={loading} />}
        {activeTab === 'leave'      && <LeaveTab staffList={staffList} />}
        {activeTab === 'attendance' && <AttendanceTab staffList={staffList} />}
        {activeTab === 'payroll'    && <PayrollTab staffList={staffList} />}
      </div>
    </DashboardLayout>
  );
}
