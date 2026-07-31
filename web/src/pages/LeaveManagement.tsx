import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  Calendar, Plus, CheckCircle, XCircle, Clock, RefreshCw, Filter,
  User, Briefcase, AlertTriangle, Archive,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { api } from '../lib/apiClient';
import { useTranslation } from 'react-i18next';



interface LeaveCategory { id: number; leave_name: string; description?: string; max_days_per_year: number; }
interface LeaveRequest {
  id: number; staff_id: number; staff_name?: string; leave_category_id: number; leave_name?: string;
  start_date: string; end_date: string; total_days: number; reason: string; status: string;
  applied_at: string; approved_by?: string; approved_at?: string; rejection_reason?: string;
}
interface LeaveBalance { id: number; staff_id: number; staff_name?: string; leave_category_id: number; leave_name?: string; year: number; entitled_days: number; used_days: number; remaining_days: number; }

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

const useFmt = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language === 'bn' ? 'bn-BD' : 'en-GB';

  const fmtDate = (d: string) => {
    if (!d) return '—';
    try {
      return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(d));
    } catch { return d; }
  };

  const fmtFull = (d: string) => {
    if (!d) return '—';
    try {
      return new Intl.DateTimeFormat(lang, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(d));
    } catch { return d; }
  };

  return { fmtDate, fmtFull };
};

const TABS = [
  { key: 'requests', icon: Calendar },
  { key: 'balances', icon: Archive },
  { key: 'categories', icon: Briefcase },
] as const;
type TabKey = typeof TABS[number]['key'];

export default function LeaveManagement({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['hr', 'common']);
  const { fmtDate } = useFmt();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('requests');

  const [statusFilter, setStatusFilter] = useState('');
  const [showReqModal, setShowReqModal] = useState(false);
  const [showCatModal, setShowCatModal] = useState(false);
  const [showBalanceModal, setShowBalanceModal] = useState(false);

  const [reqForm, setReqForm] = useState({ staffId: '', leaveCategoryId: '', startDate: '', endDate: '', reason: '', isHalfDay: false, halfDayType: 'first_half' as 'first_half'|'second_half' });
  const [catForm, setCatForm] = useState({ leaveName: '', description: '', maxDaysPerYear: '' });
  const [balanceForm, setBalanceForm] = useState({ staffId: '', year: new Date().getFullYear().toString() });

  const { data: categoriesData } = useApiQuery<{ data: LeaveCategory[] }>(
    ['hr', 'leave', 'categories'],
    '/api/hr/leave/categories'
  );
  const categories = categoriesData?.data ?? [];

  const { data: requestsData, isLoading: loadingReq } = useApiQuery<{ data: LeaveRequest[] }>(
    ['hr', 'leave', 'requests', statusFilter],
    `/api/hr/leave/requests${statusFilter ? `?status=${statusFilter}` : ''}`
  );
  const requests = requestsData?.data ?? [];

  const { data: balancesData, isLoading: loadingBal } = useApiQuery<{ data: LeaveBalance[] }>(
    ['hr', 'leave', 'balances'],
    '/api/hr/leave/balances'
  );
  const balances = balancesData?.data ?? [];

  const createReqMutation = useApiMutation('post', '/api/hr/leave/requests', {
    onSuccess: () => { toast.success(t('hr:toasts.submitted')); setShowReqModal(false); setReqForm({ staffId: '', leaveCategoryId: '', startDate: '', endDate: '', reason: '', isHalfDay: false, halfDayType: 'first_half' }); queryClient.invalidateQueries({ queryKey: ['hr', 'leave'] }); },
    onError: (err: any) => toast.error(err.message || t('hr:toasts.failed')),
  });

  const approveMutation = useApiMutation('patch', (vars: any) => `/api/hr/leave/requests/${vars.id}/approve`, {
    onSuccess: () => { toast.success(t('hr:toasts.approved')); queryClient.invalidateQueries({ queryKey: ['hr', 'leave'] }); },
    onError: (err: any) => toast.error(err.message || t('hr:toasts.failed')),
  });

  const rejectMutation = useApiMutation('patch', (vars: any) => `/api/hr/leave/requests/${vars.id}/approve`, {
    onSuccess: () => { toast.success(t('hr:toasts.rejected')); queryClient.invalidateQueries({ queryKey: ['hr', 'leave'] }); },
    onError: (err: any) => toast.error(err.message || t('hr:toasts.failed')),
  });

  const createCatMutation = useApiMutation('post', '/api/hr/leave/categories', {
    onSuccess: () => { toast.success(t('hr:toasts.categoryCreated')); setShowCatModal(false); setCatForm({ leaveName: '', description: '', maxDaysPerYear: '' }); queryClient.invalidateQueries({ queryKey: ['hr', 'leave'] }); },
    onError: (err: any) => toast.error(err.message || t('hr:toasts.failed')),
  });

  const initBalanceMutation = useApiMutation('post', '/api/hr/leave/init-balance', {
    onSuccess: () => { toast.success(t('hr:toasts.balanceInitialized')); setShowBalanceModal(false); setBalanceForm({ staffId: '', year: new Date().getFullYear().toString() }); queryClient.invalidateQueries({ queryKey: ['hr', 'leave'] }); },
    onError: (err: any) => toast.error(err.message || t('hr:toasts.failed')),
  });


  const calcDays = (start: string, end: string, isHalf: boolean) => {
    if (!start || !end) return 0;
    const s = new Date(start); const e = new Date(end);
    let days = Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (days < 1) days = 1;
    return isHalf ? 0.5 : days;
  };

  return (
    <DashboardLayout role={role}>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('hr:leaveTitle', { defaultValue: 'Leave Management' })}</h1>
            <p className="section-subtitle mt-1">{t('hr:subtitle')}</p>
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title={t('hr:kpi.pending')} value={String(requests.filter(r => r.status === 'pending').length)} icon={<Clock className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" loading={loadingReq} />
          <KPICard title={t('hr:kpi.approvedMonth')} value={String(requests.filter(r => r.status === 'approved' && r.approved_at?.startsWith(new Date().toISOString().slice(0,7))).length)} icon={<CheckCircle className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" loading={loadingReq} />
          <KPICard title={t('hr:kpi.categories')} value={String(categories.length)} icon={<Briefcase className="w-5 h-5" />} iconBg="bg-blue-50 text-blue-600" loading={!categoriesData} />
          <KPICard title={t('hr:kpi.lowBalance')} value={String(balances.filter(b => b.remaining_days <= 3).length)} icon={<AlertTriangle className="w-5 h-5" />} iconBg="bg-red-50 text-red-600" loading={loadingBal} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[var(--color-border)]">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === tab.key ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
              <tab.icon className="w-4 h-4" /> {t(`hr:tabs.${tab.key}`)}
            </button>
          ))}
        </div>


        {/* Filters */}
        <div className="card p-3 flex gap-3 flex-wrap items-center">
          {activeTab === 'requests' && (
            <>
              <Filter className="w-4 h-4 text-[var(--color-text-muted)]" />
              <select className="input w-36 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">{t('hr:filters.allStatus')}</option>
                <option value="pending">{t('hr:filters.pending')}</option>
                <option value="approved">{t('hr:filters.approved')}</option>
                <option value="rejected">{t('hr:filters.rejected')}</option>
                <option value="cancelled">{t('hr:filters.cancelled')}</option>
              </select>
            </>
          )}
          <button onClick={() => queryClient.invalidateQueries({ queryKey: ['hr', 'leave'] })} className="btn-ghost ml-auto text-sm">
            <RefreshCw className="w-4 h-4" />
          </button>
          {activeTab === 'requests' && <button onClick={() => setShowReqModal(true)} className="btn-primary text-sm flex items-center gap-1"><Plus className="w-4 h-4" /> {t('hr:buttons.applyLeave')}</button>}
          {activeTab === 'categories' && <button onClick={() => setShowCatModal(true)} className="btn-primary text-sm flex items-center gap-1"><Plus className="w-4 h-4" /> {t('hr:buttons.addCategory')}</button>}
          {activeTab === 'balances' && <button onClick={() => setShowBalanceModal(true)} className="btn-primary text-sm flex items-center gap-1"><Plus className="w-4 h-4" /> {t('hr:buttons.initBalance')}</button>}
        </div>


        {/* === REQUESTS TAB === */}
        {activeTab === 'requests' && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base text-sm">
                <thead><tr><th>{t('hr:table.staff')}</th><th>{t('hr:table.type')}</th><th>{t('hr:table.from')}</th><th>{t('hr:table.to')}</th><th>{t('hr:table.days')}</th><th>{t('hr:table.status')}</th><th>{t('hr:table.applied')}</th><th>{t('common:actions')}</th></tr></thead>
                <tbody>
                  {loadingReq ? (
                    [...Array(5)].map((_, i) => <tr key={i}>{[...Array(8)].map((__, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                  ) : requests.length === 0 ? (
                    <tr><td colSpan={8}><EmptyState icon={<Calendar className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('hr:empty.noRequests')} description={t('hr:empty.noRequests')} /></td></tr>
                  ) : (
                    requests.map(r => (
                      <tr key={r.id}>
                        <td className="font-medium">{r.staff_name ?? `${t('hr:table.staff')} ${r.staff_id}`}</td>
                        <td>{r.leave_name ?? '—'}</td>
                        <td className="text-xs">{fmtDate(r.start_date)}</td>
                        <td className="text-xs">{fmtDate(r.end_date)}</td>
                        <td>{r.total_days}</td>
                        <td>
                          <div className="flex flex-col gap-1">
                            <span className={`badge text-xs w-max ${STATUS_COLORS[r.status] ?? 'bg-gray-100'}`}>{t(`hr:filters.${r.status}`)}</span>
                            {r.rejection_reason && <span className="text-[10px] text-red-500 italic max-w-[120px] truncate" title={r.rejection_reason}>{r.rejection_reason}</span>}
                          </div>
                        </td>
                        <td className="text-xs">{fmtDate(r.applied_at)}</td>

                        <td>
                          {r.status === 'pending' && (
                            <div className="flex gap-1">
                              <button onClick={() => approveMutation.mutate({ id: r.id, status: 'approved' })} disabled={approveMutation.isPending} className="btn-ghost text-xs text-emerald-600" title={t('hr:buttons.approve')}><CheckCircle className="w-4 h-4" /></button>
                              <button onClick={() => { const reason = prompt(t('hr:prompts.rejectionReason')); if (reason) rejectMutation.mutate({ id: r.id, status: 'rejected', rejectionReason: reason }); }} disabled={rejectMutation.isPending} className="btn-ghost text-xs text-red-600" title={t('hr:buttons.reject')}><XCircle className="w-4 h-4" /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* === BALANCES TAB === */}
        {activeTab === 'balances' && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base text-sm">
                <thead><tr><th>{t('hr:table.staff')}</th><th>{t('hr:table.type')}</th><th>{t('hr:table.year')}</th><th>{t('hr:table.entitled')}</th><th>{t('hr:table.used')}</th><th>{t('hr:table.remaining')}</th></tr></thead>
                <tbody>
                  {loadingBal ? (
                    [...Array(5)].map((_, i) => <tr key={i}>{[...Array(6)].map((__, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                  ) : balances.length === 0 ? (
                    <tr><td colSpan={6}><EmptyState icon={<Archive className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('hr:empty.noBalances')} description={t('hr:empty.initPrompt')} /></td></tr>
                  ) : (
                    balances.map(b => (
                      <tr key={b.id} className={b.remaining_days <= 3 ? 'bg-red-50' : ''}>
                        <td className="font-medium">{b.staff_name ?? `${t('hr:table.staff')} ${b.staff_id}`}</td>
                        <td>{b.leave_name ?? '—'}</td>
                        <td>{b.year}</td>
                        <td>{b.entitled_days}</td>
                        <td>{b.used_days}</td>
                        <td className={`font-bold ${b.remaining_days <= 3 ? 'text-red-600' : ''}`}>{b.remaining_days}</td>
                      </tr>
                    ))
                  )}

                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* === CATEGORIES TAB === */}
        {activeTab === 'categories' && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base text-sm">
                <thead><tr><th>{t('hr:table.name')}</th><th>{t('hr:table.description')}</th><th>{t('hr:table.maxDays')}</th></tr></thead>
                <tbody>
                  {categories.length === 0 ? (
                    <tr><td colSpan={3}><EmptyState icon={<Briefcase className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('hr:empty.noCategories')} description={t('hr:empty.createPrompt')} /></td></tr>
                  ) : (

                    categories.map(c => (
                      <tr key={c.id}>
                        <td className="font-medium">{c.leave_name}</td>
                        <td>{c.description ?? '—'}</td>
                        <td>{c.max_days_per_year}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* === REQUEST MODAL === */}
        {showReqModal && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-bg-card)] rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
              <h3 className="text-lg font-semibold">{t('hr:modals.applyTitle')}</h3>
              <input placeholder={t('hr:modals.staffId')} value={reqForm.staffId} onChange={e => setReqForm(f => ({ ...f, staffId: e.target.value }))} className="input w-full text-sm" />
              <select value={reqForm.leaveCategoryId} onChange={e => setReqForm(f => ({ ...f, leaveCategoryId: e.target.value }))} className="input w-full text-sm">
                <option value="">{t('hr:modals.selectType')}</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.leave_name}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <input type="date" value={reqForm.startDate} onChange={e => setReqForm(f => ({ ...f, startDate: e.target.value }))} className="input text-sm" />
                <input type="date" value={reqForm.endDate} onChange={e => setReqForm(f => ({ ...f, endDate: e.target.value }))} className="input text-sm" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={reqForm.isHalfDay} onChange={e => setReqForm(f => ({ ...f, isHalfDay: e.target.checked }))} /> {t('hr:modals.halfDay')}
              </label>
              {reqForm.isHalfDay && (
                <select value={reqForm.halfDayType} onChange={e => setReqForm(f => ({ ...f, halfDayType: e.target.value as any }))} className="input w-full text-sm">
                  <option value="first_half">{t('hr:modals.firstHalf')}</option>
                  <option value="second_half">{t('hr:modals.secondHalf')}</option>
                </select>
              )}
              <p className="text-xs text-[var(--color-text-muted)]">{t('hr:table.days')}: {calcDays(reqForm.startDate, reqForm.endDate, reqForm.isHalfDay)}</p>
              <textarea placeholder={t('hr:modals.reason')} value={reqForm.reason} onChange={e => setReqForm(f => ({ ...f, reason: e.target.value }))} rows={2} className="input w-full text-sm" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowReqModal(false)} className="btn btn-secondary text-sm">{t('common:cancel')}</button>
                <button onClick={() => createReqMutation.mutate({
                  staffId: Number(reqForm.staffId), leaveCategoryId: Number(reqForm.leaveCategoryId),
                  startDate: reqForm.startDate, endDate: reqForm.endDate,
                  totalDays: calcDays(reqForm.startDate, reqForm.endDate, reqForm.isHalfDay),
                  reason: reqForm.reason, isHalfDay: reqForm.isHalfDay, halfDayType: reqForm.isHalfDay ? reqForm.halfDayType : undefined,
                })} disabled={createReqMutation.isPending} className="btn btn-primary text-sm">{createReqMutation.isPending ? t('common:saving') : t('hr:buttons.submit')}</button>
              </div>
            </div>
          </div>

        )}

        {/* === CATEGORY MODAL === */}
        {showCatModal && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-bg-card)] rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
              <h3 className="text-lg font-semibold">{t('hr:modals.categoryTitle')}</h3>
              <input placeholder={t('hr:table.name') + ' *'} value={catForm.leaveName} onChange={e => setCatForm(f => ({ ...f, leaveName: e.target.value }))} className="input w-full text-sm" />
              <input placeholder={t('hr:modals.description')} value={catForm.description} onChange={e => setCatForm(f => ({ ...f, description: e.target.value }))} className="input w-full text-sm" />
              <input type="number" placeholder={t('hr:modals.maxDays')} value={catForm.maxDaysPerYear} onChange={e => setCatForm(f => ({ ...f, maxDaysPerYear: e.target.value }))} className="input w-full text-sm" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowCatModal(false)} className="btn btn-secondary text-sm">{t('common:cancel')}</button>
                <button onClick={() => createCatMutation.mutate({ leaveName: catForm.leaveName, description: catForm.description || undefined, maxDaysPerYear: Number(catForm.maxDaysPerYear) })} disabled={createCatMutation.isPending} className="btn btn-primary text-sm">{createCatMutation.isPending ? t('common:saving') : t('hr:buttons.create')}</button>
              </div>
            </div>
          </div>

        )}

        {/* === BALANCE MODAL === */}
        {showBalanceModal && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-bg-card)] rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
              <h3 className="text-lg font-semibold">{t('hr:modals.balanceTitle')}</h3>
              <input placeholder={t('hr:modals.staffId')} value={balanceForm.staffId} onChange={e => setBalanceForm(f => ({ ...f, staffId: e.target.value }))} className="input w-full text-sm" />
              <input type="number" placeholder={t('hr:modals.year')} value={balanceForm.year} onChange={e => setBalanceForm(f => ({ ...f, year: e.target.value }))} className="input w-full text-sm" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowBalanceModal(false)} className="btn btn-secondary text-sm">{t('common:cancel')}</button>
                <button onClick={() => initBalanceMutation.mutate({ staffId: Number(balanceForm.staffId), year: Number(balanceForm.year) })} disabled={initBalanceMutation.isPending} className="btn btn-primary text-sm">{initBalanceMutation.isPending ? t('common:saving') : t('hr:buttons.initBalance')}</button>
              </div>
            </div>
          </div>

        )}
      </div>
    </DashboardLayout>
  );
}
